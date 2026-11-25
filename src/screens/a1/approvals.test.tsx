import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { problem } from "../../test/mockAdmin";
import { byId, click, findById, mount, queryById, sessionOf, type, until, USER_ID } from "../../test/harness";
import { APPROVALS, DECISION, approval } from "../../test/a1";

const SUSPEND = "POST /v1/organisations/{organisation_id}/suspension";
const CANCEL = "PUT /v1/approvals/{approval_id}/cancellation";
const LIFECYCLE = ["admin.approval.read", "admin.approval.decide", "admin.approval.create", "admin.org.lifecycle.approve"];

function open(items: object[], session = sessionOf(LIFECYCLE)) {
  const m = mount("/approvals", { session });
  m.mock.on(APPROVALS, { status: 200, body: { items } });
  return m;
}

async function review(id: string) {
  await findById(`approval-review-${id}`);
  click(`approval-review-${id}`);
  await findById("approval-review");
}

describe("approvals (AS21)", () => {
  it("lists only the kinds the user may approve in Pending (AC 91), and says what each request does (security M8)", async () => {
    open([approval({ id: "ap-ok" }), approval({ id: "ap-tax", kind: "tax_rule_set_publish", subject: "Publish tax rules v8" })]);
    await until(() => expect(screen.getAllByTestId(/^approval-review-/)).toHaveLength(1));
    expect(queryById("approval-review-ap-tax")).toBeNull();
    expect(byId("approval-item-ap-ok").textContent).toContain("Suspend Example Hospitality");
    expect(byId("approval-item-ap-ok").textContent).toContain("Shown to owner");
    await review("ap-ok");
    expect(byId("approval-summary").textContent).toContain("read and export only after approval");
    expect(byId("approval-reason").textContent).toContain("Owner asked in writing");
    expect(byId("approval-ticket").textContent).toBe("T-1050");
    expect(byId("approval-review").querySelector("[data-testid=approval-countdown]")?.textContent).toMatch(/Expires in 2[23] h/);
  });

  it("a request without a summary tells the approver to ask before approving", async () => {
    open([approval({ id: "ap-1", subject: undefined as unknown as string })]);
    await review("ap-1");
    expect(byId("approval-summary").textContent).toContain("Ask the requester before approving");
  });

  it("approve needs a fresh six digit code, sends it with the CSRF token, and reads Done when the service executed it (AC 68, 72)", async () => {
    const { mock } = open([approval({ id: "ap-1" })]);
    mock.on(DECISION, { status: 200, body: { approval: approval({ id: "ap-1", state: "completed" }), execution: { state: "executed" } } });
    await review("ap-1");
    const submit = byId("approval-approve") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("approval-totp", "12345");
    expect(submit.disabled).toBe(true);
    type("approval-totp", "123456");
    fireEvent.keyDown(byId("approval-totp"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf(DECISION)).toHaveLength(1));
    const sent = mock.callsOf(DECISION)[0];
    expect(sent?.body).toEqual({ totp_code: "123456" });
    expect(sent?.path).toBe("/v1/approvals/ap-1/decision");
    expect(sent?.headers.get("x-csrf-token")).toBeTruthy();
    await until(() => expect(screen.getAllByTestId("toast").some((t) => t.textContent?.includes("Approved and done."))).toBe(true));
    expect(queryById("approval-panel")).toBeNull();
  });

  it("a wrong code is refused with a field message and changes nothing; no override exists (AC 70)", async () => {
    const { mock } = open([approval({ id: "ap-1" })]);
    mock.on(DECISION, problem(403, "approver_ineligible"));
    await review("ap-1");
    type("approval-totp", "000000");
    click("approval-approve");
    expect((await findById("approval-error")).textContent).toContain("could not be approved");
    expect((byId("approval-totp") as HTMLInputElement).value).toBe("");
    expect(byId("approval-panel")).toBeTruthy(); // still open, the row is unchanged
    expect(document.body.textContent).not.toMatch(/override/i);
  });

  it("when billing's guard refuses at execution the row stays Approved, not executed with the reason, and the approver can try again (ADR-0014 A1.3 item 3)", async () => {
    const { mock } = open([approval({ id: "ap-1" })]);
    mock.on(DECISION, { status: 200, body: { approval: approval({ id: "ap-1", state: "approved", approved_by: USER_ID }), execution: { state: "refused", code: "open_trading_day" } } });
    await review("ap-1");
    type("approval-totp", "123456");
    click("approval-approve");
    expect((await findById("approval-notexecuted")).textContent).toContain("an outlet has a trading day in progress");
    mock.on(SUSPEND, { status: 200, body: { organisation_id: "o", status: "suspended", changed_at: "2026-11-25T00:00:00Z" } });
    mock.on(APPROVALS, { status: 200, body: { items: [approval({ id: "ap-1", state: "approved", approved_by: USER_ID })] } });
    click("approval-retry");
    await until(() => expect(mock.callsOf(SUSPEND)).toHaveLength(1));
    const call = mock.callsOf(SUSPEND)[0];
    expect(call?.body).toMatchObject({ approval_id: "ap-1", ticket: "T-1050" });
    expect(JSON.stringify(call?.body)).not.toMatch(/grant/i); // the single-use grant never reaches the browser
    expect(call?.headers.get("authorization")).toBeNull();
  });

  it("an approved request that did not run is listed under Pending for its approver, with the retry button", async () => {
    open([approval({ id: "ap-1", state: "approved", approved_by: USER_ID })]);
    await review("ap-1");
    expect(byId("approval-notexecuted").textContent).toContain("Approved, not executed");
    expect(queryById("approval-retry")).not.toBeNull();
    expect(queryById("approval-approve")).toBeNull();
  });

  it("retrying names why it cannot run: a lapsed approval, a used one, or a changed subject (409 approval_not_executable)", async () => {
    const { mock } = open([approval({ id: "ap-1", state: "approved", approved_by: USER_ID })]);
    await review("ap-1");
    mock.on(SUSPEND, problem(409, "approval_not_executable", { reason: "lapsed" }));
    click("approval-retry");
    await until(() => expect(byId("approval-notexecuted").textContent).toContain("the request has lapsed"));
    mock.on(SUSPEND, problem(409, "approval_not_executable", { reason: "executed" }));
    click("approval-retry");
    await until(() => expect(byId("approval-notexecuted").textContent).toContain("already executed"));
  });

  it("the requester sees their own request under My requests with a countdown and Cancel; Approve is absent, not greyed (AC 70)", async () => {
    open([approval({ id: "ap-own", requested_by: USER_ID })], sessionOf(LIFECYCLE));
    await findById("approvals-empty"); // nothing for them to approve
    click("approvals-tab-mine");
    await review("ap-own");
    expect(byId("approval-own").textContent).toContain("You cannot approve your own request");
    expect(queryById("approval-approve")).toBeNull();
    expect(queryById("approval-totp")).toBeNull();
    expect(queryById("approval-cancel")).not.toBeNull();
    expect(byId("approval-review").querySelector("[data-testid=approval-countdown]")).toBeTruthy();
  });

  it("an account under 7 days old is told it is too new, with no form (AC 70)", async () => {
    open([approval({ id: "ap-1" })], sessionOf(LIFECYCLE, { canApproveFrom: new Date(Date.now() + 3 * 86_400_000).toISOString() }));
    await review("ap-1");
    expect(byId("approval-tooyoung").textContent).toContain("too new to approve");
    expect(queryById("approval-form")).toBeNull();
  });

  it("without the kind's approve permission there is no form even when the row is reachable from My requests", async () => {
    open([approval({ id: "ap-tax", kind: "tax_rule_set_publish", requested_by: "u-other" })], sessionOf(["admin.approval.read", "admin.approval.decide"]));
    await findById("approvals-empty");
  });

  it("Reject needs a reason of 10 characters and calls the cancellation operation", async () => {
    const { mock } = open([approval({ id: "ap-1" })]);
    await review("ap-1");
    type("approval-totp", "123456");
    click("approval-reject");
    const confirm = await findById("approval-reject-confirm");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    type("approval-reject-reason", "Requester could not be verified.");
    click("approval-reject-confirm");
    await until(() => expect(mock.callsOf(CANCEL)).toHaveLength(1));
    expect(mock.callsOf(CANCEL)[0]?.body).toEqual({ reason: "Requester could not be verified." });
  });

  it("a device revoke over the daily limit is completed by the approval itself: nothing is repeated (P2C-1)", async () => {
    const { mock } = open([approval({ id: "ap-d", kind: "device_revoke_over_quota", subject: "Revoke device Counter 1 (lost tablet)" })], sessionOf([...LIFECYCLE, "admin.device.revoke"]));
    mock.on(DECISION, { status: 200, body: { approval: approval({ id: "ap-d", kind: "device_revoke_over_quota", state: "completed" }) } });
    await review("ap-d");
    type("approval-totp", "123456");
    click("approval-approve");
    await until(() => expect(screen.getAllByTestId("toast").some((t) => t.textContent?.includes("Approved. The device is revoked."))).toBe(true));
    expect(mock.callsOf("PUT /v1/organisations/{organisation_id}/devices/{device_id}/revocation")).toHaveLength(0);
  });

  it("an approver's half of a sign-in code is shown once and is gone from the page after 'I wrote it down' (AC 92, 96)", async () => {
    const { mock } = open([approval({ id: "ap-c", kind: "sign_in_code", subject: "Sign-in code for Example Hospitality" })], sessionOf([...LIFECYCLE, "admin.signin_code.approve"]));
    mock.on(DECISION, { status: 200, body: { approval: approval({ id: "ap-c", kind: "sign_in_code", state: "approved" }), code_half: { half: "7K9Q", position: "second" } } });
    await review("ap-c");
    type("approval-totp", "123456");
    click("approval-approve");
    expect((await findById("approval-half-secret")).textContent).toBe("7K9Q");
    expect(byId("approval-half").getAttribute("aria-live") ?? byId("approval-half").innerHTML).toBeTruthy();
    expect(JSON.stringify({ ...localStorage })).not.toContain("7K9Q");
    expect(location.href).not.toContain("7K9Q");
    click("approval-half-ack");
    await until(() => expect(document.body.textContent).not.toContain("7K9Q"));
  });

  it("History holds lapsed requests as 'Lapsed, no effect' (AC 72)", async () => {
    open([approval({ id: "ap-old", state: "expired", expires_at: "2026-11-20T00:00:00Z" })]);
    await findById("approvals-empty");
    click("approvals-tab-history");
    await review("ap-old");
    expect(byId("approval-final").textContent).toContain("Lapsed, no effect");
    expect(byId("approvals-table").textContent).toContain("Lapsed, no effect");
  });

  it("an empty queue and a failing read", async () => {
    open([]);
    expect((await findById("approvals-empty")).textContent).toContain("Nothing is waiting for approval.");
    document.body.innerHTML = "";
    const bad = mount("/approvals", { session: sessionOf(LIFECYCLE) });
    bad.mock.on(APPROVALS, problem(503, "upstream_unavailable"));
    await findById("approvals-error");
  });

  it("the route needs admin.approval.read", async () => {
    mount("/approvals", { session: sessionOf(["admin.org.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
  });
});
