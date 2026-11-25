import { describe, expect, it } from "vitest";
import { createAdminApi } from "../api/client";
import { mut } from "../api/headers";
import { outcome } from "../api/outcome";
import { findById, mount } from "./harness";

/**
 * Admin A1 against the REAL svc-admin double (skipped unless ADMIN_DOUBLE_URL is set; see
 * live-double.test.ts). It proves the generated A1 types and the browser-visible rules hold against the
 * real handler: billing reads and writes, the work lists, the two-person approval and its single-use
 * execution (a second try answers 409 approval_not_executable with the reason).
 *
 *   (cd ../svc-admin && go run ./cmd/admin-double -addr 127.0.0.1:18431) &
 *   ADMIN_DOUBLE_URL=http://127.0.0.1:18431 pnpm vitest run src/test/live-double-a1.test.ts
 */
const base = process.env.ADMIN_DOUBLE_URL;
const ORG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";
const CHARGE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f8021";

const liveFetch: typeof fetch = (input, init) => {
  const req = input instanceof Request ? input : new Request(input, init);
  req.headers.set("Cookie", "__Host-hostry-admin=double-seed-session");
  req.headers.set("Origin", base ?? "");
  return fetch(req);
};

describe.skipIf(!base)("live svc-admin double: Admin A1", () => {
  async function api() {
    const held: { csrf?: string } = {};
    const a = createAdminApi({ baseUrl: base ?? "", fetch: liveFetch, getCsrfToken: () => held.csrf });
    const s = await outcome(a.GET("/v1/sessions/current"));
    if (!s.ok) throw new Error("no session");
    held.csrf = s.data.csrf_token;
    return a;
  }

  it("reads plans, the billing configuration, a subscription and the charges with the generated shapes", async () => {
    const a = await api();
    const plans = await outcome(a.GET("/v1/plans", { params: { query: { limit: 25 } } }));
    expect(plans.ok && plans.data.items[0]?.versions[0]?.prices[0]?.list_price.currency).toBe("INR");
    const cfg = await outcome(a.GET("/v1/billing-configurations", { params: { query: {} } }));
    expect(cfg.ok && cfg.data.items[0]?.gst_rate_bp).toBe(1800);
    const sub = await outcome(a.GET("/v1/organisations/{organisation_id}/subscription", { params: { path: { organisation_id: ORG } } }));
    expect(sub.ok && sub.data.current?.plan_key).toBe("table_service");
    const charges = await outcome(a.GET("/v1/organisations/{organisation_id}/charges", { params: { path: { organisation_id: ORG }, query: {} } }));
    expect(charges.ok && charges.data.items[0]?.total.amount_paise).toBe(153282);
  });

  it("raises a charge and records a payment in integer paise, with CSRF and an idempotency key", async () => {
    const a = await api();
    const raised = await outcome(
      a.POST("/v1/organisations/{organisation_id}/charges", { params: { path: { organisation_id: ORG }, header: mut() }, body: { kind: "period", period_start: "2026-12-01", period_end: "2026-12-31" } }),
    );
    expect(raised.ok && Number.isInteger(raised.data.total.amount_paise)).toBe(true);
    const paid = await outcome(
      a.POST("/v1/organisations/{organisation_id}/charges/{charge_id}/payments", {
        params: { path: { organisation_id: ORG, charge_id: CHARGE }, header: mut() },
        body: { amount: { amount_paise: 153282, currency: "INR" }, method: "upi", reference: "UTR1", received_on: "2026-12-02" },
      }),
    );
    expect(paid.ok && paid.data.method).toBe("upi");
  });

  it("serves the six work lists and the ledger CSV", async () => {
    const a = await api();
    for (const kind of ["overdue_charges", "charges_to_raise", "charges_without_invoice_reference", "pilots_ending", "retired_version_subscriptions", "outlets_over_limit"] as const) {
      const r = await outcome(a.GET("/v1/ledger-lists/{list_kind}", { params: { path: { list_kind: kind }, query: {} } }));
      expect(r.ok).toBe(true);
    }
    const csv = await outcome(a.GET("/v1/ledger-exports", { params: { query: { from: "2026-11-01", to: "2026-11-30" } }, parseAs: "text" }));
    expect(csv.ok && String(csv.data)).toContain("organisation_id,organisation_name");
  });

  it("an approval executes once: the second try is 409 approval_not_executable (reason executed), and no grant is in any answer", async () => {
    const a = await api();
    const id = crypto.randomUUID(); // a fresh approval each run: the double remembers executed ones
    const body = { approval_id: id, ticket: "SUP-2050", reason: "Owner asked in writing to pause the account." };
    const first = await outcome(a.POST("/v1/organisations/{organisation_id}/suspension", { params: { path: { organisation_id: ORG }, header: mut() }, body }));
    expect(first.ok && first.data.status).toBe("suspended");
    expect(JSON.stringify(first)).not.toMatch(/grant/i);
    const second = await outcome(a.POST("/v1/organisations/{organisation_id}/suspension", { params: { path: { organisation_id: ORG }, header: mut() }, body }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.failure.status).toBe(409);
      expect(second.failure.code).toBe("approval_not_executable");
      expect(second.failure.reason).toBe("executed");
    }
  });

  it("the seed session is a support role: the app boots from its cookie and refuses the billing pages by permission", async () => {
    mount("/plans", { session: null, fetch: liveFetch, baseUrl: base ?? "" });
    expect(await findById("forbidden")).toBeTruthy();
  });
});
