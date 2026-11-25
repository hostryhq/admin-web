import { describe, expect, it } from "vitest";
import { screen } from "@solidjs/testing-library";
import { problem } from "../test/mockAdmin";
import { detail, orgList, summary } from "../test/data";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../test/harness";

const READ = ["admin.org.read"];

describe("organisation list (screen 5)", () => {
  it("shows name, short id, status, outlets, owner and the created date in IST, and no full mobile number", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    mock.on("GET /v1/organisations", { status: 200, body: orgList([summary(1, { name: "Anand Bhavan", status: "active", outlet_count: 3, owner_status: "accepted" })]) });
    const table = await findById("orgs-table");
    await until(() => expect(table.textContent).toContain("Anand Bhavan"));
    const text = table.textContent ?? "";
    expect(text).toContain("Active");
    expect(text).toContain("Accepted");
    expect(text).toContain("0190a1b2");
    expect(text).not.toContain("0190a1b2-c3d4"); // short id only
    expect(text).toMatch(/24 Nov 2026.*10:42 IST/); // 05:12 UTC is 10:42 IST
    expect(document.body.textContent).not.toMatch(/\+91\s?\d{5}|\b\d{10}\b/); // no full mobile anywhere
  });

  it("asks for 25 newest first and appends the next cursor page without repeats", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    const page1 = Array.from({ length: 25 }, (_v, i) => summary(i + 1));
    const page2 = Array.from({ length: 10 }, (_v, i) => summary(i + 26));
    mock.on("GET /v1/organisations", (r) =>
      r.query.get("cursor") === "c2"
        ? { status: 200, body: orgList(page2) }
        : { status: 200, body: orgList(page1, { next_cursor: "c2" }) },
    );
    await until(() => expect(screen.getAllByTestId("org-name")).toHaveLength(25));
    expect(mock.callsOf("GET /v1/organisations")[0]?.query).toContain("limit=25");
    click("orgs-more");
    await until(() => expect(screen.getAllByTestId("org-name")).toHaveLength(35));
    const names = screen.getAllByTestId("org-name").map((e) => e.textContent);
    expect(new Set(names).size).toBe(35);
    expect(queryById("orgs-more")).toBeNull(); // no further cursor
  });

  it("search submits the typed text and replaces the list; no match shows the empty state with the exact-match hint", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    mock.on("GET /v1/organisations", (r) => ({ status: 200, body: orgList(r.query.get("q") ? [] : [summary(1)]) }));
    await until(() => expect(screen.getAllByTestId("org-name")).toHaveLength(1));
    type("orgs-search", "nothing-like-this");
    click("orgs-search-submit");
    expect((await findById("orgs-nomatch")).textContent).toContain("GSTIN and mobile must be complete");
    expect(mock.callsOf("GET /v1/organisations").at(-1)?.query).toContain("q=nothing-like-this");
  });

  it("a status filter is sent to the server", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    await findById("orgs-table");
    const select = byId("orgs-status") as HTMLSelectElement;
    select.value = "suspended";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => expect(mock.callsOf("GET /v1/organisations").at(-1)?.query).toContain("status=suspended"));
  });

  it("when identity is down the rows load, owners show Unknown, and a notice explains it (AC 19)", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    mock.on("GET /v1/organisations", { status: 200, body: orgList([summary(1), summary(2)], { owner_status_available: false }) });
    expect((await findById("orgs-identity-down")).textContent).toContain("Owner status is unavailable");
    await until(() => expect(screen.getAllByTestId("badge-owner-unknown")).toHaveLength(2));
  });

  it("when tenancy is down it shows an error with Retry and no partial rows; Retry reloads", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    let fail = true;
    mock.on("GET /v1/organisations", () => (fail ? problem(503, "upstream_unavailable") : { status: 200, body: orgList([summary(1)]) }));
    const error = await findById("orgs-error");
    expect(error.textContent).toContain("not available");
    expect(queryById("orgs-table")).toBeNull();
    fail = false;
    click("orgs-error-retry");
    await until(() => expect(screen.getAllByTestId("org-name")).toHaveLength(1));
  });

  it("an empty directory offers New organisation to creators only", async () => {
    const creator = mount("/organisations", { session: sessionOf([...READ, "admin.org.create"]) });
    creator.mock.on("GET /v1/organisations", { status: 200, body: orgList([]) });
    expect((await findById("orgs-empty")).textContent).toContain("No organisations yet.");
    expect(screen.getAllByTestId("orgs-new").length).toBeGreaterThan(0);
  });

  it("a user without admin.org.create sees no New organisation control (AC 30)", async () => {
    const { mock } = mount("/organisations", { session: sessionOf(READ) });
    mock.on("GET /v1/organisations", { status: 200, body: orgList([]) });
    await findById("orgs-empty");
    expect(queryById("orgs-new")).toBeNull();
  });
});

describe("organisation detail (screen 6)", () => {
  const ORG = "/organisations/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";

  it("shows brands, outlets and registrations with a verification badge, but no members, devices or settings (AC 20)", async () => {
    mount(ORG, { session: sessionOf(READ) });
    await findById("org-overview");
    expect(byId("org-brands").textContent).toContain("Example Hospitality");
    expect(byId("org-outlets").textContent).toContain("Restaurant");
    expect(byId("org-outlets").textContent).toContain("Tamil Nadu");
    expect(byId("org-registrations").textContent).toContain("Unverified");
    expect(byId("org-overview").textContent).toContain("only visible in a support session");
    expect(queryById("org-tab-devices")).toBeNull(); // no admin.device.read
    expect(queryById("org-start-support")).toBeNull(); // no admin.support.session.start
    expect(queryById("org-verify")).toBeNull(); // no admin.registration.verify (AC 72)
  });

  it("an unregistered registration shows 'Not required' and no Verify control", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.registration.verify"]) });
    const base = detail();
    mock.on("GET /v1/organisations/{organisation_id}", {
      status: 200,
      body: { ...base, registrations: [{ ...base.registrations[0]!, regime: "unregistered", gstin: undefined, verification_state: "unverified" }] },
    });
    await until(() => expect(byId("org-registrations").textContent).toContain("Not required"));
    expect(queryById("org-verify")).toBeNull();
  });

  it("verifies a registration with a method, and refuses `gstin_in_use` without changing it", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.registration.verify"]) });
    click(await findById("org-verify").then(() => "org-verify"));
    mock.on("PUT /v1/organisations/{organisation_id}/tax-registrations/{registration_id}/verification", problem(409, "gstin_in_use"));
    click("verify-submit");
    expect((await findById("verify-error")).textContent).toContain("already belongs to another organisation");
    mock.on("PUT /v1/organisations/{organisation_id}/tax-registrations/{registration_id}/verification", { status: 200, body: {} });
    click("verify-submit");
    await until(() => expect(queryById("verify-dialog")).toBeNull());
    const sent = mock.callsOf("PUT /v1/organisations/{organisation_id}/tax-registrations/{registration_id}/verification").at(-1);
    expect(sent?.body).toEqual({ method: "certificate_seen" });
  });

  it("a pending invitation shows the masked number and expiry and offers Resend/extend and Cancel", async () => {
    mount(ORG, { session: sessionOf([...READ, "admin.owner_invite.manage"]) });
    await findById("invite-details");
    expect(byId("invite-mobile").textContent).toBe("+91*******210");
    expect(byId("invite-card").textContent).toContain("Expires 08 Dec 2026");
    expect(queryById("invite-extend")).not.toBeNull();
    expect(queryById("invite-cancel")).not.toBeNull();
    expect(queryById("invite-issue")).toBeNull();
  });

  it("extending posts a renewal for the same invitation id; cancelling asks once, with focus on Keep", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.owner_invite.manage"]) });
    await findById("invite-details");
    click("invite-extend");
    expect((await findById("invite-extend-dialog")).textContent).toContain("The invitation id stays the same.");
    click("invite-extend-submit");
    await until(() => expect(queryById("invite-extend-dialog")).toBeNull());
    const renew = mock.callsOf("POST /v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/renewals")[0];
    expect(renew?.path).toContain("/owner-invitations/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a67/renewals");

    click("invite-cancel");
    await findById("invite-cancel-dialog");
    expect(byId("invite-cancel-keep").hasAttribute("data-autofocus")).toBe(true);
    click("invite-cancel-submit");
    await until(() => expect(queryById("invite-cancel-dialog")).toBeNull());
    expect(mock.callsOf("PUT /v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/cancellation")).toHaveLength(1);
  });

  it("an accepted invitation shows the date and no actions at all (AC 33)", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.owner_invite.manage"]) });
    const base = detail();
    mock.on("GET /v1/organisations/{organisation_id}", {
      status: 200,
      body: { ...base, owner_status: "accepted", owner_invitations: [{ ...base.owner_invitations[0]!, status: "accepted", accepted_at: "2026-11-26T05:12:00.000Z" }] },
    });
    await until(() => expect(byId("invite-accepted").textContent).toContain("Accepted 26 Nov 2026"));
    for (const id of ["invite-extend", "invite-cancel", "invite-issue"]) expect(queryById(id)).toBeNull();
  });

  it("an expired invitation with no owner offers Re-issue and not Cancel (AC 34)", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.owner_invite.manage"]) });
    const base = detail();
    mock.on("GET /v1/organisations/{organisation_id}", {
      status: 200,
      body: { ...base, owner_status: "expired", owner_invitations: [{ ...base.owner_invitations[0]!, status: "expired" }] },
    });
    await until(() => expect(byId("invite-issue").textContent).toBe("Re-issue"));
    expect(queryById("invite-cancel")).toBeNull();
  });

  it("an incomplete onboarding shows the warning and Retry invitation, which asks for the number again and completes the same organisation (AC 28)", async () => {
    const { mock } = mount(ORG, { session: sessionOf([...READ, "admin.owner_invite.manage"]) });
    mock.on("GET /v1/organisations/{organisation_id}", { status: 200, body: { ...detail(), onboarding_state: "incomplete", owner_status: "none", owner_invitations: [] } });
    expect((await findById("invite-incomplete")).textContent).toContain("Onboarding incomplete");
    expect(byId("invite-issue").textContent).toBe("Retry invitation");
    click("invite-issue");
    await findById("invite-issue-dialog");
    type("invite-name", "Asha");
    type("invite-mobile-input", "9876543210");
    click("invite-issue-submit");
    await until(() => expect(mock.callsOf("POST /v1/organisations/{organisation_id}/owner-invitations")).toHaveLength(1));
    const sent = mock.callsOf("POST /v1/organisations/{organisation_id}/owner-invitations")[0];
    expect(sent?.path).toBe("/v1/organisations/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60/owner-invitations"); // the same organisation
    expect(sent?.body).toEqual({ name: "Asha", mobile_e164: "+919876543210" });
  });

  it("invitation controls are absent without admin.owner_invite.manage", async () => {
    mount(ORG, { session: sessionOf(READ) });
    await findById("invite-details");
    for (const id of ["invite-extend", "invite-cancel", "invite-issue"]) expect(queryById(id)).toBeNull();
  });

  it("an unknown organisation shows not found", async () => {
    const { mock } = mount(ORG, { session: sessionOf(READ) });
    mock.on("GET /v1/organisations/{organisation_id}", problem(404, "not_found"));
    expect((await findById("org-notfound")).textContent).toContain("not found");
  });
});
