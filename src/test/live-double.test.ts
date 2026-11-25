import { describe, expect, it } from "vitest";
import { createAdminApi } from "../api/client";
import { outcome } from "../api/outcome";
import { mut } from "../api/headers";
import { byId, findById, mount, until } from "./harness";

/**
 * Smoke test against the REAL svc-admin test double running as a local process. Skipped unless
 * ADMIN_DOUBLE_URL is set, because CI has neither Go nor the private svc-admin repository (the
 * component tests replay a recording of this double instead: scripts/record-double.mjs).
 *
 *   (cd ../svc-admin && go run ./cmd/admin-double -addr 127.0.0.1:18431) &
 *   ADMIN_DOUBLE_URL=http://127.0.0.1:18431 pnpm vitest run src/test/live-double.test.ts
 *
 * It proves the generated types, the CSRF/Origin/Idempotency rules and the session cookie work
 * against the real handler, not only against the recording. The double's cookie is `Secure`, which
 * node's fetch has no jar for, so the seed cookie is sent by hand.
 */
const base = process.env.ADMIN_DOUBLE_URL;
const ORIGIN = base ?? "";
const SEED = "__Host-hostry-admin=double-seed-session";

const liveFetch: typeof fetch = (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  req.headers.set("Cookie", SEED);
  req.headers.set("Origin", ORIGIN);
  return fetch(req);
};

describe.skipIf(!base)("live svc-admin double", () => {
  const api = () => {
    let csrf: string | undefined;
    const a = createAdminApi({ baseUrl: base ?? "", fetch: liveFetch, getCsrfToken: () => csrf });
    return {
      a,
      async session() {
        const r = await outcome(a.GET("/v1/sessions/current"));
        if (!r.ok) throw new Error("no session");
        csrf = r.data.csrf_token;
        return r.data;
      },
    };
  };

  it("restores the seed session and lists organisations with the generated shapes", async () => {
    const { a, session } = api();
    const s = await session();
    expect(s.user.permissions).toContain("admin.org.read");
    const list = await outcome(a.GET("/v1/organisations", { params: { query: { limit: 25 } } }));
    expect(list.ok && list.data.items[0]?.name).toBeTruthy();
  });

  it("refuses a state-changing call without the CSRF token (403) and accepts it with the token", async () => {
    const { a, session } = api();
    const org = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";
    const device = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e";
    const body = { ticket_reference: "SUP-2041", reason: "Owner phoned to report a lost tablet.", verification_method: "callback_to_registered_number" as const, confirm: true as const };
    const call = () =>
      outcome(a.PUT("/v1/organisations/{organisation_id}/devices/{device_id}/revocation", { params: { path: { organisation_id: org, device_id: device }, header: mut() }, body }));
    const before = await call(); // no session fact yet: no CSRF token is sent
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.failure.status).toBe(403);
    await session();
    const after = await call();
    expect(after.ok && after.data.outcome).toBe("revoked");
  });

  it("the whole app boots from the cookie and shows the organisation list", async () => {
    mount("/organisations", { session: null, fetch: liveFetch, baseUrl: base ?? "" });
    await findById("orgs-table");
    await until(() => expect(byId("orgs-table").textContent).toContain("Example Hospitality"));
  });

  it("never accepts an Authorization header (the admin API takes the cookie only)", async () => {
    const res = await liveFetch(`${base}/v1/organisations`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(401);
  });
});
