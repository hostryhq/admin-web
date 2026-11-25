import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { ALL_A0_PERMISSIONS } from "./session/session";
import { ROUTES } from "./routes";
import { problem, recorded } from "./test/mockAdmin";
import { byId, findById, missingTestIds, mount, queryById, sessionOf, until } from "./test/harness";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("routes and permission gating", () => {
  it("sends a signed-out user to sign-in (the cookie check says no session)", async () => {
    const { mock } = mount("/organisations", { session: null });
    mock.signOut();
    expect(await findById("signin-card")).toBeTruthy();
    expect(queryById("nav-orgs")).toBeNull();
  });

  it("restores a session from the cookie before showing the page, keeping the deep link", async () => {
    const { mock, state } = mount("/audit", { session: null });
    const base = recorded<{ user: object }>("getSession");
    mock.on("GET /v1/sessions/current", () => ({
      status: 200,
      body: { ...base, user: { ...base.user, permissions: ["admin.audit.read_own"] } },
    }));
    expect(await findById("audit-filters")).toBeTruthy();
    expect(state.session()?.permissions).toEqual(["admin.audit.read_own"]);
    expect(state.session()?.csrfToken).toBeTruthy();
  });

  const paramFor = (path: string) => path.replace(":orgId", "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60").replace("/:tab?", "");
  const gated = Object.values(ROUTES).filter((r) => !("public" in r));

  it.each(gated.map((r) => [r.id, r] as const))("%s renders for a user with every permission", async (_id, r) => {
    mount(paramFor(r.path), { session: sessionOf(ALL_A0_PERMISSIONS) });
    expect(await findById("page-title")).toBeTruthy();
    expect(byId("page-title").textContent).toBeTruthy();
  });

  it("/organisations/new is the create screen, not an organisation named new", async () => {
    mount("/organisations/new");
    expect(await findById("create-form")).toBeTruthy();
  });

  it("nav items without permission are absent, not disabled", async () => {
    mount("/organisations", { session: sessionOf(["admin.org.read"]) });
    await findById("orgs-table");
    expect(byId("nav-orgs")).toBeTruthy();
    expect(queryById("nav-audit")).toBeNull();
    expect(queryById("nav-approvals")).toBeNull();
    expect(queryById("nav-staff")).toBeNull();
  });

  it("audit needs either read or read_own", async () => {
    mount("/organisations", { session: sessionOf(["admin.org.read", "admin.audit.read_own"]) });
    await findById("orgs-table");
    expect(byId("nav-audit")).toBeTruthy();
  });

  it("a direct URL without permission shows the forbidden page and no content (approvals needs admin.device.revoke)", async () => {
    mount("/approvals", { session: sessionOf(["admin.org.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
    expect(queryById("approvals-table")).toBeNull();
    expect(byId("forbidden").textContent).toContain("You do not have access to this.");
  });

  it("unknown URLs show not-found", async () => {
    mount("/nope", { session: sessionOf(["admin.org.read"]) });
    expect(await findById("not-found")).toBeTruthy();
  });
});

describe("session", () => {
  it("a 401 on a signed-in call ends the session and shows screen 3", async () => {
    const { mock, state } = mount("/organisations", { session: sessionOf(["admin.org.read"]) });
    await findById("orgs-table");
    mock.signOut();
    fireEvent.submit(byId("orgs-search-form"));
    expect(await findById("session-ended-card")).toBeTruthy();
    expect(state.session()).toBeUndefined();
  });

  it("sign-out calls the server with the CSRF token (it clears the cookie) and goes to sign-in", async () => {
    const { mock, state } = mount("/organisations", { session: sessionOf(["admin.org.read"]) });
    await findById("orgs-table");
    fireEvent.click(byId("nav-signout"));
    expect(await findById("signin-card")).toBeTruthy();
    expect(state.session()).toBeUndefined();
    const call = mock.calls.find((c) => c.method === "DELETE" && c.path === "/v1/sessions/current");
    expect(call?.headers.get("x-csrf-token")).toBeTruthy();
    for (const c of mock.calls) expect(c.headers.has("authorization")).toBe(false);
  });

  it("every interactive element of a main screen has a data-testid (AC 62)", async () => {
    mount("/organisations", { session: sessionOf(ALL_A0_PERMISSIONS) });
    await findById("orgs-table");
    expect(missingTestIds()).toEqual([]);
  });
});

describe("shell", () => {
  it("shows the offline banner when the browser goes offline, and clears it on return", async () => {
    mount("/organisations", { session: sessionOf(["admin.org.read", "admin.org.create"]) });
    await findById("orgs-table");
    window.dispatchEvent(new Event("offline"));
    flush();
    expect(byId("offline-banner").textContent).toContain("You are offline. Changes are disabled.");
    window.dispatchEvent(new Event("online"));
    flush();
    expect(byId("offline-banner").textContent).toBe("");
  });

  it("the keyboard shortcut g then a navigates to the audit log for a permitted user", async () => {
    mount("/organisations", { session: sessionOf(["admin.org.read", "admin.audit.read"]) });
    await findById("orgs-table");
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(await findById("audit-filters")).toBeTruthy();
  });

  it("? opens the shortcut sheet listing only usable shortcuts", async () => {
    mount("/organisations", { session: sessionOf(["admin.org.read"]) });
    await findById("orgs-table");
    fireEvent.keyDown(document.body, { key: "?" });
    const sheet = await findById("shortcuts-dialog");
    expect(sheet.textContent).toContain("Go to organisations");
    expect(sheet.textContent).not.toContain("Go to vendor staff");
  });

  it("warns at 28 minutes idle, keeps the session on Stay (touching the server), and signs out at 30", async () => {
    vi.useFakeTimers();
    const { mock, state } = mount("/organisations", { session: sessionOf(["admin.org.read"]) });
    await vi.advanceTimersByTimeAsync(10);
    vi.advanceTimersByTime(28 * 60_000);
    flush();
    expect(byId("idle-dialog")).toBeTruthy();
    expect(byId("idle-message").textContent).toBe("Signing out in 2 min.");

    fireEvent.click(byId("idle-stay"));
    flush();
    expect(queryById("idle-dialog")).toBeNull();
    expect(state.session()).toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    expect(mock.calls.some((c) => c.path === "/v1/sessions/current")).toBe(true);

    vi.advanceTimersByTime(30 * 60_000 + 1_000); // the interval ticks once a second
    flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(state.session()).toBeUndefined();
    await until(() => expect(byId("session-ended-reason").textContent).toContain("30 minutes of inactivity"));
  });
});

describe("sign-in screen", () => {
  it("fails generically, keeps the email, clears password and code, and returns focus to email", async () => {
    const { mock } = mount("/signin", { session: null });
    mock.signOut();
    mock.on("POST /v1/sessions", problem(401, "sign_in_failed"));
    const email = (await findById("signin-email")) as HTMLInputElement;
    const password = byId("signin-password") as HTMLInputElement;
    const code = byId("signin-code") as HTMLInputElement;
    email.value = "someone@example.com";
    password.value = "not-a-real-password";
    code.value = "123456";
    fireEvent.submit(email.form as HTMLFormElement);
    const alert = await findById("signin-error");
    expect(alert.textContent).toContain("Sign-in failed. Check your details and try again.");
    expect(email.value).toBe("someone@example.com");
    expect(password.value).toBe("");
    expect(code.value).toBe("");
    expect(document.activeElement).toBe(email);
  });

  it("gives the same message for a lockout (429) as for a wrong password (AC 2, 3)", async () => {
    const { mock } = mount("/signin", { session: null });
    mock.signOut();
    mock.on("POST /v1/sessions", problem(429, "rate_limited"));
    const email = (await findById("signin-email")) as HTMLInputElement;
    fireEvent.submit(email.form as HTMLFormElement);
    expect((await findById("signin-error")).textContent).toContain("Sign-in failed. Check your details and try again.");
  });

  it("signs in, lands on the organisation list, keeps no token in storage, and never puts the password in the URL", async () => {
    const { mock, state } = mount("/signin", { session: null });
    mock.signOut();
    const email = (await findById("signin-email")) as HTMLInputElement;
    email.value = "platform@example.invalid";
    (byId("signin-password") as HTMLInputElement).value = "correct-horse-battery-staple";
    (byId("signin-code") as HTMLInputElement).value = "123456";
    const form = email.form as HTMLFormElement;
    expect(form.method).toBe("post");
    fireEvent.submit(form);
    expect(await findById("orgs-table")).toBeTruthy();
    expect(state.session()?.csrfToken).toBeTruthy();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(window.location.search).toBe("");
    const signIn = mock.calls.find((c) => c.method === "POST" && c.path === "/v1/sessions");
    expect(signIn?.headers.has("authorization")).toBe(false);
    expect(signIn?.body).toMatchObject({ email: "platform@example.invalid", totp_code: "123456" });
  });

  it("tab order is email, password, code, sign in (the code field is the last input, so Enter submits)", async () => {
    const { mock } = mount("/signin", { session: null });
    mock.signOut();
    await findById("signin-card");
    const form = byId("signin-email").closest("form") as HTMLFormElement;
    const order = Array.from(form.querySelectorAll<HTMLElement>("input, button")).map((el) => el.dataset.testid);
    expect(order).toEqual(["signin-email", "signin-password", "signin-password-toggle", "signin-code", "signin-submit"]);
    expect(form.querySelector("button[type=submit]")).not.toBeNull();
    expect((byId("signin-password") as HTMLInputElement).type).toBe("password");
  });
});
