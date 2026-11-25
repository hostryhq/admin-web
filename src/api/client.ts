import { createApiClient } from "@hostry/client-core";
import type { paths } from "../generated";

export type AdminApiOptions = {
  /** Same origin by default: the admin backend serves this app and the API. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The server answered (any status): the network path works. */
  onReachable?: () => void;
  /** The request never reached a server (network error): feeds the "Cannot reach the server" banner. */
  onUnreachable?: () => void;
  /** The per-session CSRF token from signIn/getSession; sent as X-CSRF-Token on every state-changing call. */
  getCsrfToken?: () => string | undefined;
  /** A signed-in call was answered 401: the session is gone (idle, absolute limit, deactivated, restart). */
  onUnauthorized?: (path: string) => void;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Typed client over the generated admin `paths` (src/generated, copied from api-specs). There is
 * deliberately no access token here (ADR-0013 V6): the browser sends its same-origin session
 * cookie and the admin backend attaches tokens server side. Mutations get an `Idempotency-Key`
 * from client-core (screens pass their own where a retry must reuse it) and the CSRF token from
 * the session. Tenant is never sent.
 */
export function createAdminApi<Paths extends object = paths>(options: AdminApiOptions = {}) {
  const base = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const tracked: typeof fetch = async (input, init) => {
    try {
      const res = await base(input, init);
      options.onReachable?.();
      return res;
    } catch (err) {
      if (err instanceof TypeError) options.onUnreachable?.();
      throw err;
    }
  };
  const api = createApiClient<Paths>({ baseUrl: options.baseUrl ?? "", fetch: tracked });
  api.use({
    onRequest({ request }) {
      const csrf = options.getCsrfToken?.();
      if (csrf && MUTATING.has(request.method)) request.headers.set("X-CSRF-Token", csrf);
      return request;
    },
    onResponse({ request, response }) {
      if (response.status === 401) options.onUnauthorized?.(new URL(request.url, "http://x").pathname);
      return response;
    },
  });
  return api;
}

export type AdminApi = ReturnType<typeof createAdminApi<paths>>;
