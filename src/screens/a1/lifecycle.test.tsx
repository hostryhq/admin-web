import { describe, expect, it } from "vitest";
import { screen } from "@solidjs/testing-library";
import { problem, recorded, ORG_ID } from "../../test/mockAdmin";
import { detail } from "../../test/data";
import { byId, click, findById, mount, queryById, sessionOf, type, until, USER_ID } from "../../test/harness";
import { APPROVALS, approval } from "../../test/a1";

const FILE = "POST /v1/approvals";
const ORG_GET = "GET /v1/organisations/{organisation_id}";
const REQUEST = ["admin.org.read", "admin.org.lifecycle.request", "admin.approval.create"];
const PATH = `/organisations/${ORG_ID}`;

const withStatus = (status: "trial" | "active" | "suspended" | "closed") => {
  const d = detail();
  return { ...d, organisation: { ...d.organisation, status } };
};

async function openMenu(status: "trial" | "active" | "suspended" | "closed" = "active", perms: string[] = REQUEST) {
  const m = mount(PATH, { session: sessionOf(perms) });
  m.mock.on(ORG_GET, { status: 200, body: withStatus(status) });
  return m;
}

describe("lifecycle: suspend, reinstate, close (AS22)", () => {
  it("the Lifecycle control needs admin.org.lifecycle.request and is absent on a closed organisation", async () => {
    await openMenu("active", ["admin.org.read"]);
    await findById("org-overview");
    expect(queryById("org-lifecycle")).toBeNull();
    document.body.innerHTML = "";
    await openMenu("closed");
    await findById("org-overview");
    expect(queryById("org-lifecycle")).toBeNull();
  });

  it("suspension is only a request: it files an org_suspend approval and executes nothing (AC 67, 68)", async () => {
    const { mock } = await openMenu();
    await findById("org-lifecycle");
    click("org-lifecycle");
    await findById("lifecycle-dialog");
    expect(byId("lifecycle-body").textContent).toContain("After approval the organisation can read and export only. Devices are not wiped.");
    expect(byId("lifecycle-dialog").textContent).toContain("Devices apply this only after their trading day ends.");
    const submit = byId("lifecycle-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("lifecycle-ticket", "T-1050");
    type("lifecycle-reason", "short");
    expect(submit.disabled).toBe(true);
    type("lifecycle-reason", "Owner asked in writing to pause the account.");
    expect(submit.disabled).toBe(false);
    mock.on(FILE, { status: 201, body: approval({ requested_by: USER_ID, expires_at: new Date(Date.now() + 24 * 3_600_000 - 60_000).toISOString() }) });
    click("lifecycle-dialog-submit");
    await until(() => expect(mock.callsOf(FILE)).toHaveLength(1));
    expect(mock.callsOf(FILE)[0]?.body).toEqual({
      kind: "org_suspend",
      organisation_id: ORG_ID,
      ticket_reference: "T-1050",
      reason: "Owner asked in writing to pause the account.",
      verification_method: "callback_to_registered_number",
    });
    await until(() => expect(screen.getAllByTestId("toast").some((t) => /Waiting for a second approver\. Expires in 23 h/.test(t.textContent ?? ""))).toBe(true));
    for (const op of ["suspension", "reinstatement", "closure"]) expect(mock.calls.filter((c) => c.path.endsWith(`/${op}`))).toHaveLength(0);
  });

  it("closing needs the 'owner was offered an export' box and says it cannot be reopened (AC 71)", async () => {
    const { mock } = await openMenu();
    await findById("org-lifecycle");
    click("org-lifecycle");
    await findById("lifecycle-dialog");
    click("lifecycle-action-close");
    type("lifecycle-ticket", "T-1051");
    type("lifecycle-reason", "Business closed down, owner confirmed.");
    const submit = byId("lifecycle-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(byId("lifecycle-body").textContent).toContain("cannot be reopened");
    click("lifecycle-export");
    expect(submit.disabled).toBe(false);
    mock.on(FILE, { status: 201, body: approval({ kind: "org_close" }) });
    click("lifecycle-dialog-submit");
    await until(() => expect(mock.callsOf(FILE)[0]?.body).toMatchObject({ kind: "org_close" }));
  });

  it("a suspended organisation offers reinstate (and close), with no 'devices apply later' text for reinstate", async () => {
    await openMenu("suspended");
    await findById("org-lifecycle");
    click("org-lifecycle");
    await findById("lifecycle-dialog");
    expect(screen.queryAllByTestId("lifecycle-action-suspend")).toHaveLength(0);
    expect(byId("lifecycle-body").textContent).toContain("Normal access resumes after approval.");
    expect(byId("lifecycle-dialog").textContent).not.toContain("Devices apply this only after");
  });

  it("with fewer than two eligible users the request is refused with the reason and no override (AC 70)", async () => {
    const { mock } = await openMenu();
    await findById("org-lifecycle");
    click("org-lifecycle");
    await findById("lifecycle-dialog");
    type("lifecycle-ticket", "T-1050");
    type("lifecycle-reason", "Owner asked in writing to pause the account.");
    mock.on(FILE, problem(409, "second_approver_unavailable"));
    click("lifecycle-dialog-submit");
    expect((await findById("lifecycle-dialog-error")).textContent).toContain("no second eligible approver");
    expect(document.body.textContent).not.toMatch(/override|skip approval/i);
  });

  it("an open trading day blocks suspend and close with the plain reason (AC 68, ADR-0014 A1.2)", async () => {
    const { mock } = await openMenu();
    await findById("org-lifecycle");
    click("org-lifecycle");
    await findById("lifecycle-dialog");
    type("lifecycle-ticket", "T-1050");
    type("lifecycle-reason", "Owner asked in writing to pause the account.");
    mock.on(FILE, problem(409, "open_trading_day"));
    click("lifecycle-dialog-submit");
    expect((await findById("lifecycle-blocked")).textContent).toContain("open trading day");
  });
});

describe("menu loading (AS23)", () => {
  const ACT = ["admin.org.read", "admin.support.session.act", "admin.support.session.start"];
  const START = "POST /v1/support-sessions";

  it("when the function is switched off it shows only the disabled notice and no controls (AC 83)", async () => {
    const { mock } = mount(`${PATH}/menu-loading`, { session: sessionOf(ACT) });
    await findById("act-form");
    type("act-ticket", "T-1060");
    type("act-reason", "Owner asked us to load the menu.");
    mock.on(START, problem(422, "mode_not_supported"));
    click("act-request");
    expect((await findById("act-disabled")).textContent).toContain("Menu loading by Hostry staff is not on yet. Ask the owner to load their own menu.");
    expect(queryById("act-form")).toBeNull();
    expect(mock.callsOf(START)[0]?.body).toMatchObject({ mode: "act", duration_minutes: 30, ticket_reference: "T-1060" });
  });

  it("the duration is at most 60 minutes", async () => {
    mount(`${PATH}/menu-loading`, { session: sessionOf(ACT) });
    await findById("act-form");
    const options = Array.from((byId("act-duration") as HTMLSelectElement).options).map((o) => Number(o.value));
    expect(Math.max(...options)).toBe(60);
  });

  it("needs admin.support.session.act, by route and by the control on the organisation page", async () => {
    mount(`${PATH}/menu-loading`, { session: sessionOf(["admin.org.read", "admin.support.session.start"]) });
    expect(await findById("forbidden")).toBeTruthy();
    document.body.innerHTML = "";
    const m = mount(PATH, { session: sessionOf(["admin.org.read", "admin.support.session.start"]) });
    m.mock.on(ORG_GET, { status: 200, body: detail() });
    await findById("org-overview");
    expect(queryById("org-menu-loading")).toBeNull();
  });
});

describe("sign-in codes and recovery (AS24)", () => {
  const CODES = ["admin.org.read", "admin.approval.read", "admin.approval.create", "admin.signin_code.create", "admin.recovery.create"];

  function setup(items: object[], perms = CODES) {
    const m = mount("/sign-in-codes", { session: sessionOf(perms) });
    m.mock.on(APPROVALS, { status: 200, body: { items } });
    return m;
  }

  it("requests a sign-in code for an organisation with a ticket and reason; each half is for its own user (AC 92)", async () => {
    const { mock } = setup([]);
    await findById("codes-new-signin");
    click("codes-new-signin");
    await findById("codes-dialog");
    type("codes-org", "not-an-id");
    type("codes-ticket", "T-1070");
    type("codes-reason", "Owner locked out of the app.");
    expect((byId("codes-dialog-submit") as HTMLButtonElement).disabled).toBe(true);
    type("codes-org", ORG_ID);
    click("codes-dialog-submit");
    await until(() => expect(mock.callsOf(FILE)).toHaveLength(1));
    expect(mock.callsOf(FILE)[0]?.body).toMatchObject({ kind: "sign_in_code", organisation_id: ORG_ID, ticket_reference: "T-1070" });
  });

  it("shows my half once; it leaves the page after 'I wrote it down' and is never kept (AC 96)", async () => {
    const { mock } = setup([approval({ id: "ap-c", kind: "sign_in_code", state: "approved", requested_by: USER_ID })]);
    mock.on("POST /v1/approvals/{approval_id}/code-half-claims", { status: 201, body: { half: "A4X7", position: "first" } });
    await until(() => expect(screen.getAllByTestId(/^code-half-/)).toHaveLength(1));
    click("code-half-ap-c");
    expect((await findById("code-reveal-secret")).textContent).toBe("A4X7");
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain("A4X7");
    expect(location.href).not.toContain("A4X7");
    click("code-reveal-ack");
    await until(() => expect(document.body.textContent).not.toContain("A4X7"));
  });

  it("claiming a half twice is refused with a plain message", async () => {
    const { mock } = setup([approval({ id: "ap-c", kind: "sign_in_code", state: "approved", requested_by: USER_ID })]);
    mock.on("POST /v1/approvals/{approval_id}/code-half-claims", problem(409, "approval_conflict"));
    await until(() => expect(screen.getAllByTestId(/^code-half-/)).toHaveLength(1));
    click("code-half-ap-c");
    await until(() => expect(screen.getAllByTestId("toast").some((t) => t.textContent?.includes("already shown"))).toBe(true));
  });

  it("owner number recovery shows its 24 hour countdown and either user may cancel it with a reason (AC 94)", async () => {
    const { mock } = setup([approval({ id: "ap-r", kind: "owner_recovery", state: "approved", requested_by: USER_ID, completes_at: new Date(Date.now() + 18 * 3_600_000).toISOString() })]);
    await until(() => expect(byId("codes-table").textContent).toMatch(/1[78] h .* remaining/));
    click("recovery-cancel-ap-r");
    await findById("recovery-cancel-dialog");
    type("recovery-cancel-reason", "Owner called to say it was a mistake.");
    click("recovery-cancel-dialog-submit");
    await until(() => expect(mock.callsOf("PUT /v1/approvals/{approval_id}/cancellation")).toHaveLength(1));
  });

  it("while a function is switched off the page says so (AC 93)", async () => {
    const { mock } = setup([]);
    await findById("codes-new-signin");
    click("codes-new-signin");
    await findById("codes-dialog");
    type("codes-org", ORG_ID);
    type("codes-ticket", "T-1070");
    type("codes-reason", "Owner locked out of the app.");
    mock.on(FILE, problem(409, "function_switched_off"));
    click("codes-dialog-submit");
    expect((await findById("codes-off")).textContent).toContain("This function is switched off.");
  });

  it("the route needs one of the create permissions, and each button its own", async () => {
    mount("/sign-in-codes", { session: sessionOf(["admin.org.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
    document.body.innerHTML = "";
    setup([], ["admin.org.read", "admin.approval.read", "admin.signin_code.create"]);
    await findById("codes-new-signin");
    expect(queryById("codes-new-recovery")).toBeNull();
    expect(recorded("claimCodeHalf")).toBeDefined();
  });
});
