import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { problem } from "../../test/mockAdmin";
import { detail, orgList, summary } from "../../test/data";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../../test/harness";
import { ORG, money } from "../../test/a1";
import type { components } from "../../generated";

type S = components["schemas"];
const LIST = "GET /v1/organisations";
const DETAIL = "GET /v1/organisations/{organisation_id}";
const PLANS = "GET /v1/plans";
const START = "POST /v1/organisations/{organisation_id}/subscription";
const DEVICES = "GET /v1/organisations/{organisation_id}/devices";
const ONBOARD = `${ORG}/onboarding`;

const reg = (state: S["DirectoryRegistration"]["verification_state"], regime: S["TaxRegime"] = "regular"): S["DirectoryRegistration"] => ({
  id: `reg-${state}`,
  legal_name: "Anand Foods Pvt Ltd",
  regime,
  ...(regime === "unregistered" ? {} : { gstin: "33ABCDE1234F1Z5" }),
  state_code: "33",
  verification_state: state,
  status: "open",
});

const version = (state: S["PlanVersionState"], version: number, prices: S["PlanPrice"][]): S["PlanVersion"] =>
  ({ version, state, feature_keys: ["restaurant.core"], included_outlets: 1, prices, created_at: "2026-11-24T00:00:00Z" }) as S["PlanVersion"];

const plans = (): S["PlanPage"] => ({
  items: [
    {
      key: "table_service",
      name_key: "plan.table_service",
      created_at: "2026-11-24T00:00:00Z",
      versions: [version("active", 1, [{ cycle: "monthly", list_price: money(129900) }, { cycle: "annual", list_price: money(1299000) }]), version("draft", 2, [])],
    },
    { key: "pilot", name_key: "plan.pilot", created_at: "2026-11-24T00:00:00Z", versions: [version("active", 1, [])] },
  ],
});

const VERIFIER = ["admin.org.read", "admin.registration.verify", "admin.subscription.start", "admin.subscription.read"];

describe("onboarding board (AS01)", () => {
  it("lists organisations that are not live, oldest first, with the first unmet item, and nothing assigned to anyone (BR-A1-7, 8)", async () => {
    const { mock } = mount("/onboarding", { session: sessionOf(["admin.org.read"]) });
    mock.on(LIST, (r) =>
      r.query.get("has_unverified_registration") === "true"
        ? { status: 200, body: orgList([summary(3, { name: "Green Leaf Cafe" })]) }
        : {
            status: 200,
            body: orgList([
              summary(1, { name: "Newer", created_at: "2026-11-22T05:00:00.000Z", owner_status: "accepted" }),
              summary(2, { name: "Older", created_at: "2026-11-18T05:00:00.000Z", owner_status: "pending" }),
              summary(3, { name: "Green Leaf Cafe", created_at: "2026-11-20T05:00:00.000Z", owner_status: "accepted" }),
            ]),
          },
    );
    await until(() => expect(screen.getAllByTestId("board-org")).toHaveLength(3));
    expect(screen.getAllByTestId("board-org").map((e) => e.textContent)).toEqual(["Older", "Green Leaf Cafe", "Newer"]);
    expect(byId("board-table").textContent).toContain("C3 Owner accepted the invitation"); // Older: owner pending
    expect(byId("board-table").textContent).toContain("C2 Tax registration verified"); // Green Leaf: unverified registration
    expect(byId("board-table").textContent).toContain("C4 Plan assigned"); // Newer: nothing else unmet
    expect(byId("board-table").textContent).not.toMatch(/assign(ed)? to/i);
    expect(document.body.textContent).toContain("Nothing here is assigned to a person.");
    expect(mock.callsOf(LIST)[0]?.query).toContain("status=trial");
  });

  it("when identity is down the item reads Unknown and a notice says why", async () => {
    const { mock } = mount("/onboarding", { session: sessionOf(["admin.org.read"]) });
    mock.on(LIST, (r) =>
      r.query.get("has_unverified_registration") === "true"
        ? { status: 200, body: orgList([]) }
        : { status: 200, body: orgList([summary(1)], { owner_status_available: false }) },
    );
    await findById("board-identity-down");
    await until(() => expect(byId("board-table").textContent).toContain("Unknown"));
  });

  it("an empty board says every organisation is live; a failing read shows Retry and no rows", async () => {
    const empty = mount("/onboarding", { session: sessionOf(["admin.org.read"]) });
    empty.mock.on(LIST, { status: 200, body: orgList([]) });
    expect((await findById("board-empty")).textContent).toContain("Every organisation is live.");
    document.body.innerHTML = "";
    const failing = mount("/onboarding", { session: sessionOf(["admin.org.read"]) });
    failing.mock.on(LIST, problem(503, "upstream_unavailable"));
    await findById("board-error");
    expect(queryById("board-table")).toBeNull();
  });

  it("New organisation is offered only to those who may create one", async () => {
    mount("/onboarding", { session: sessionOf(["admin.org.read"]) });
    await findById("board-table");
    expect(queryById("board-new")).toBeNull();
  });
});

describe("unverified registrations (AS04)", () => {
  it("only verifiers get the control; support and billing read the list", async () => {
    const { mock } = mount("/onboarding/unverified", { session: sessionOf(["admin.org.read"]) });
    mock.on(LIST, { status: 200, body: orgList([summary(1, { name: "Anand Bhavan" })]) });
    await until(() => expect(byId("queue-table").textContent).toContain("Anand Bhavan"));
    expect(screen.queryAllByTestId(/^queue-review-/)).toHaveLength(0);
    expect(mock.callsOf(LIST)[0]?.query).toContain("has_unverified_registration=true");
    document.body.innerHTML = "";
    const v = mount("/onboarding/unverified", { session: sessionOf(VERIFIER) });
    v.mock.on(LIST, { status: 200, body: orgList([summary(1, { name: "Anand Bhavan" })]) });
    await until(() => expect(screen.getAllByTestId(/^queue-review-/)).toHaveLength(1));
  });
});

describe("wizard step 2: GSTIN (AS03)", () => {
  it("a verifier sees Verify and Reject for an unverified registration, and Do this later keeps it in the queue (AC 11; P2D-12)", async () => {
    const { mock } = mount(`${ONBOARD}/gstin`, { session: sessionOf(VERIFIER) });
    mock.on(DETAIL, { status: 200, body: detail({ registrations: [reg("unverified")] }) });
    await findById("verify-unverified");
    expect(byId("verify-gstin").textContent).toBe("33ABCDE1234F1Z5");
    expect(byId("wizard-stepper").textContent).toContain("GSTIN");
    expect(screen.getAllByTestId(/^verify-open-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^reject-open-/)).toHaveLength(1);
    expect(queryById("verify-later")).not.toBeNull();
    // The GSTIN step does not read devices (that read is audited).
    expect(mock.callsOf(DEVICES)).toHaveLength(0);
  });

  it("someone who may not verify sees 'for a registration verifier', no buttons, and can still go on (AC 5, 11)", async () => {
    const { mock } = mount(`${ONBOARD}/gstin`, { session: sessionOf(["admin.org.read", "admin.subscription.read"]) });
    mock.on("GET /v1/organisations/{organisation_id}/subscription", { status: 200, body: { history: [] } });
    expect((await findById("verify-forrole")).textContent).toContain("For a registration verifier");
    expect(screen.queryAllByTestId(/^(verify|reject)-open-/)).toHaveLength(0);
    expect(queryById("verify-continue")).not.toBeNull();
    expect(byId("wizard-reason-plan").textContent).toContain("another role"); // the plan step is locked for this user
  });

  it("rejecting needs a reason of 10 characters and calls the rejection operation", async () => {
    const { mock } = mount(`${ONBOARD}/gstin`, { session: sessionOf(VERIFIER) });
    mock.on(DETAIL, { status: 200, body: detail({ registrations: [reg("unverified")] }) });
    await findById("reject-open-reg-unverified");
    click("reject-open-reg-unverified");
    await findById("reject-registration");
    const submit = byId("reject-registration-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("reject-registration-reason", "The GSTIN does not match the legal name.");
    expect(submit.disabled).toBe(false);
    click("reject-registration-submit");
    await until(() => expect(mock.callsOf("PUT /v1/organisations/{organisation_id}/tax-registrations/{registration_id}/rejection")).toHaveLength(1));
    expect(mock.callsOf("PUT /v1/organisations/{organisation_id}/tax-registrations/{registration_id}/rejection")[0]?.body).toEqual({ reason: "The GSTIN does not match the legal name." });
  });

  it("an unregistered organisation has nothing to verify and no Verify button (A0 AC 73)", async () => {
    const { mock } = mount(`${ONBOARD}/gstin`, { session: sessionOf(VERIFIER) });
    mock.on(DETAIL, { status: 200, body: detail({ registrations: [reg("unverified", "unregistered")] }) });
    await findById("verify-done");
    expect(screen.queryAllByTestId(/^verify-open-/)).toHaveLength(0);
  });
});

describe("wizard step 3: plan and terms (AS05)", () => {
  async function open(session = sessionOf([...VERIFIER, "admin.subscription.manage"]), subscription: object = { history: [] }) {
    const m = mount(`${ONBOARD}/plan`, { session });
    m.mock.on(PLANS, { status: 200, body: plans() });
    m.mock.on("GET /v1/organisations/{organisation_id}/subscription", { status: 200, body: subscription });
    await findById("plan-form");
    return m;
  }

  it("a pilot is the default: review date 90 days out, no charge, and cycle 'none' is sent (AC 2, 23)", async () => {
    const { mock } = await open();
    expect(byId("plan-type-pilot")).toBeTruthy();
    expect((byId("plan-review") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.keyDown(byId("plan-review"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf(START)).toHaveLength(1));
    const sent = mock.callsOf(START)[0];
    expect(sent?.body).toMatchObject({ plan_key: "pilot", plan_version: 1, cycle: "none" });
    expect((sent?.body as { review_date: string }).review_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent?.body).not.toHaveProperty("agreed_price");
    expect((await findById("plan-saved")).textContent).toContain("Pilot saved. No charge.");
  });

  it("paid lists only ACTIVE versions (a draft cannot be assigned), shows the list price and sends integer paise (AC 20, 25)", async () => {
    const { mock } = await open();
    click("plan-type-paid");
    await findById("plan-version");
    const options = Array.from((byId("plan-version") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Table service v1"]); // v2 is a draft, the pilot plan is its own choice
    expect(byId("plan-list").textContent).toContain("₹1,299.00");
    click("plan-save");
    await until(() => expect(mock.callsOf(START)).toHaveLength(1));
    expect(mock.callsOf(START)[0]?.body).toMatchObject({ plan_key: "table_service", plan_version: 1, cycle: "monthly" });
    expect(mock.callsOf(START)[0]?.body).not.toHaveProperty("reason");
  });

  it("an agreed price below list needs a platform admin: without adjust it cannot be saved; with adjust it needs a reason (AC 26)", async () => {
    await open();
    click("plan-type-paid");
    await findById("plan-agreed");
    type("plan-agreed", "1000");
    expect(byId("plan-belowlist").textContent).toContain("Below list needs a platform admin.");
    expect((byId("plan-save") as HTMLButtonElement).disabled).toBe(true);
    expect(queryById("plan-reason")).toBeNull();
    document.body.innerHTML = "";
    const { mock } = await open(sessionOf([...VERIFIER, "admin.subscription.manage", "admin.subscription.adjust"]));
    click("plan-type-paid");
    await findById("plan-agreed");
    type("plan-agreed", "1000");
    expect((byId("plan-save") as HTMLButtonElement).disabled).toBe(true); // reason missing
    type("plan-reason", "Founding customer, first year");
    expect((byId("plan-save") as HTMLButtonElement).disabled).toBe(false);
    click("plan-save");
    await until(() => expect(mock.callsOf(START)).toHaveLength(1));
    expect(mock.callsOf(START)[0]?.body).toMatchObject({ agreed_price: { amount_paise: 100000, currency: "INR" }, reason: "Founding customer, first year" });
  });

  it("when no version is active it says no plan is sellable (AC 20)", async () => {
    const m = mount(`${ONBOARD}/plan`, { session: sessionOf(VERIFIER) });
    m.mock.on(PLANS, { status: 200, body: { items: [{ ...plans().items[0], versions: [version("draft", 1, [])] }] } });
    m.mock.on("GET /v1/organisations/{organisation_id}/subscription", { status: 200, body: { history: [] } });
    await findById("plan-form");
    click("plan-type-paid");
    expect((await findById("plan-none")).textContent).toContain("No plan is sellable yet.");
  });

  it("someone with no billing role sees 'for another role' and can still go on (AC 5)", async () => {
    mount(`${ONBOARD}/plan`, { session: sessionOf(["admin.org.read"]) });
    expect((await findById("plan-forrole")).textContent).toContain("For another role");
    expect(queryById("plan-form")).toBeNull();
    expect(queryById("plan-continue")).not.toBeNull();
  });

  it("an organisation that already has a plan shows it instead of the form (no second start)", async () => {
    const m = mount(`${ONBOARD}/plan`, { session: sessionOf(VERIFIER) });
    m.mock.on(PLANS, { status: 200, body: plans() });
    await findById("plan-exists");
    expect(queryById("plan-form")).toBeNull();
    expect(m.mock.callsOf(START)).toHaveLength(0);
  });
});

describe("go-live checklist (AS06)", () => {
  it("shows facts and first-time dates only; C6 is blocked while the GSTIN is unverified; devices are read here (AC 6 to 8)", async () => {
    const { mock } = mount(`${ONBOARD}`, { session: sessionOf(["admin.org.read", "admin.device.read", "admin.subscription.read"]) });
    mock.on(DETAIL, { status: 200, body: detail({ registrations: [reg("unverified")], owner_status: "pending" }) });
    mock.on(DEVICES, { status: 200, body: { items: [] } });
    await findById("golive-list");
    expect(byId("golive-C1-state").textContent).toBe("Done");
    expect(byId("golive-C2").getAttribute("data-state")).toBe("notyet");
    expect(byId("golive-C6").getAttribute("data-state")).toBe("blocked");
    expect(byId("golive-C6-reason").textContent).toContain("Waiting for GSTIN verification");
    expect(byId("golive-C8").textContent).toContain("Informational");
    expect(byId("checklist-live").textContent).toBe("Not live yet");
    expect(document.body.textContent).toContain("Trading is never blocked by this list.");
    expect(mock.callsOf(DEVICES).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/₹|\bGSTIN \d|bills? \d/); // no amounts or trading counts
  });

  it("Reload recomputes from the services (AC 7)", async () => {
    const { mock } = mount(`${ONBOARD}`, { session: sessionOf(["admin.org.read"]) });
    await findById("golive-list");
    const before = mock.callsOf(DETAIL).length;
    click("golive-reload");
    await until(() => expect(mock.callsOf(DETAIL).length).toBeGreaterThan(before));
  });

  it("what the viewer may not read is Unknown, never 'not yet'", async () => {
    const { mock } = mount(`${ONBOARD}`, { session: sessionOf(["admin.org.read"]) });
    mock.on(DEVICES, problem(403, "forbidden"));
    mock.on("GET /v1/organisations/{organisation_id}/subscription", problem(403, "forbidden"));
    await findById("golive-list");
    expect(byId("golive-C5").getAttribute("data-state")).toBe("unknown");
    expect(byId("golive-C4").getAttribute("data-state")).toBe("unknown");
  });

  it("an organisation the user cannot reach is not found, never forbidden (tenancy)", async () => {
    const { mock } = mount(`${ONBOARD}`, { session: sessionOf(["admin.org.read"]) });
    mock.on(DETAIL, problem(404, "not_found"));
    await findById("wizard-error");
  });
});
