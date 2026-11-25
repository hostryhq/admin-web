import { describe, expect, it } from "vitest";
import { writeError } from "../../api/errors";
import { addDays, daysBetween, periodEnd, todayIst } from "../../components/dates";
import { looksPersonal } from "../../components/personal";
import { remainingText } from "../../components/remaining";
import type { components } from "../../generated";
import { awaitsExecution, isExecuting, notExecutedKey } from "./approvalExec";
import { inForce } from "./BillingConfig";
import { breakdownRows, isPartPaid, overdueDays } from "./chargeView";
import { checklist, firstUnmet, isLive, type Facts } from "./onboarding";
import { listPrice, sellable } from "./PlanStep";
import { nextPeriod } from "./RaiseChargeDialog";
import { applyEdit, checkResults, diffRows, earliestEffective, gridValues, leadTimeOk, previousGrid, unequalHalves, type TaxRule } from "./ruleset";
import { inForceRuleSet } from "./TaxRules";
import { bucketTotals } from "./WorkLists";

type S = components["schemas"];
const t = (k: string) => k;
const money = (n: number): S["Money"] => ({ amount_paise: n, currency: "INR" });

const rule = (over: Partial<TaxRule> = {}): TaxRule => ({
  tax_class: "fnb_standard",
  regime: "regular",
  specified_premises: false,
  order_channel: "dine_in",
  doc_type: "tax_invoice",
  gst_applies: true,
  cgst_bp: 250,
  sgst_bp: 250,
  igst_bp: 0,
  ...over,
});

describe("dates (business dates are plain dates, IST)", () => {
  it("a monthly period ends the day before the same day next month, clamped to short months", () => {
    expect(periodEnd("2026-12-01", "monthly")).toBe("2026-12-31");
    expect(periodEnd("2026-11-24", "monthly")).toBe("2026-12-23");
    expect(periodEnd("2027-01-31", "monthly")).toBe("2027-02-27"); // 31 Jan + 1 month clamps to 28 Feb, minus a day
  });
  it("an annual period is twelve months", () => {
    expect(periodEnd("2026-11-24", "annual")).toBe("2027-11-23");
  });
  it("date arithmetic is exact across month ends and leap years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-12-01", "2026-12-09")).toBe(8);
  });
  it("today is the IST date: 19:00 UTC is already the next day in India", () => {
    expect(todayIst(new Date("2026-11-24T19:00:00Z"))).toBe("2026-11-25");
    expect(todayIst(new Date("2026-11-24T05:00:00Z"))).toBe("2026-11-24");
  });
  it("the next charge period starts after paid_through, or on the start date for a first charge", () => {
    const sub = { cycle: "monthly", paid_through: "2026-12-31", start_date: "2026-12-01" } as S["Subscription"];
    expect(nextPeriod(sub)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(nextPeriod({ ...sub, paid_through: undefined } as S["Subscription"])).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });
});

describe("the ledger holds no personal data (AC 58)", () => {
  it("refuses notes that look like an email address or a phone number", () => {
    expect(looksPersonal("call asha@example.invalid")).toBe(true);
    expect(looksPersonal("phone +91 98765 43210")).toBe(true);
    expect(looksPersonal("9876543210")).toBe(true);
    expect(looksPersonal("Chase on call after the 5th")).toBe(false);
    expect(looksPersonal("Invoice INV/26/118, 2 outlets")).toBe(false);
  });
});

describe("charges are shown as the service computed them", () => {
  const charge = (over: Partial<S["Charge"]> = {}): S["Charge"] =>
    ({
      id: "c1",
      organisation_id: "o1",
      subscription_id: "s1",
      kind: "period",
      period_start: "2026-12-01",
      period_end: "2026-12-31",
      taxable: money(129900),
      cgst: money(11691),
      sgst: money(11691),
      igst: money(0),
      total: money(153282),
      due_date: "2026-12-08",
      status: "open",
      outstanding: money(153282),
      created_at: "2026-11-24T05:12:00.000Z",
      ...over,
    }) as S["Charge"];

  it("same-state shows CGST and SGST; other-state shows one IGST row; unregistered shows no GST rows (AC 28, 30)", () => {
    expect(breakdownRows(charge(), t).rows.map((r) => r.id)).toEqual(["taxable", "cgst", "sgst"]);
    expect(breakdownRows(charge({ cgst: money(0), sgst: money(0), igst: money(23382) }), t).rows.map((r) => r.id)).toEqual(["taxable", "igst"]);
    const none = breakdownRows(charge({ cgst: money(0), sgst: money(0), total: money(129900) }), t);
    expect(none.noGst).toBe(true);
    expect(none.rows.map((r) => r.id)).toEqual(["taxable"]);
  });
  it("part paid is an open charge with something paid and something left", () => {
    expect(isPartPaid(charge())).toBe(false);
    expect(isPartPaid(charge({ outstanding: money(50000) }))).toBe(true);
    expect(isPartPaid(charge({ outstanding: money(0), status: "paid" }))).toBe(false);
  });
  it("overdue is a label with an age: only an open charge with something outstanding, after its due date", () => {
    expect(overdueDays(charge(), "2026-12-16", daysBetween)).toBe(8);
    expect(overdueDays(charge(), "2026-12-08", daysBetween)).toBe(0);
    expect(overdueDays(charge({ status: "paid", outstanding: money(0) }), "2026-12-16", daysBetween)).toBe(0);
    expect(overdueDays(charge({ status: "waived" }), "2026-12-16", daysBetween)).toBe(0);
  });
  it("the overdue buckets add up to the listed rows (AC 56)", () => {
    const rows = [
      { age_days: 3, amount: money(420000) },
      { age_days: 8, amount: money(153282) },
      { age_days: 15, amount: money(100) },
      { age_days: 16, amount: money(200) },
      { age_days: 45, amount: money(300) },
    ].map((r, i) => ({ organisation_id: `o${i}`, organisation_name: `Org ${i}`, ...r }));
    const buckets = bucketTotals(rows);
    expect(buckets).toEqual([
      { id: "1-7", paise: 420000 },
      { id: "8-15", paise: 153382 },
      { id: "16-30", paise: 200 },
      { id: "30+", paise: 300 },
    ]);
    expect(buckets.reduce((n, b) => n + b.paise, 0)).toBe(rows.reduce((n, r) => n + r.amount.amount_paise, 0));
  });
});

describe("plans and configuration in force", () => {
  const plans = [
    { key: "table_service", name_key: "plan.table_service", created_at: "", versions: [{ version: 1, state: "retired", feature_keys: [], included_outlets: 1, prices: [{ cycle: "monthly", list_price: money(129900) }], created_at: "" }, { version: 2, state: "active", feature_keys: [], included_outlets: 1, prices: [{ cycle: "monthly", list_price: money(139900) }, { cycle: "annual", list_price: money(1399000) }], created_at: "" }] },
    { key: "counter", name_key: "plan.counter", created_at: "", versions: [{ version: 1, state: "draft", feature_keys: [], included_outlets: 1, prices: [], created_at: "" }] },
    { key: "pilot", name_key: "plan.pilot", created_at: "", versions: [{ version: 1, state: "active", feature_keys: [], included_outlets: 1, prices: [], created_at: "" }] },
  ] as S["Plan"][];

  it("only active versions can be assigned; the pilot plan is a separate choice (AC 20)", () => {
    const s = sellable(plans, (k) => k);
    expect(s.paid.map((p) => `${p.key}:${p.version}`)).toEqual(["table_service:2"]);
    expect(s.pilot?.key).toBe("pilot");
    expect(listPrice(s.paid[0], "monthly")).toBe(139900);
    expect(listPrice(s.paid[0], "annual")).toBe(1399000);
  });
  it("a draft only plan offers nothing to sell", () => {
    expect(sellable(plans.slice(1, 2), (k) => k)).toEqual({ pilot: undefined, paid: [] });
  });
  it("the GST configuration in force is the latest one that has started; a future one is not in force", () => {
    const cfg = (id: string, from: string) => ({ id, effective_from: from }) as S["BillingConfiguration"];
    const list = [cfg("a", "2026-04-01"), cfg("b", "2026-12-01"), cfg("c", "2027-04-01")];
    expect(inForce(list, "2026-11-30")?.id).toBe("a");
    expect(inForce(list, "2026-12-01")?.id).toBe("b");
    expect(inForce(list, "2025-01-01")).toBeUndefined();
  });
  it("the rule set in force is a published one whose date has come", () => {
    const set = (version: number, state: S["TaxRuleSetMaster"]["state"], date: string) => ({ id: `v${version}`, version, state, effective_date: date }) as S["TaxRuleSetMaster"];
    const list = [set(6, "published", "2025-07-01"), set(7, "published", "2026-04-01"), set(8, "signed", "2026-11-01"), set(9, "published", "2027-01-01")];
    expect(inForceRuleSet(list, "2026-11-24")?.version).toBe(7);
  });
});

describe("tax rule grid (BR-A1-80 to BR-A1-82)", () => {
  const rules = [rule(), rule({ specified_premises: true, cgst_bp: 900, sgst_bp: 900 }), rule({ tax_class: "fnb_non_gst", gst_applies: false, cgst_bp: 0, sgst_bp: 0 })];

  it("an edit changes one cell only and keeps whole basis points", () => {
    const next = applyEdit(rules, "r1", "cgst_bp", 600);
    expect(next[1]?.cgst_bp).toBe(600);
    expect(next[1]?.sgst_bp).toBe(900);
    expect(next[0]).toBe(rules[0]);
    expect(applyEdit(rules, "r1", "cgst_bp", undefined)).toEqual(rules); // a cleared or invalid cell changes nothing
    expect(applyEdit(rules, "r1", "tax_class", 5)).toEqual(rules); // only the rate columns are editable
  });
  it("points at rows whose CGST and SGST are not equal halves", () => {
    expect(unequalHalves(rules)).toEqual([]);
    expect(unequalHalves(applyEdit(rules, "r0", "sgst_bp", 300))).toEqual([0]);
  });
  it("the diff against the version in force lists exactly what moves, and marks a new mapping", () => {
    const inforce = [rule(), rule({ specified_premises: true, cgst_bp: 250, sgst_bp: 250 })];
    const rows = diffRows(rules, inforce, t);
    // r1 changed two rates; r2 is a new mapping, so every one of its three rates is listed as new.
    expect(rows.map((r) => r.id)).toEqual(["r1-cgst_bp", "r1-sgst_bp", "r2-cgst_bp", "r2-sgst_bp", "r2-igst_bp"]);
    expect(rows.find((r) => r.id === "r1-cgst_bp")).toMatchObject({ before: "250", after: "900" });
    expect(rows.find((r) => r.id === "r2-cgst_bp")?.before).toBe("admin.ruleset.diff.new");
    const prev = previousGrid(rules, inforce);
    expect(prev?.["r1:cgst_bp"]).toBe(250);
    expect(prev?.["r2:cgst_bp"]).toBeUndefined();
    expect(gridValues(rules)["r1:cgst_bp"]).toBe(900);
  });
  it("groups the service's validation errors into the four named checks", () => {
    const v: S["TaxRuleSetValidation"] = {
      valid: false,
      vectors_total: 212,
      vectors_passed: 210,
      errors: [
        { code: "missing_mapping", detail: "fnb_standard / composition has no rule" },
        { code: "unequal_halves", detail: "Row 4: 250 vs 300" },
        { code: "something_new", detail: "Unlisted" },
      ],
    };
    const r = checkResults(v);
    expect(r.byCheck.mapping).toEqual(["fnb_standard / composition has no rule"]);
    expect(r.byCheck.halves).toEqual(["Row 4: 250 vs 300"]);
    expect(r.byCheck.integer).toEqual([]);
    expect(r.byCheck.vectors).toEqual([""]); // 210 of 212 pass with no named error: the check still fails
    expect(r.other).toEqual(["Unlisted"]);
  });
});

describe("publication lead time (BR-A1-83, ADR-0014 A1.4)", () => {
  const now = new Date("2026-11-25T06:00:00Z"); // 11:30 IST
  it("the effective date takes effect at 00:00 IST and must be at least 24 hours ahead", () => {
    expect(earliestEffective(now).toISOString()).toBe("2026-11-26T06:00:00.000Z");
    expect(leadTimeOk("2026-11-26", now)).toBe(false); // 00:00 IST on the 26th is 18:30 UTC on the 25th: only 12.5 h ahead
    expect(leadTimeOk("2026-11-27", now)).toBe(true); // 18:30 UTC on the 26th is 36.5 h ahead
  });
  it("exactly 24 hours ahead is allowed; a minute less is not", () => {
    const start = Date.parse("2026-11-26T18:30:00Z"); // 00:00 IST on the 27th
    expect(leadTimeOk("2026-11-27", new Date(start - 24 * 3_600_000))).toBe(true);
    expect(leadTimeOk("2026-11-27", new Date(start - 24 * 3_600_000 + 60_000))).toBe(false);
  });
});

describe("approvals", () => {
  const a = (over: Partial<S["VendorApproval"]> = {}): S["VendorApproval"] =>
    ({ id: "a1", kind: "org_suspend", state: "approved", requested_by: "u1", ticket_reference: "SUP-1", verification_method: "other", created_at: "", expires_at: "", ...over }) as S["VendorApproval"];

  it("four kinds are executed by another service after approval; device revoke completes inside identity (P2C-1)", () => {
    for (const kind of ["org_suspend", "org_reinstate", "org_close", "tax_rule_set_publish"] as const) expect(isExecuting({ kind })).toBe(true);
    for (const kind of ["device_revoke_over_quota", "sign_in_code", "owner_recovery"] as const) expect(isExecuting({ kind })).toBe(false);
  });
  it("an approved executing kind that has not run waits for execution; a device revoke never does", () => {
    expect(awaitsExecution(a())).toBe(true);
    expect(awaitsExecution(a({ state: "completed" }))).toBe(false);
    expect(awaitsExecution(a({ kind: "device_revoke_over_quota" }))).toBe(false);
  });
  it("names why an approved action did not run: the guard code, or the reason of approval_not_executable", () => {
    expect(notExecutedKey({}, "open_trading_day")).toBe("admin.approvals.reason.open_trading_day");
    expect(notExecutedKey({ code: "approval_not_executable", reason: "lapsed" })).toBe("admin.approvals.reason.lapsed");
    expect(notExecutedKey({ code: "approval_not_executable" })).toBe("admin.approvals.reason.unknown");
    expect(notExecutedKey({})).toBe("admin.approvals.reason.unknown");
  });
  it("a request lapses when its time is up", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    expect(remainingText("2026-11-26T09:20:00Z", now)).toEqual({ expired: false, h: 23, min: 20 });
    expect(remainingText("2026-11-25T10:00:00Z", now).expired).toBe(true);
  });
});

describe("write errors never show server text and a dropped answer is 'result unknown'", () => {
  it("maps status and code to a key", () => {
    expect(writeError({ status: 0, network: true })).toBe("admin.write.unknown");
    expect(writeError({ status: 409, code: "duplicate_period" }, { duplicate_period: "k" })).toBe("k");
    expect(writeError({ status: 409 })).toBe("admin.error.conflict");
    expect(writeError({ status: 412 })).toBe("admin.error.changed");
    expect(writeError({ status: 422 })).toBe("admin.error.invalid");
    expect(writeError({ status: 503 })).toBe("admin.error.upstream");
    expect(writeError({ status: 403 })).toBe("admin.error.forbidden");
  });
});

describe("go-live checklist (BR-A1-4 to BR-A1-6)", () => {
  const org = (over: Partial<S["OrganisationDetailView"]> = {}): S["OrganisationDetailView"] =>
    ({
      organisation: { id: "o", name: "Anand", status: "trial", outlet_count: 1, created_at: "2026-11-18T05:00:00Z" },
      brands: [],
      outlets: [],
      registrations: [{ id: "r", legal_name: "Anand Foods", regime: "regular", gstin: "33ABCDE1234F1Z5", state_code: "33", verification_state: "unverified", status: "open" }],
      owner_status: "pending",
      onboarding_state: "complete",
      owner_invitations: [],
      ...over,
    }) as S["OrganisationDetailView"];
  const facts = (o: S["OrganisationDetailView"], over: Partial<Facts> = {}): Facts => ({ org: o, subscription: { current: undefined, history: [] }, devices: [], ...over });
  const state = (f: Facts, id: string) => checklist(f).find((i) => i.id === id)?.state;

  it("the first unmet item is the first not done that is not informational", () => {
    expect(firstUnmet(checklist(facts(org())))?.id).toBe("C2");
  });
  it("billing device is blocked while the GSTIN is unverified, and not merely missing once it is verified", () => {
    expect(state(facts(org()), "C6")).toBe("blocked");
    const verified = org({ registrations: [{ id: "r", legal_name: "A", regime: "regular", state_code: "33", verification_state: "verified", status: "open" }] });
    expect(state(facts(verified), "C2")).toBe("done");
    expect(state(facts(verified), "C6")).toBe("notyet");
    expect(state(facts(verified, { devices: [{ id: "d", kind: "pos", outlet_id: "x", state: "active", registered_at: "2026-11-20T00:00:00Z", billing_capable: true }] }), "C6")).toBe("done");
  });
  it("an unregistered organisation needs no verification", () => {
    const unreg = org({ registrations: [{ id: "r", legal_name: "A", regime: "unregistered", state_code: "33", verification_state: "unverified", status: "open" }] });
    expect(state(facts(unreg), "C2")).toBe("done");
  });
  it("what the viewer may not read is unknown, never 'not yet'", () => {
    expect(state(facts(org(), { subscription: "denied", devices: "denied" }), "C4")).toBe("unknown");
    expect(state(facts(org(), { devices: "denied" }), "C5")).toBe("unknown");
  });
  it("the panel never says an organisation is live while the first synced bill cannot be read (C7)", () => {
    const verified = org({ owner_status: "accepted", registrations: [] });
    const f = facts(verified, { devices: [{ id: "d", kind: "pos", outlet_id: "x", state: "active", registered_at: "2026-11-20T00:00:00Z", billing_capable: true }] });
    expect(isLive(checklist(f))).toBe(false);
  });
});
