import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@solidjs/testing-library";
import { problem, recorded } from "../test/mockAdmin";
import { byId, choose, click, findById, mount, queryById, sessionOf, type, until } from "../test/harness";
import { formatRemaining } from "../shell/support";

const ORG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";
const SUPPORT_PERMS = ["admin.org.read", "admin.device.read", "admin.support.session.start"];
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const active = (minutes = 27.7) => ({ id: "sess-1", organisationId: ORG, organisationName: "Example Hospitality", ticketReference: "SUP-2041", endsAt: inMinutes(minutes) });
const VIEW = `/support-session/${ORG}`;

afterEach(() => vi.useRealTimers());

describe("start support session (screen 13)", () => {
  async function openDialog(extra = {}) {
    const m = mount(`/organisations/${ORG}`, { session: sessionOf(SUPPORT_PERMS, extra) });
    await findById("org-start-support");
    click("org-start-support");
    await findById("support-start-dialog");
    return m;
  }

  it("needs a ticket reference and a reason of 10+ characters, defaults to 30 minutes and offers at most 60", async () => {
    await openDialog();
    const submit = byId("support-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("support-ticket", "SUP-2041");
    type("support-reason", "too short");
    expect(submit.disabled).toBe(true);
    type("support-reason", "Owner phoned about a printer problem.");
    expect(submit.disabled).toBe(false);
    const select = byId("support-duration") as HTMLSelectElement;
    expect(select.value).toBe("30");
    expect(Array.from(select.options).map((o) => Number(o.value))).toEqual([15, 30, 45, 60]);
    expect(byId("support-start-dialog").textContent).toContain("Read-only.");
    expect(byId("support-start-dialog").textContent).toContain("owner can see this in their audit log");
  });

  it("starts the session, goes to the view and shows the banner with organisation, read-only and a countdown (AC 51)", async () => {
    const { mock, state } = await openDialog();
    mock.on("POST /v1/support-sessions", {
      status: 201,
      body: { seconds_remaining: 1800, session: { ...recorded<{ session: object }>("startSupportSession").session, ends_at: inMinutes(30) } },
    });
    type("support-ticket", "SUP-2041");
    type("support-reason", "Owner phoned about a printer problem.");
    choose("support-duration", "45");
    click("support-submit");
    await findById("support-banner");
    expect(byId("support-banner-org").textContent).toBe("Example Hospitality");
    expect(byId("support-banner-readonly").textContent).toBe("Read-only");
    expect(byId("support-banner-remaining").textContent).toMatch(/Ends in (29|30):\d\d/);
    expect(queryById("support-banner-soon")).toBeNull();
    expect(state.session()?.support?.organisationId).toBe(ORG);
    const sent = mock.callsOf("POST /v1/support-sessions")[0];
    expect(sent?.body).toEqual({ organisation_id: ORG, ticket_reference: "SUP-2041", reason: "Owner phoned about a printer problem.", duration_minutes: 45 });
    expect(sent?.headers.get("idempotency-key")).toBeTruthy();
    expect(await findById("support-recorded")).toBeTruthy();
  });

  it("a user who already has a session is asked to end it first (AC 60)", async () => {
    const { mock, state } = await openDialog({ support: { ...active(), organisationName: "Other Org", organisationId: "other" } });
    expect((await findById("support-active")).textContent).toContain("Other Org");
    expect(queryById("support-ticket")).toBeNull();
    click("support-active-end");
    await until(() => expect(queryById("support-ticket")).not.toBeNull());
    expect(mock.callsOf("DELETE /v1/support-sessions/current")).toHaveLength(1);
    expect(state.session()?.support).toBeUndefined();
  });

  it("when the server reports an active session (409) the same end-first choice appears", async () => {
    const { mock } = await openDialog();
    mock.on("POST /v1/support-sessions", problem(409, "support_session_active"));
    type("support-ticket", "SUP-2041");
    type("support-reason", "Owner phoned about a printer problem.");
    click("support-submit");
    expect(await findById("support-active")).toBeTruthy();
  });

  it("is not offered to a user without admin.support.session.start (AC 61)", async () => {
    mount(`/organisations/${ORG}`, { session: sessionOf(["admin.org.read"]) });
    await findById("org-overview");
    expect(queryById("org-start-support")).toBeNull();
  });
});

describe("support session view (screen 14)", () => {
  const READS: Record<string, string> = {
    profile: "GET /v1/organisations/{organisation_id}/support-view/profile",
    structure: "GET /v1/organisations/{organisation_id}/support-view/brands",
    registrations: "GET /v1/organisations/{organisation_id}/support-view/tax-registrations",
    series: "GET /v1/organisations/{organisation_id}/support-view/document-series",
    settings: "GET /v1/organisations/{organisation_id}/support-view/settings",
    members: "GET /v1/organisations/{organisation_id}/support-view/members",
    roles: "GET /v1/organisations/{organisation_id}/support-view/roles",
    devices: "GET /v1/organisations/{organisation_id}/support-view/devices",
  };

  it("each tab is one read of its own endpoint, and the view issues no write (AC 53, 55)", async () => {
    const { mock } = mount(VIEW, { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    await findById("support-panel-profile");
    for (const [tab, key] of Object.entries(READS)) {
      click(`support-tab-${tab}`);
      await until(() => expect(mock.callsOf(key).length).toBeGreaterThanOrEqual(1));
    }
    expect(mock.calls.filter((c) => c.path.includes("/support-view/")).every((c) => c.method === "GET")).toBe(true);
    expect(mock.calls.some((c) => ["POST", "PUT", "PATCH", "DELETE"].includes(c.method) && c.path.includes("support-view"))).toBe(false);
    const controls = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent ?? "").toLowerCase());
    expect(controls.some((c) => /\b(edit|delete|save|add|remove)\b/.test(c))).toBe(false);
  });

  it("members show the masked mobile and names, and no email or ID document (AC 54)", async () => {
    const { mock } = mount(`${VIEW}/members`, { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    mock.on(READS.roles!, { status: 200, body: { items: [{ ...recorded<{ items: object[] }>("listSupportRoles").items[0], id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a65", name: "Owner" }] } });
    await until(() => expect(byId("support-members").textContent).toContain("Asha"));
    const mobiles = screen.getAllByTestId("member-mobile").map((e) => e.textContent);
    expect(mobiles.length).toBeGreaterThan(0);
    for (const m of mobiles) expect(m).toMatch(/^\+91\*{7}\d{3}$/); // last three digits only
    expect(byId("support-members").textContent).toContain("Owner");
    expect(document.body.textContent).not.toMatch(/@|\+91\d{10}|aadhaar|passport/i);
  });

  it("a read refused because the session ended returns to the ended screen and shows no stale data (AC 56)", async () => {
    const { mock, state } = mount(`${VIEW}/members`, { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    mock.on(READS.members!, problem(409, "support_session_ended"));
    expect(await findById("support-ended")).toBeTruthy();
    expect(byId("support-ended-text").textContent).toContain("the session expired");
    expect(state.session()?.support).toBeUndefined();
    expect(queryById("support-banner")).toBeNull();
    expect(queryById("support-members")).toBeNull();
  });

  it("when the access could not be recorded nothing is shown (BR-48)", async () => {
    const { mock } = mount(`${VIEW}/members`, { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    mock.on(READS.members!, problem(503, "upstream_unavailable"));
    expect((await findById("support-audit-failed")).textContent).toContain("Access could not be recorded, so nothing is shown.");
    expect(queryById("support-members")).toBeNull();
  });

  it("without a session for this organisation the page offers no data", async () => {
    const { mock } = mount(VIEW, { session: sessionOf(SUPPORT_PERMS) });
    expect(await findById("support-none")).toBeTruthy();
    expect(mock.calls.some((c) => c.path.includes("support-view"))).toBe(false);
  });
});

describe("support banner and ending a session", () => {
  it("End session calls the server and shows screen 15 'ended by you'; the banner is gone (AC 57)", async () => {
    const { mock, state } = mount(VIEW, { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    await findById("support-banner");
    click("support-banner-end");
    expect(await findById("support-ended")).toBeTruthy();
    expect(byId("support-ended-text").textContent).toMatch(/Example Hospitality - ended by you at \d\d:\d\d IST\./);
    expect(mock.callsOf("DELETE /v1/support-sessions/current")).toHaveLength(1);
    expect(state.session()?.support).toBeUndefined();
    expect(queryById("support-banner")).toBeNull();
  });

  it("the banner stays on other screens with a link back to the session", async () => {
    mount("/organisations", { session: sessionOf(SUPPORT_PERMS, { support: active() }) });
    await findById("support-banner");
    expect(byId("support-banner-back").getAttribute("href")).toBe(`/support-session/${ORG}`);
  });

  it("says 'Ends soon' in the last five minutes, in text", async () => {
    mount("/organisations", { session: sessionOf(SUPPORT_PERMS, { support: active(4.5) }) });
    expect((await findById("support-banner-soon")).textContent).toBe("Ends soon");
  });

  it("at zero the session ends on screen and the user is taken to screen 15", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const { state } = mount("/organisations", { session: sessionOf(SUPPORT_PERMS, { support: active(0.05) }) });
    await vi.advanceTimersByTimeAsync(5000);
    await until(() => expect(screen.queryByTestId("support-ended")).not.toBeNull());
    expect(state.session()?.support).toBeUndefined();
  });

  it("the countdown shows mm:ss and never goes negative", () => {
    expect(formatRemaining(27 * 60_000 + 42_000)).toBe("27:42");
    expect(formatRemaining(-5000)).toBe("00:00");
  });
});
