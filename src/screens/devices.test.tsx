import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { problem, recorded } from "../test/mockAdmin";
import { device } from "../test/data";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../test/harness";

const DEVICES = "/organisations/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60/devices";
const LIST = "GET /v1/organisations/{organisation_id}/devices";
const REVOKE = "PUT /v1/organisations/{organisation_id}/devices/{device_id}/revocation";
const SUPPORT = ["admin.org.read", "admin.device.read", "admin.device.revoke"];

const everyState = () => ({
  items: [device("active", "d-active"), device("revoked", "d-revoked"), device("drained", "d-drained"), device("wiped", "d-wiped"), device("lost", "d-lost")],
});

describe("devices (screen 10)", () => {
  it("gives each state a distinct badge with plain text, and only active devices have Revoke (AC 36, 41)", async () => {
    const { mock } = mount(DEVICES, { session: sessionOf(SUPPORT) });
    mock.on(LIST, { status: 200, body: everyState() });
    await until(() => expect(screen.getAllByTestId(/^badge-device-/)).toHaveLength(5));
    const kinds = screen.getAllByTestId(/^badge-device-/).map((e) => e.getAttribute("data-testid"));
    expect(new Set(kinds).size).toBe(5);
    const text = byId("devices-table").textContent ?? "";
    expect(text).toContain("Revoked, waiting to be wiped");
    expect(text).toContain("Marked lost by owner");
    expect(screen.getAllByTestId(/^device-revoke-/)).toHaveLength(1);
    expect(queryById("device-revoke-d-active")).not.toBeNull();
    // Nothing offers to undo, wipe or hasten (AC 41), and no key or PIN data is shown.
    expect(text).not.toMatch(/un-?revoke|wipe now|hasten|pin|public key/i);
  });

  it("says that opening the list is audited, and shows kind, outlet, state, times, billing and key protection", async () => {
    mount(DEVICES, { session: sessionOf(SUPPORT) });
    await until(() => expect(byId("devices-table").textContent).toContain("Counter"));
    expect(byId("devices-audited").textContent).toContain("recorded in the audit log");
    const text = byId("devices-table").textContent ?? "";
    expect(text).toContain("Main Restaurant"); // outlet name from the directory
    expect(text).toContain("Hardware");
    expect(text).toMatch(/24 Nov 2026.*IST/);
  });

  it("without admin.device.revoke no Revoke control is shown (AC 42)", async () => {
    const { mock } = mount(DEVICES, { session: sessionOf(["admin.org.read", "admin.device.read"]) });
    mock.on(LIST, { status: 200, body: everyState() });
    await until(() => expect(screen.getAllByTestId(/^badge-device-/)).toHaveLength(5));
    expect(screen.queryAllByTestId(/^device-revoke-/)).toHaveLength(0);
  });

  it("empty and error states", async () => {
    const empty = mount(DEVICES, { session: sessionOf(SUPPORT) });
    empty.mock.on(LIST, { status: 200, body: { items: [] } });
    expect((await findById("devices-empty")).textContent).toContain("No devices registered.");
  });

  it("a failing read shows an error with Retry and no rows", async () => {
    const { mock } = mount(DEVICES, { session: sessionOf(SUPPORT) });
    mock.on(LIST, problem(503, "upstream_unavailable"));
    await findById("devices-error");
    expect(queryById("devices-table")).toBeNull();
  });
});

describe("revoke dialog (screen 11)", () => {
  async function open() {
    const m = mount(DEVICES, { session: sessionOf(SUPPORT) });
    m.mock.on(LIST, { status: 200, body: everyState() });
    await findById("device-revoke-d-active");
    click("device-revoke-d-active");
    await findById("revoke-dialog");
    return m;
  }
  const valid = () => {
    type("revoke-ticket", "SUP-2041");
    type("revoke-reason", "Owner phoned to report a lost tablet.");
  };

  it("the confirm button is enabled only when ticket, method and reason are valid (AC 38)", async () => {
    await open();
    const submit = byId("revoke-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("revoke-ticket", "SUP-2041");
    expect(submit.disabled).toBe(true); // no reason yet
    type("revoke-reason", "short");
    expect(submit.disabled).toBe(true); // under 10 characters
    type("revoke-reason", "Owner phoned to report a lost tablet.");
    expect(submit.disabled).toBe(false);
    click("revoke-method-other");
    expect(submit.disabled).toBe(true); // "other" needs a note
    type("revoke-note", "Verified in person at the shop");
    expect(submit.disabled).toBe(false);
  });

  it("Enter in a text field does not submit; Ctrl+Enter does; the request has ticket, reason, method and confirm", async () => {
    const { mock } = await open();
    valid();
    fireEvent.keyDown(byId("revoke-ticket"), { key: "Enter" });
    expect(mock.callsOf(REVOKE)).toHaveLength(0);
    fireEvent.keyDown(byId("revoke-ticket"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf(REVOKE)).toHaveLength(1));
    const call = mock.callsOf(REVOKE)[0];
    expect(call?.path).toContain("/devices/d-active/revocation");
    expect(call?.body).toEqual({
      ticket_reference: "SUP-2041",
      reason: "Owner phoned to report a lost tablet.",
      verification_method: "callback_to_registered_number",
      confirm: true,
    });
    expect(call?.headers.get("idempotency-key")).toBeTruthy();
    await until(() => expect(queryById("revoke-dialog")).toBeNull());
    expect(screen.getAllByTestId("toast").some((t) => t.textContent?.includes("Device revoked."))).toBe(true);
  });

  it("an already revoked device says nothing changed", async () => {
    const { mock } = await open();
    mock.on(REVOKE, { status: 200, body: { ...recorded<object>("revokeOrganisationDevice"), outcome: "already_revoked", changed: false } });
    valid();
    click("revoke-submit");
    await until(() => expect(screen.getAllByTestId("toast").some((t) => t.textContent?.includes("Already revoked. Nothing changed."))).toBe(true));
  });

  it("over the quota the device stays active, the request is filed as a two-person approval, and the dialog says a second Hostry person must approve (AC 86)", async () => {
    const { mock } = await open();
    mock.on(REVOKE, problem(409, "vendor_approval_required"));
    valid();
    click("revoke-submit");
    expect((await findById("revoke-approval")).textContent).toContain("needs a second Hostry person to approve");
    expect(byId("revoke-approval-link").getAttribute("href")).toBe("/approvals");
    const filed = mock.callsOf("POST /v1/approvals")[0];
    expect(filed?.body).toEqual({
      kind: "device_revoke_over_quota",
      organisation_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60",
      subject_id: "d-active",
      ticket_reference: "SUP-2041",
      reason: "Owner phoned to report a lost tablet.",
      verification_method: "callback_to_registered_number",
    });
  });

  it("with no second approver available it says so and files nothing pending", async () => {
    const { mock } = await open();
    mock.on(REVOKE, problem(409, "vendor_approval_required"));
    mock.on("POST /v1/approvals", problem(409, "second_approver_unavailable"));
    valid();
    click("revoke-submit");
    expect((await findById("revoke-error")).textContent).toContain("No second approver is available");
    expect(queryById("revoke-approval")).toBeNull();
  });

  it("the revoke completes at approval (P2C-1): the dialog says so, and the requester never repeats it with an approval id", async () => {
    const { mock } = await open();
    mock.on(REVOKE, problem(409, "vendor_approval_required"));
    valid();
    click("revoke-submit");
    expect((await findById("revoke-approval")).textContent).toContain("revoked the moment they approve");
    // The devices screen no longer looks up approved approvals, and no revoke carries an approval id.
    expect(mock.callsOf("GET /v1/approvals")).toHaveLength(0);
    expect(mock.callsOf(REVOKE).every((c) => !("approval_id" in (c.body as object)))).toBe(true);
  });

  it("a device of another organisation (404) says not found", async () => {
    const { mock } = await open();
    mock.on(REVOKE, problem(404, "not_found"));
    valid();
    click("revoke-submit");
    expect((await findById("revoke-error")).textContent).toContain("Device not found.");
  });

  it("Esc cancels without sending anything", async () => {
    const { mock } = await open();
    fireEvent.keyDown(byId("revoke-dialog"), { key: "Escape" });
    await until(() => expect(queryById("revoke-dialog")).toBeNull());
    expect(mock.callsOf(REVOKE)).toHaveLength(0);
  });
});
