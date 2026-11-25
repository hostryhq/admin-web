import { describe, expect, it } from "vitest";
import { screen } from "@solidjs/testing-library";
import { problem } from "../test/mockAdmin";
import { audit, staff } from "../test/data";
import { byId, choose, click, findById, mount, queryById, sessionOf, type, until, USER_ID } from "../test/harness";
import { istDayEnd, istDayStart, todayIst } from "./AuditLog";

const AUDIT = "GET /v1/audit-entries";
const ALL = ["admin.org.read", "admin.audit.read", "admin.audit.read_own", "admin.user.manage"];

describe("audit log (screen 12)", () => {
  it("lists entries newest first as the server returns them, with IST times and the actor's name", async () => {
    const { mock } = mount("/audit", { session: sessionOf(ALL) });
    mock.on("GET /v1/vendor-users", { status: 200, body: { items: [staff("u-ravi", { display_name: "Ravi K." })] } });
    mock.on(AUDIT, {
      status: 200,
      body: {
        items: [
          audit("a2", { occurred_at: "2026-11-24T05:30:14.000Z", action: "vendor.organisation.created", ticket_reference: undefined, actor_vendor_user_id: "u-ravi" }),
          audit("a1", { occurred_at: "2026-11-24T05:10:09.000Z", action: "vendor.sign_in.failed", result: "failed", actor_vendor_user_id: USER_ID }),
        ],
      },
    });
    await until(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("audit-row");
    expect(rows[0]?.textContent).toContain("Organisation created");
    expect(rows[0]?.textContent).toContain("11:00:14"); // 05:30 UTC is 11:00 IST
    expect(rows[1]?.textContent).toContain("Sign-in failed");
    expect(rows[1]?.textContent).toContain("You"); // the signed-in user's own entry
    await until(() => expect(rows[0]?.textContent).toContain("Ravi K."));
    expect(byId("audit-immutable").textContent).toContain("cannot be edited or deleted");
  });

  it("sends the IST day as a UTC range and the chosen filters (AC 44)", async () => {
    const { mock } = mount("/audit", { session: sessionOf(ALL) });
    await findById("audit-filters");
    await until(() => expect(mock.callsOf(AUDIT)).toHaveLength(1));
    const first = mock.callsOf(AUDIT)[0]?.query ?? "";
    expect(first).toContain(`from=${encodeURIComponent(istDayStart(todayIst()))}`);
    expect(first).toContain(`to=${encodeURIComponent(istDayEnd(todayIst()))}`);
    type("audit-from", "2026-11-20");
    type("audit-org", "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60");
    type("audit-action", "vendor.device.revoked");
    click("audit-apply");
    await until(() => expect(mock.callsOf(AUDIT)).toHaveLength(2));
    const q = mock.callsOf(AUDIT)[1]?.query ?? "";
    expect(q).toContain(`from=${encodeURIComponent("2026-11-19T18:30:00.000Z")}`); // IST midnight
    expect(q).toContain("organisation_id=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60");
    expect(q).toContain("action=vendor.device.revoked");
  });

  it("IST day boundaries convert correctly", () => {
    expect(istDayStart("2026-11-24")).toBe("2026-11-23T18:30:00.000Z");
    expect(istDayEnd("2026-11-24")).toBe("2026-11-24T18:29:59.999Z");
  });

  it("for a user with only admin.audit.read_own the title is 'Your activity' and there is no actor or organisation filter (AC 45)", async () => {
    mount("/audit", { session: sessionOf(["admin.org.read", "admin.audit.read_own"]) });
    await findById("audit-filters");
    expect(byId("page-title").textContent).toBe("Your activity");
    expect(queryById("audit-actor")).toBeNull();
    expect(queryById("audit-org")).toBeNull();
  });

  it("expanding a support session row lists its reads under it, and reads are not separate rows (AC 50)", async () => {
    const { mock } = mount("/audit", { session: sessionOf(ALL) });
    const start = audit("s1", { action: "vendor.support.session.started", support_session_id: "sess-1", organisation_id: undefined });
    const read1 = audit("r1", { action: "vendor.support.read", support_session_id: "sess-1", read_summary: "Devices (4 returned)" });
    const read2 = audit("r2", { action: "vendor.support.read", support_session_id: "sess-1", read_summary: "Members (3 returned)" });
    mock.on(AUDIT, (r) =>
      r.query.get("support_session_id") ? { status: 200, body: { items: [read1, read2, start] } } : { status: 200, body: { items: [read2, read1, start] } },
    );
    await until(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(1)); // only the session row
    click("audit-expand");
    await until(() => expect(screen.getAllByTestId("audit-read")).toHaveLength(2));
    expect(byId("audit-reads").textContent).toContain("Devices (4 returned)");
    expect(byId("audit-reads").textContent).toContain("2 reads");
    expect(mock.callsOf(AUDIT).some((c) => c.query.includes("support_session_id=sess-1"))).toBe(true);
  });

  it("the detail shows request id and source and has no edit, delete or export control (AC 46)", async () => {
    mount("/audit", { session: sessionOf(ALL) });
    await until(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(1));
    click("audit-expand");
    const detail = await findById("audit-detail-list");
    expect(detail.textContent).toContain("req_0190a1b2c3d4");
    expect(detail.textContent).toContain("203.0.113.7");
    const controls = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(controls.some((c) => /delete|edit|export|download/.test(c))).toBe(false);
  });

  it("empty and error states", async () => {
    const { mock } = mount("/audit", { session: sessionOf(ALL) });
    mock.on(AUDIT, { status: 200, body: { items: [] } });
    expect((await findById("audit-empty")).textContent).toContain("No entries match.");
    mock.on(AUDIT, problem(503, "upstream_unavailable"));
    click("audit-apply");
    await findById("audit-error");
  });
});

describe("vendor staff (screen 4)", () => {
  const USERS = "GET /v1/vendor-users";
  const ME = staff(USER_ID, { display_name: "Asha", role: "platform_admin", email: "asha@example.invalid" });
  const OTHER = staff("u-ravi", { display_name: "Ravi", role: "support", email: "ravi@example.invalid" });
  const PENDING = staff("u-meena", { display_name: "Meena", role: "onboarding", status: "setup_pending", totp_enrolled: false, email: "meena@example.invalid" });

  it("lists name, email, role and state; shows no password, TOTP secret or setup link (AC 69)", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    mock.on(USERS, { status: 200, body: { items: [ME, OTHER, PENDING] } });
    await until(() => expect(byId("staff-table").textContent).toContain("Ravi"));
    const text = byId("staff-table").textContent ?? "";
    expect(text).toContain("ravi@example.invalid");
    expect(text).toContain("Support");
    expect(text).toContain("Setup pending");
    expect(document.body.textContent).not.toMatch(/https?:\/\/|setup[_-]?token|secret=|otpauth/i);
  });

  it("the own row and the last active platform admin have no deactivate or role change (AC 11)", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    mock.on(USERS, { status: 200, body: { items: [ME, OTHER] } });
    await until(() => expect(byId("staff-table").textContent).toContain("Ravi"));
    expect(queryById(`staff-deactivate-${USER_ID}`)).toBeNull();
    expect(queryById(`staff-role-${USER_ID}`)).toBeNull();
    expect(queryById("staff-deactivate-u-ravi")).not.toBeNull();
  });

  it("deactivate states the effect, asks once, and patches the status", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    mock.on(USERS, { status: 200, body: { items: [ME, OTHER] } });
    await findById("staff-deactivate-u-ravi");
    click("staff-deactivate-u-ravi");
    expect((await findById("staff-deactivate-dialog-body")).textContent).toBe("Ravi will be signed out and cannot sign in.");
    click("staff-deactivate-dialog-confirm");
    await until(() => expect(mock.callsOf("PATCH /v1/vendor-users/{vendor_user_id}")).toHaveLength(1));
    expect(mock.callsOf("PATCH /v1/vendor-users/{vendor_user_id}")[0]?.body).toEqual({ status: "deactivated" });
    expect(mock.callsOf("PATCH /v1/vendor-users/{vendor_user_id}")[0]?.path).toBe("/v1/vendor-users/u-ravi");
  });

  it("a server refusal (last platform admin) is shown and nothing is claimed done", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    mock.on(USERS, { status: 200, body: { items: [ME, OTHER] } });
    mock.on("PATCH /v1/vendor-users/{vendor_user_id}", problem(409, "last_platform_admin"));
    await findById("staff-deactivate-u-ravi");
    click("staff-deactivate-u-ravi");
    await findById("staff-deactivate-dialog");
    click("staff-deactivate-dialog-confirm");
    expect((await findById("staff-deactivate-dialog-error")).textContent).toContain("At least one platform admin must stay active.");
  });

  it("change role and reset TOTP call their operations", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    mock.on(USERS, { status: 200, body: { items: [ME, OTHER] } });
    await findById("staff-role-u-ravi");
    click("staff-role-u-ravi");
    await findById("staff-role-dialog");
    choose("staff-role-select", "billing");
    click("staff-role-dialog-confirm");
    await until(() => expect(mock.callsOf("PATCH /v1/vendor-users/{vendor_user_id}")[0]?.body).toEqual({ role: "billing" }));
    await until(() => expect(queryById("staff-role-dialog")).toBeNull());
    click("staff-totp-u-ravi");
    await findById("staff-totp-dialog");
    click("staff-totp-dialog-confirm");
    await until(() => expect(mock.callsOf("POST /v1/vendor-users/{vendor_user_id}/totp-resets")).toHaveLength(1));
  });

  it("inviting sends a client-made id, name, email and role; the setup link is never shown; a used email is refused", async () => {
    const { mock } = mount("/staff", { session: sessionOf(ALL) });
    await findById("staff-invite");
    click("staff-invite");
    await findById("staff-invite-dialog");
    type("staff-name", "Priya");
    type("staff-email", "priya@example.invalid");
    mock.on("POST /v1/vendor-users", problem(409, "vendor_user_conflict"));
    click("staff-invite-submit");
    expect((await findById("staff-invite-error")).textContent).toContain("already in use");
    mock.on("POST /v1/vendor-users", { status: 201, body: staff("new", { status: "setup_pending" }) });
    click("staff-invite-submit");
    await until(() => expect(queryById("staff-invite-dialog")).toBeNull());
    const sent = mock.callsOf("POST /v1/vendor-users").at(-1);
    expect(sent?.body).toMatchObject({ email: "priya@example.invalid", display_name: "Priya", role: "support" });
    expect((sent?.body as { id: string }).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/); // client-generated UUIDv7
    expect(document.body.textContent).not.toMatch(/setup[_-]?(link|token)=|https?:\/\//i);
  });

  it("the screen needs admin.user.manage", async () => {
    mount("/staff", { session: sessionOf(["admin.org.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
  });
});

describe("approvals queue (A0-S19)", () => {
  const base = {
    id: "ap-1",
    kind: "device_revoke_over_quota",
    state: "pending",
    organisation_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60",
    subject_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e",
    requested_by: "u-someone-else",
    ticket_reference: "SUP-2041",
    verification_method: "callback_to_registered_number",
    created_at: "2026-11-24T05:12:00.000Z",
    expires_at: "2026-11-24T07:12:00.000Z",
  };
  const SESSION = sessionOf(["admin.org.read", "admin.device.revoke"]);

  function setup(items: object[]) {
    const m = mount("/approvals", { session: SESSION });
    m.mock.on("GET /v1/approvals", { status: 200, body: { items } });
    return m;
  }

  it("lists only pending device-revoke requests with organisation, device, ticket, method and requester (AC 90); asks for pending only", async () => {
    setup([base, { ...base, id: "ap-2", kind: "sign_in_code" }, { ...base, id: "ap-3", state: "approved" }]);
    await until(() => expect(screen.getAllByTestId(/^approval-approve-/)).toHaveLength(1));
    const text = byId("approvals-table").textContent ?? "";
    expect(text).toContain("SUP-2041");
    expect(text).toContain("Called back on the registered number");
    expect(text).toContain("0190a1b2");
    expect(queryById("approval-approve-ap-2")).toBeNull();
  });

  it("Approve asks for a fresh TOTP and sends it; a refusal is shown and nothing changes", async () => {
    const { mock } = setup([base]);
    await findById("approval-approve-ap-1");
    click("approval-approve-ap-1");
    await findById("approve-dialog");
    expect((byId("approve-submit") as HTMLButtonElement).disabled).toBe(true);
    type("approve-code", "123456");
    mock.on("PUT /v1/approvals/{approval_id}/decision", problem(403, "approver_ineligible"));
    click("approve-submit");
    expect((await findById("approve-error")).textContent).toContain("could not be approved");
    type("approve-code", "654321");
    mock.on("PUT /v1/approvals/{approval_id}/decision", { status: 200, body: { approval: { ...base, state: "approved" } } });
    click("approve-submit");
    await until(() => expect(queryById("approve-dialog")).toBeNull());
    const sent = mock.callsOf("PUT /v1/approvals/{approval_id}/decision").at(-1);
    expect(sent?.body).toEqual({ totp_code: "654321" });
    expect(sent?.path).toBe("/v1/approvals/ap-1/decision");
    expect(sent?.headers.get("x-csrf-token")).toBeTruthy();
  });

  it("the requester's own request has no Approve (the server refuses it too)", async () => {
    setup([{ ...base, requested_by: USER_ID }]);
    await until(() => expect(screen.getAllByTestId(/^approval-reject-/)).toHaveLength(1));
    expect(screen.queryAllByTestId(/^approval-approve-/)).toHaveLength(0);
  });

  it("Reject needs a reason of 10 characters and then calls cancellation", async () => {
    const { mock } = setup([base]);
    await findById("approval-reject-ap-1");
    click("approval-reject-ap-1");
    await findById("reject-dialog");
    type("reject-reason", "short");
    click("reject-dialog-confirm");
    expect((await findById("reject-dialog-error")).textContent).toContain("at least 10 characters");
    type("reject-reason", "Requester could not be verified.");
    click("reject-dialog-confirm");
    await until(() => expect(mock.callsOf("PUT /v1/approvals/{approval_id}/cancellation")).toHaveLength(1));
    expect(mock.callsOf("PUT /v1/approvals/{approval_id}/cancellation")[0]?.body).toEqual({ reason: "Requester could not be verified." });
  });

  it("empty queue says nothing is waiting", async () => {
    setup([]);
    expect((await findById("approvals-empty")).textContent).toContain("Nothing is waiting for approval.");
  });
});
