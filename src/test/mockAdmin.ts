import fixture from "./fixtures/admin-double.json";

/**
 * A `fetch` that stands in for the admin backend in component tests. Its answers are RECORDED from
 * the svc-admin test double (scripts/record-double.mjs; the double serves the spec's own examples),
 * and it applies the browser-visible rules the double applies: no Authorization header, the
 * CSRF token and an Idempotency-Key on every state-changing call, 401 without a session. A test
 * overrides single operations with `on(...)` to drive a state (a device list with every state, a
 * 503, a refusal) and reads `calls` to assert what the browser sent.
 */
export type Recorded = { method: string; template: string; status: number; body: unknown };
export type MockRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
  params: Record<string, string>;
};
export type MockResponse = { status: number; body?: unknown; problem?: boolean };
export type Handler = (req: MockRequest) => MockResponse | Promise<MockResponse>;

export const CSRF = fixture.csrf;
export const ORG_ID = fixture.org;
export const DEVICE_ID = fixture.device;
const OPS = fixture.operations as Record<string, Recorded>;

/** The recorded answer of one operation (deep copy, safe to edit in a test). */
export function recorded<T = unknown>(operationId: string): T {
  const r = OPS[operationId];
  if (!r) throw new Error(`no recording for ${operationId}`);
  return structuredClone(r.body) as T;
}

function matcher(template: string): (path: string) => Record<string, string> | undefined {
  const names: string[] = [];
  const re = new RegExp(
    "^" +
      template.replace(/\{([a-z_]+)\}/g, (_m, n: string) => {
        names.push(n);
        return "([^/]+)";
      }) +
      "$",
  );
  return (path) => {
    const m = re.exec(path);
    return m ? Object.fromEntries(names.map((n, i) => [n, m[i + 1] ?? ""])) : undefined;
  };
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}): MockResponse {
  return { status, problem: true, body: { type: `urn:hostry:problem:${code}`, title: code, status, code, ...extra } };
}

export type MockCall = { method: string; path: string; query: string; body: unknown; headers: Headers };

export function createMockAdmin(options: { signedIn?: boolean } = {}) {
  let signedIn = options.signedIn ?? true;
  const calls: MockCall[] = [];
  const overrides = new Map<string, Handler>();
  const routes = Object.values(OPS).map((r) => ({ key: `${r.method} ${r.template}`, match: matcher(r.template), rec: r }));

  /** Override an operation: `on("GET /v1/organisations", () => ({ status: 200, body }))`. */
  const on = (key: string, handler: Handler | MockResponse) => {
    overrides.set(key, typeof handler === "function" ? handler : () => handler);
  };

  const mockFetch: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url, "http://admin.test");
    const method = req.method.toUpperCase();
    const text = method === "GET" || method === "HEAD" ? "" : await req.clone().text();
    const body = text ? JSON.parse(text) : undefined;
    calls.push({ method, path: url.pathname, query: url.search, body, headers: req.headers });

    const reply = (r: MockResponse) =>
      new Response(r.status === 204 || r.body === null || r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
        headers: r.status === 204 ? {} : { "content-type": r.problem ? "application/problem+json" : "application/json" },
      });

    if (req.headers.has("authorization")) return reply(problem(401, "auth.invalid_token"));
    const route = routes.find((r) => r.rec.method === method && r.match(url.pathname));
    if (!route) return reply(problem(404, "not_found"));
    const params = route.match(url.pathname) ?? {};
    const isPublic = ["POST /v1/sessions", "POST /v1/account-setups", "POST /v1/account-setup-completions"].includes(route.key);
    const mutating = method !== "GET";

    if (mutating && !req.headers.has("idempotency-key") && route.key !== "DELETE /v1/sessions/current") {
      return reply(problem(422, "idempotency.key_invalid"));
    }
    if (!isPublic) {
      if (!signedIn) return reply(problem(401, "auth.invalid_token"));
      if (mutating && req.headers.get("x-csrf-token") !== CSRF) return reply(problem(403, "csrf_failed"));
    }
    const handler = overrides.get(route.key);
    if (handler) return reply(await handler({ method, path: url.pathname, query: url.searchParams, body, headers: req.headers, params }));
    if (route.key === "POST /v1/sessions") signedIn = true;
    return reply({ status: route.rec.status, body: structuredClone(route.rec.body) });
  };

  return {
    fetch: mockFetch,
    on,
    calls,
    /** Calls of one operation, in order. */
    callsOf: (key: string) => calls.filter((c) => `${c.method} ${routes.find((r) => r.rec.method === c.method && r.match(c.path))?.rec.template}` === key),
    signOut: () => {
      signedIn = false;
    },
  };
}

export type MockAdmin = ReturnType<typeof createMockAdmin>;
