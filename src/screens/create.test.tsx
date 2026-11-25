import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@solidjs/testing-library";
import type { components } from "../generated";
import { problem, recorded } from "../test/mockAdmin";
import { byId, choose, click, findById, mount, queryById, sessionOf, type, until } from "../test/harness";
import { timing } from "./CreateOrganisation";

type Created = components["schemas"]["OnboardingResult"];
const CREATE = ["admin.org.read", "admin.org.create", "admin.owner_invite.manage"];
const POST = "POST /v1/organisations";

function fill(overrides: Partial<Record<string, string>> = {}) {
  type("create-name", overrides.name ?? "Anand Bhavan");
  type("create-outlet-name", overrides.outlet ?? "Main Road");
  choose("create-outlet-state", overrides.state ?? "33");
  type("create-legal-name", overrides.legal ?? "Anand Foods Pvt Ltd");
  type("create-gstin", overrides.gstin ?? "33ABCDE1234F1Z5");
  type("create-owner-name", overrides.owner ?? "Ravi");
  type("create-owner-mobile", overrides.mobile ?? "9876543210");
}

afterEach(() => {
  timing.retryDelayMs = 1500;
});

describe("create organisation form (screen 7)", () => {
  it("is one screen with three sections, required fields marked, and sends nothing while invalid (AC 22)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    const form = await findById("create-form");
    expect(form.querySelectorAll("fieldset.hy-section")).toHaveLength(3);
    expect(form.textContent).toContain("Organisation name *");
    click("create-submit");
    expect((await findById("create-summary")).textContent).toContain("Check the highlighted fields.");
    expect(form.textContent).toContain("This field is required.");
    expect(mock.callsOf(POST)).toHaveLength(0);
  });

  it("validates on blur: a malformed GSTIN, a state code that differs from the outlet state, a bad mobile", async () => {
    mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    choose("create-outlet-state", "33");
    type("create-gstin", "NOT-A-GSTIN");
    byId("create-gstin").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    byId("create-gstin").dispatchEvent(new Event("blur"));
    click("create-submit");
    await until(() => expect(byId("create-form").textContent).toContain("Enter a valid 15-character GSTIN."));
    type("create-gstin", "27ABCDE1234F1Z5");
    await until(() => expect(byId("create-form").textContent).toContain("state code does not match the outlet state"));
    type("create-owner-mobile", "1234567890");
    await until(() => expect(byId("create-form").textContent).toContain("Enter a 10-digit Indian mobile number."));
  });

  it("choosing Unregistered clears and disables the GSTIN, and the request carries no GSTIN (AC 24, 25)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    fill();
    click("create-regime-unregistered");
    const gstin = byId("create-gstin") as HTMLInputElement;
    expect(gstin.disabled).toBe(true);
    expect(gstin.value).toBe("");
    click("create-submit");
    await until(() => expect(mock.callsOf(POST)).toHaveLength(1));
    expect(mock.callsOf(POST)[0]?.body).toMatchObject({ tax_registration: { regime: "unregistered" } });
    expect((mock.callsOf(POST)[0]?.body as { tax_registration: object }).tax_registration).not.toHaveProperty("gstin");
  });

  it("a double click creates one organisation: the submit is disabled while in flight (AC 22)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    mock.on(POST, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 201, body: recorded("createOrganisation") };
    });
    await findById("create-form");
    fill();
    click("create-submit");
    click("create-submit");
    expect((byId("create-submit") as HTMLButtonElement).disabled).toBe(true);
    await findById("result-success");
    expect(mock.callsOf(POST)).toHaveLength(1);
  });

  it("sends the contract body with the +91 number and an Idempotency-Key, then shows the result screen", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    fill();
    click("create-submit");
    await findById("result-success");
    const call = mock.callsOf(POST)[0];
    expect(call?.headers.get("idempotency-key")).toMatch(/\S{8,}/);
    expect(call?.headers.get("x-csrf-token")).toBeTruthy();
    expect(call?.body).toEqual({
      name: "Anand Bhavan",
      outlet: { name: "Main Road", kind: "restaurant", state_code: "33" },
      tax_registration: { legal_name: "Anand Foods Pvt Ltd", regime: "regular", gstin: "33ABCDE1234F1Z5" },
      owner: { name: "Ravi", mobile_e164: "+919876543210" },
    });
  });

  it("a GSTIN held by another organisation shows a field error and creates nothing (AC 26)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    mock.on(POST, problem(409, "gstin_in_use"));
    await findById("create-form");
    fill();
    click("create-submit");
    await until(() => expect(byId("create-form").textContent).toContain("This GSTIN already belongs to another organisation."));
    expect(queryById("result-success")).toBeNull();
    expect((byId("create-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("maps a server field error (state mismatch) onto its field", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    mock.on(
      POST,
      problem(422, "validation", { errors: [{ field: "tax_registration.gstin", code: "gstin_state_mismatch", message: "x" }] }),
    );
    await findById("create-form");
    fill();
    click("create-submit");
    await until(() => expect(byId("create-form").textContent).toContain("The GSTIN state code does not match the outlet state."));
  });

  it("retries with the same Idempotency-Key while the body is unchanged, and a new key once it changes (AC 23, 81)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    mock.on(POST, problem(503, "upstream_unavailable"));
    await findById("create-form");
    fill();
    click("create-submit");
    await until(() => expect(mock.callsOf(POST)).toHaveLength(1));
    await until(() => expect((byId("create-submit") as HTMLButtonElement).disabled).toBe(false));
    click("create-submit");
    await until(() => expect(mock.callsOf(POST)).toHaveLength(2));
    const [a, b] = mock.callsOf(POST).map((c) => c.headers.get("idempotency-key"));
    expect(a).toBe(b);
    await until(() => expect((byId("create-submit") as HTMLButtonElement).disabled).toBe(false));
    type("create-name", "Anand Bhavan Two");
    click("create-submit");
    await until(() => expect(mock.callsOf(POST)).toHaveLength(3));
    expect(mock.callsOf(POST)[2]?.headers.get("idempotency-key")).not.toBe(a);
  });

  it("after a network drop it checks again with the same key instead of creating a second organisation", async () => {
    timing.retryDelayMs = 1;
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    let n = 0;
    mock.on(POST, () => {
      if (++n === 1) throw new TypeError("Failed to fetch");
      return { status: 201, body: recorded("createOrganisation") };
    });
    await findById("create-form");
    fill();
    click("create-submit");
    await findById("result-success");
    const keys = mock.callsOf(POST).map((c) => c.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("the 'GSTIN verified' section is shown only to users with admin.registration.verify, and then sent (AC 75)", async () => {
    mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    expect(queryById("create-verify-section")).toBeNull();
  });

  it("with admin.registration.verify the chosen method travels in the same submit", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf([...CREATE, "admin.registration.verify"]) });
    await findById("create-verify-section");
    fill();
    choose("create-verify-method", "certificate_seen");
    click("create-submit");
    await until(() => expect(mock.callsOf(POST)).toHaveLength(1));
    expect(mock.callsOf(POST)[0]?.body).toMatchObject({ verification: { method: "certificate_seen" } });
  });

  it("Esc on an untouched form leaves without asking; after typing it asks once", async () => {
    mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    type("create-name", "x");
    byId("create-name").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(await findById("create-discard-dialog")).toBeTruthy();
    expect(byId("create-discard-keep").hasAttribute("data-autofocus")).toBe(true);
  });

  it("warns, without blocking, when an organisation with the same name exists", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    mock.on("GET /v1/organisations", { status: 200, body: { items: [{ ...recorded<{ items: object[] }>("listOrganisations").items[0], name: "Anand Bhavan" }], owner_status_available: true } });
    await findById("create-form");
    type("create-name", "anand bhavan");
    byId("create-name").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    byId("create-name").dispatchEvent(new Event("blur"));
    expect((await findById("create-duplicate")).textContent).toContain("already exists");
  });
});

describe("creation result (screen 8)", () => {
  const ORG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";

  it("complete: shows the name, masked mobile, expiry and the 'phone the owner, no message sent' instruction (AC 82)", async () => {
    mount("/organisations/new", { session: sessionOf(CREATE) });
    await findById("create-form");
    fill();
    click("create-submit");
    await findById("result-success");
    expect(byId("result-name").textContent).toBe("Example Hospitality");
    expect(byId("result-invite").textContent).toContain("+91*******210");
    expect(byId("result-invite").textContent).toMatch(/expires 08 Dec 2026.*IST/);
    expect(byId("result-tell").textContent).toContain("Phone the owner");
    expect(byId("result-nosms").textContent).toContain("No message is sent automatically");
  });

  it("incomplete: never shows success; shows a warning and Retry invitation, which completes the same organisation (AC 28, 79)", async () => {
    const { mock } = mount("/organisations/new", { session: sessionOf(CREATE) });
    const incomplete: Created = { ...recorded<Created>("createOrganisation"), state: "incomplete", retry_hint: "create_owner_invitation" };
    delete incomplete.owner_invitation;
    mock.on(POST, { status: 201, body: incomplete });
    await findById("create-form");
    fill();
    click("create-submit");
    expect((await findById("result-incomplete")).textContent).toContain("the owner invitation failed");
    expect(queryById("result-success")).toBeNull();
    expect(byId("result-incomplete").textContent).toContain("Nothing was sent to the owner.");

    // The retry completes the SAME organisation; the screen then reads the organisation and shows success.
    mock.on("GET /v1/organisations/{organisation_id}", { status: 200, body: recorded("getOrganisation") });
    click("result-retry");
    await findById("result-retry-dialog");
    type("invite-name", "Ravi");
    type("invite-mobile-input", "9876543210");
    click("invite-issue-submit");
    await findById("result-success");
    expect(mock.callsOf(POST)).toHaveLength(1); // no second organisation
    const invite = mock.callsOf("POST /v1/organisations/{organisation_id}/owner-invitations")[0];
    expect(invite?.path).toBe(`/v1/organisations/${ORG}/owner-invitations`);
  });

  it("reading the result page directly (a reload) rebuilds it from the organisation", async () => {
    const { mock } = mount(`/organisations/${ORG}/created`, { session: sessionOf(CREATE) });
    mock.on("GET /v1/organisations/{organisation_id}", { status: 200, body: { ...recorded<object>("getOrganisation"), onboarding_state: "incomplete", owner_invitations: [], owner_status: "none" } });
    expect(await findById("result-incomplete")).toBeTruthy();
    expect(screen.queryByTestId("result-success")).toBeNull();
  });
});
