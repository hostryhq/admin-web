import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { problem, recorded } from "../../test/mockAdmin";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../../test/harness";
import { BILLING_CONFIGS, config, money } from "../../test/a1";
import type { components } from "../../generated";

type S = components["schemas"];
const READ = ["admin.org.read", "admin.subscription.read"];
const MANAGE = [...READ, "admin.plan.manage"];
const PLAN = (state: S["PlanVersionState"], version = 1): S["Plan"] =>
  ({
    key: "table_service",
    name_key: "plan.table_service",
    created_at: "2026-11-24T00:00:00Z",
    versions: [{ version, state, feature_keys: ["restaurant.core", "restaurant.kds"], included_outlets: 2, prices: [{ cycle: "monthly", list_price: money(129900) }, { cycle: "annual", list_price: money(1299000) }], created_at: "2026-11-24T00:00:00Z" }],
  }) as S["Plan"];

describe("plans (AS07, AS08)", () => {
  it("without admin.plan.manage the table has no buttons; drafts say they cannot be assigned (AC 15, 20, 106)", async () => {
    const { mock } = mount("/plans", { session: sessionOf(READ) });
    mock.on("GET /v1/plans", { status: 200, body: { items: [PLAN("draft")] } });
    await until(() => expect(byId("plans-table").textContent).toContain("Table service"));
    expect(byId("plans-table").textContent).toContain("₹1,299.00");
    expect(byId("plans-table").textContent).toContain("₹12,990.00");
    expect(byId("plans-draftnote").textContent).toContain("cannot be assigned until a platform admin activates it");
    expect(queryById("plans-new")).toBeNull();
    expect(byId("plans-table").querySelectorAll("button")).toHaveLength(0);
  });

  it("empty and failing reads", async () => {
    const empty = mount("/plans", { session: sessionOf(MANAGE) });
    empty.mock.on("GET /v1/plans", { status: 200, body: { items: [] } });
    await findById("plans-empty");
    expect(queryById("plans-new")).not.toBeNull();
    document.body.innerHTML = "";
    const bad = mount("/plans", { session: sessionOf(MANAGE) });
    bad.mock.on("GET /v1/plans", problem(503, "upstream_unavailable"));
    await findById("plans-error");
  });

  it("a draft version can be activated after one confirmation that says it cannot be edited afterwards (AC 16)", async () => {
    const { mock } = mount("/plans/table_service/versions/1", { session: sessionOf(MANAGE) });
    mock.on("GET /v1/plans/{plan_key}", { status: 200, body: PLAN("draft") });
    await findById("version-activate");
    expect(byId("version-readonly").textContent).toContain("restaurant.kds");
    click("version-activate");
    expect((await findById("activate-dialog")).textContent).toContain("An active version cannot be edited");
    click("activate-dialog-submit");
    await until(() => expect(mock.callsOf("POST /v1/plans/{plan_key}/versions/{version}/activation")).toHaveLength(1));
    expect(mock.callsOf("POST /v1/plans/{plan_key}/versions/{version}/activation")[0]?.path).toBe("/v1/plans/table_service/versions/1/activation");
  });

  it("an active version is read-only: no activate, but New version from this and Retire (AC 16, 18)", async () => {
    const { mock } = mount("/plans/table_service/versions/1", { session: sessionOf(MANAGE) });
    mock.on("GET /v1/plans/{plan_key}", { status: 200, body: PLAN("active") });
    await findById("version-immutable");
    expect(queryById("version-activate")).toBeNull();
    expect(queryById("version-newfrom")).not.toBeNull();
    click("version-retire");
    expect((await findById("retire-dialog")).textContent).toContain("Existing subscriptions keep this version.");
    click("retire-dialog-submit");
    await until(() => expect(mock.callsOf("POST /v1/plans/{plan_key}/versions/{version}/retirement")).toHaveLength(1));
  });

  it("someone without plan.manage sees the version with no action at all", async () => {
    const { mock } = mount("/plans/table_service/versions/1", { session: sessionOf(READ) });
    mock.on("GET /v1/plans/{plan_key}", { status: 200, body: PLAN("draft") });
    await findById("version-readonly");
    for (const id of ["version-activate", "version-retire", "version-newfrom"]) expect(queryById(id)).toBeNull();
  });

  it("a new plan is saved as a draft with integer paise; the plan key and prices are checked first (AC 15, 17)", async () => {
    const { mock } = mount("/plans/new", { session: sessionOf(MANAGE) });
    await findById("version-form");
    const save = byId("version-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    type("version-key", "Bad Key");
    expect(byId("version-form").textContent).toContain("Lower case letters");
    type("version-key", "counter_pro");
    type("version-monthly-input", "999.50");
    type("version-annual-input", "9,995");
    expect(save.disabled).toBe(false);
    fireEvent.keyDown(byId("version-key"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf("POST /v1/plans")).toHaveLength(1));
    expect(mock.callsOf("POST /v1/plans")[0]?.body).toEqual({
      key: "counter_pro",
      name_key: "plan.counter_pro",
      version: {
        feature_keys: ["restaurant.core"],
        included_outlets: 1,
        prices: [
          { cycle: "monthly", list_price: { amount_paise: 99950, currency: "INR" } },
          { cycle: "annual", list_price: { amount_paise: 999500, currency: "INR" } },
        ],
      },
    });
  });

  it("a plan with no price cannot be saved, and a price cannot be negative or fractional paise", async () => {
    mount("/plans/new", { session: sessionOf(MANAGE) });
    await findById("version-form");
    type("version-key", "counter_pro");
    expect((byId("version-save") as HTMLButtonElement).disabled).toBe(true);
    type("version-monthly-input", "-5");
    expect(byId("version-form").textContent).toContain("Enter an amount like 250");
    type("version-monthly-input", "10.999");
    expect((byId("version-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("a stranger without plan.manage cannot reach the editor by URL", async () => {
    mount("/plans/new", { session: sessionOf(READ) });
    expect(await findById("forbidden")).toBeTruthy();
  });
});

describe("billing configuration (AS09)", () => {
  it("is read-only without admin.plan.manage: history only, no form (AC 106)", async () => {
    const { mock } = mount("/billing-configuration", { session: sessionOf(READ) });
    mock.on(BILLING_CONFIGS, { status: 200, body: { items: [config()] } });
    await findById("billcfg-table");
    await until(() => expect(byId("billcfg-table").textContent).toContain("18%"));
    expect(queryById("billcfg-form")).toBeNull();
    expect(byId("billcfg-table").textContent).toContain("997331");
    expect(byId("billcfg-table").textContent).toContain("₹0.99");
  });

  it("saving adds a new effective-dated version with the rate in basis points; a past date is not accepted (AC 29, 30)", async () => {
    const { mock } = mount("/billing-configuration", { session: sessionOf(MANAGE) });
    mock.on(BILLING_CONFIGS, { status: 200, body: { items: [config()] } });
    await findById("billcfg-form");
    await until(() => expect((byId("billcfg-rate") as HTMLInputElement).value).toBe("1800"));
    expect(byId("billcfg-rate-percent").textContent).toContain("18");
    type("billcfg-effective", "2020-01-01");
    expect((byId("billcfg-save") as HTMLButtonElement).disabled).toBe(true);
    type("billcfg-effective", "2099-01-01");
    type("billcfg-rate", "1200");
    type("billcfg-tolerance", "1.50");
    expect((byId("billcfg-save") as HTMLButtonElement).disabled).toBe(false);
    click("billcfg-save");
    await until(() => expect(mock.callsOf("POST /v1/billing-configurations")).toHaveLength(1));
    expect(mock.callsOf("POST /v1/billing-configurations")[0]?.body).toMatchObject({
      effective_from: "2099-01-01",
      gst_rate_bp: 1200,
      gst_registered: true,
      payment_tolerance_paise: 150,
      sac: "997331",
    });
  });

  it("not registered for GST sends a rate of 0 and hides the rate field", async () => {
    const { mock } = mount("/billing-configuration", { session: sessionOf(MANAGE) });
    mock.on(BILLING_CONFIGS, { status: 200, body: { items: [config()] } });
    await findById("billcfg-form");
    type("billcfg-effective", "2099-01-01");
    click("billcfg-registered-no");
    expect(queryById("billcfg-rate")).toBeNull();
    click("billcfg-save");
    await until(() => expect(mock.callsOf("POST /v1/billing-configurations")).toHaveLength(1));
    expect(mock.callsOf("POST /v1/billing-configurations")[0]?.body).toMatchObject({ gst_registered: false, gst_rate_bp: 0 });
  });
});

describe("work lists (AS15)", () => {
  const row = (i: number, age: number, paise: number) => ({
    organisation_id: `0190a1b2-c3d4-7e5f-8a9b-00000000000${i}`,
    organisation_name: `Org ${i}`,
    subject_id: `0190a1b2-c3d4-7e5f-8a9b-10000000000${i}`,
    due_date: "2026-12-01",
    age_days: age,
    amount: money(paise),
  });

  it("the overdue buckets add up to the listed rows, and no list has a suspend or lapse action (AC 38, 55, 56, 57)", async () => {
    const { mock } = mount("/lists", { session: sessionOf(READ) });
    mock.on("GET /v1/ledger-lists/{list_kind}", (r) => ({ status: 200, body: { items: r.params.list_kind === "overdue_charges" ? [row(1, 3, 420000), row(2, 9, 153282), row(3, 40, 1000)] : [] } }));
    await until(() => expect(screen.getAllByTestId(/^lists-open-/)).toHaveLength(3));
    expect(byId("lists-bucket-1-7").textContent).toContain("₹4,200.00");
    expect(byId("lists-bucket-8-15").textContent).toContain("₹1,532.82");
    expect(byId("lists-bucket-30+").textContent).toContain("₹10.00");
    expect(byId("lists-bucket-total").textContent).toContain("₹5,742.82"); // 420000 + 153282 + 1000 paise
    expect(document.body.textContent).toContain("Nothing is sent and nothing is switched off automatically. People chase.");
    expect(document.body.textContent).not.toMatch(/\b(Suspend|Lapse)\b/);
  });

  it("each of the six lists is a tab with a count, and an empty list says there is nothing to do", async () => {
    const { mock } = mount("/lists", { session: sessionOf(READ) });
    mock.on("GET /v1/ledger-lists/{list_kind}", (r) => ({ status: 200, body: { items: r.params.list_kind === "pilots_ending" ? [row(1, 0, 0)] : [] } }));
    await until(() => expect(byId("lists-tab-pilots_ending").textContent).toContain("(1)"));
    for (const k of ["overdue_charges", "charges_to_raise", "charges_without_invoice_reference", "pilots_ending", "retired_version_subscriptions", "outlets_over_limit"]) {
      expect(queryById(`lists-tab-${k}`)).not.toBeNull();
    }
    expect((await findById("lists-empty")).textContent).toContain("Nothing to do here.");
  });

  it("a failing list shows Retry; Reports is offered only to those who may export", async () => {
    const { mock } = mount("/lists", { session: sessionOf(READ) });
    mock.on("GET /v1/ledger-lists/{list_kind}", problem(503, "upstream_unavailable"));
    await findById("lists-error");
    expect(queryById("lists-reports")).toBeNull();
    document.body.innerHTML = "";
    mount("/lists", { session: sessionOf([...READ, "admin.report.ledger"]) });
    await findById("lists-reports");
  });

  it("charges to raise open the raise dialog on the organisation's charges (AC 39)", async () => {
    const { mock } = mount("/lists/charges_to_raise", { session: sessionOf([...READ, "admin.subscription.manage"]) });
    mock.on("GET /v1/ledger-lists/{list_kind}", (r) => ({ status: 200, body: { items: r.params.list_kind === "charges_to_raise" ? [row(1, 0, 0)] : [] } }));
    await until(() => expect(screen.getAllByTestId(/^lists-open-/)).toHaveLength(1));
    click(screen.getAllByTestId(/^lists-open-/)[0]?.getAttribute("data-testid") ?? "");
    await findById("org-charges");
  });
});

describe("ledger CSV (AS16)", () => {
  it("needs admin.report.ledger; asks for the range and downloads the file the service returns (AC 60)", async () => {
    mount("/reports", { session: sessionOf(READ) });
    expect(await findById("forbidden")).toBeTruthy();
    document.body.innerHTML = "";
    const created: Blob[] = [];
    const url = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      created.push(b as Blob);
      return "blob:test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { mock } = mount("/reports", { session: sessionOf([...READ, "admin.report.ledger"]) });
    await findById("ledger-form");
    type("ledger-from", "2026-11-01");
    type("ledger-to", "2026-11-30");
    click("ledger-export");
    await findById("ledger-done");
    expect(mock.callsOf("GET /v1/ledger-exports")[0]?.query).toContain("from=2026-11-01");
    expect(mock.callsOf("GET /v1/ledger-exports")[0]?.query).toContain("to=2026-11-30");
    expect(created).toHaveLength(1);
    expect(await created[0]?.text()).toBe(String(recorded("exportLedger")));
    expect(byId("ledger-form").textContent).toContain("no GSTIN, phone number or email");
    url.mockRestore();
  });

  it("a range that ends before it starts cannot be exported", async () => {
    mount("/reports", { session: sessionOf([...READ, "admin.report.ledger"]) });
    await findById("ledger-form");
    type("ledger-from", "2026-11-20");
    type("ledger-to", "2026-11-10");
    expect((byId("ledger-export") as HTMLButtonElement).disabled).toBe(true);
  });
});
