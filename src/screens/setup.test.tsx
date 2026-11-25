import { afterEach, describe, expect, it } from "vitest";
import { problem } from "../test/mockAdmin";
import { byId, findById, mount, queryById, type, until } from "../test/harness";
import { secretFromUri } from "./SetupAccount";

const BEGIN = "POST /v1/account-setups";
const COMPLETE = "POST /v1/account-setup-completions";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function open(hash: string) {
  window.history.replaceState(null, "", `/setup${hash}`);
  return mount("/setup", { session: null });
}

describe("account setup (screen 2)", () => {
  it("reads the token from the URL fragment, removes it from the address bar, and sends it in the body only (AC 5)", async () => {
    const { mock } = open("#tok-abc-123");
    await findById("setup-card");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("tok-abc-123");
    const call = mock.callsOf(BEGIN)[0];
    expect(call?.body).toEqual({ setup_token: "tok-abc-123" });
    expect(call?.path).not.toContain("tok-abc-123");
    expect(call?.query).toBe("");
  });

  it("shows the authenticator key to type in, grouped in fours", async () => {
    open("#tok");
    expect((await findById("setup-key")).textContent).toBe("EXAM PLEE XAMP LE23 4");
    expect(secretFromUri("otpauth://totp/x?secret=abcd2345&issuer=Hostry")).toBe("ABCD 2345");
    expect(secretFromUri("otpauth://totp/x")).toBeUndefined();
  });

  it("a missing, used, expired or unknown link shows one generic page that reveals no reason (AC 5, 6)", async () => {
    const none = open("");
    expect(await findById("setup-invalid")).toBeTruthy();
    expect(none.mock.callsOf(BEGIN)).toHaveLength(0);
  });

  it("a link the server refuses shows the same generic page", async () => {
    const { mock } = open("#used");
    mock.on(BEGIN, problem(422, "setup_link_invalid"));
    const page = await findById("setup-invalid");
    expect(page.textContent).toContain("This link cannot be used. Ask a platform admin for a new one.");
  });

  it("enforces 12+ characters, a password that is not the email, matching repeats and a 6-digit code", async () => {
    open("#tok");
    await findById("setup-card");
    const submit = byId("setup-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("setup-password", "short");
    expect(byId("setup-card").textContent).toContain("At least 12 characters");
    expect(byId("setup-length").textContent).toBe("Length 5/12");
    type("setup-password", "staff@example.invalid");
    expect(byId("setup-card").textContent).toContain("Password cannot be your email");
    type("setup-password", "a-long-enough-passphrase");
    type("setup-repeat", "a-different-passphrase");
    expect(byId("setup-card").textContent).toContain("Passwords do not match");
    type("setup-repeat", "a-long-enough-passphrase");
    type("setup-code", "123456");
    expect(submit.disabled).toBe(false);
  });

  it("completing sends password and code with the token, then goes to sign-in with a notice", async () => {
    const { mock } = open("#tok-xyz");
    await findById("setup-card");
    type("setup-password", "a-long-enough-passphrase");
    type("setup-repeat", "a-long-enough-passphrase");
    type("setup-code", "123456");
    byId("setup-card").querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(await findById("signin-setup-done")).toBeTruthy();
    expect(mock.callsOf(COMPLETE)[0]?.body).toEqual({ setup_token: "tok-xyz", password: "a-long-enough-passphrase", totp_code: "123456" });
  });

  it("a link used meanwhile (refused on completion) shows the generic page", async () => {
    const { mock } = open("#tok");
    await findById("setup-card");
    mock.on(COMPLETE, problem(422, "setup_link_invalid"));
    type("setup-password", "a-long-enough-passphrase");
    type("setup-repeat", "a-long-enough-passphrase");
    type("setup-code", "123456");
    byId("setup-card").querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => expect(queryById("setup-invalid")).not.toBeNull());
  });
});
