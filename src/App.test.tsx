import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { memoryHistory } from "@solidjs/router";
import { App } from "./App";
import { createAppTranslator } from "./i18n";
import { createAdminRouter } from "./router";
import { ALL_A0_PERMISSIONS, createSessionState, type AdminSession } from "./session/session";
import { ROUTES } from "./routes";

const user = (permissions: readonly string[], extra: Partial<AdminSession> = {}): AdminSession => ({
  name: "Asha",
  permissions,
  ...extra,
});

function mount(path: string, session?: AdminSession) {
  const state = createSessionState(session);
  render(() => (
    <App router={createAdminRouter(memoryHistory(path))} session={state} translator={createAppTranslator()} />
  ));
  return state;
}

afterEach(() => vi.useRealTimers());

describe("routes and permission gating", () => {
  it("sends a signed-out user to sign-in", async () => {
    mount("/organisations");
    expect(await screen.findByTestId("signin-card")).toBeTruthy();
    expect(screen.queryByTestId("nav-orgs")).toBeNull();
  });

  const paramFor = (path: string) => path.replace(":orgId", "018f3a2c").replace("/:tab?", "");
  const gated = Object.values(ROUTES).filter((r) => !("public" in r));

  it.each(gated.map((r) => [r.id, r] as const))("%s renders its placeholder for a user with every permission", async (id, r) => {
    mount(paramFor(r.path), user(ALL_A0_PERMISSIONS));
    expect(await screen.findByTestId(`screen-${id}`)).toBeTruthy();
    expect(screen.getByTestId("page-title").textContent).toBeTruthy();
  });

  it("/organisations/new is the create screen, not an organisation named new", async () => {
    mount("/organisations/new", user(ALL_A0_PERMISSIONS));
    expect(await screen.findByTestId("screen-organisationNew")).toBeTruthy();
  });

  it("nav items without permission are absent, not disabled", async () => {
    mount("/organisations", user(["admin.org.read"]));
    await screen.findByTestId("screen-organisations");
    expect(screen.getByTestId("nav-orgs")).toBeTruthy();
    expect(screen.queryByTestId("nav-audit")).toBeNull();
    expect(screen.queryByTestId("nav-staff")).toBeNull();
  });

  it("audit needs either read or read_own", async () => {
    mount("/organisations", user(["admin.org.read", "admin.audit.read_own"]));
    await screen.findByTestId("screen-organisations");
    expect(screen.getByTestId("nav-audit")).toBeTruthy();
  });

  it("a direct URL without permission shows the forbidden page and no content", async () => {
    mount("/staff", user(["admin.org.read"]));
    expect(await screen.findByTestId("forbidden")).toBeTruthy();
    expect(screen.queryByTestId("screen-staff")).toBeNull();
    expect(screen.getByTestId("forbidden").textContent).toContain("You do not have access to this.");
  });

  it("unknown URLs show not-found", async () => {
    mount("/nope", user(["admin.org.read"]));
    expect(await screen.findByTestId("not-found")).toBeTruthy();
  });
});

describe("shell", () => {
  it("shows the offline banner when the browser goes offline and clears it on return", async () => {
    mount("/organisations", user(["admin.org.read"]));
    await screen.findByTestId("screen-organisations");
    window.dispatchEvent(new Event("offline"));
    flush();
    expect(screen.getByTestId("offline-banner").textContent).toContain("You are offline. Changes are disabled.");
    window.dispatchEvent(new Event("online"));
    flush();
    expect(screen.getByTestId("offline-banner").textContent).toBe("");
  });

  it("the keyboard shortcut g then a navigates to the audit log for a permitted user", async () => {
    mount("/organisations", user(["admin.org.read", "admin.audit.read"]));
    await screen.findByTestId("screen-organisations");
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(await screen.findByTestId("screen-audit")).toBeTruthy();
  });

  it("? opens the shortcut sheet listing only usable shortcuts", async () => {
    mount("/organisations", user(["admin.org.read"]));
    await screen.findByTestId("screen-organisations");
    fireEvent.keyDown(document.body, { key: "?" });
    const sheet = await screen.findByTestId("shortcuts-dialog");
    expect(sheet.textContent).toContain("Go to organisations");
    expect(sheet.textContent).not.toContain("Go to vendor staff");
  });

  it("warns at 28 minutes idle, keeps the session on Stay, and signs out at 30", async () => {
    vi.useFakeTimers();
    const state = mount("/organisations", user(["admin.org.read"]));
    await vi.advanceTimersByTimeAsync(10);
    vi.advanceTimersByTime(28 * 60_000);
    flush();
    expect(screen.getByTestId("idle-dialog")).toBeTruthy();
    expect(screen.getByTestId("idle-message").textContent).toBe("Signing out in 2 min.");

    fireEvent.click(screen.getByTestId("idle-stay"));
    flush();
    expect(screen.queryByTestId("idle-dialog")).toBeNull();
    expect(state.session()).toBeDefined();

    vi.advanceTimersByTime(30 * 60_000 + 1_000); // the interval ticks once a second
    flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(state.session()).toBeUndefined();
    expect(screen.getByTestId("session-ended-reason").textContent).toContain("30 minutes of inactivity");
  });
});

describe("sign-in screen", () => {
  it("fails generically, keeps the email, clears password and code, and returns focus to email", async () => {
    mount("/signin");
    const email = (await screen.findByTestId("signin-email")) as HTMLInputElement;
    const password = screen.getByTestId("signin-password") as HTMLInputElement;
    const code = screen.getByTestId("signin-code") as HTMLInputElement;
    email.value = "someone@example.com";
    password.value = "not-a-real-password";
    code.value = "123456";
    fireEvent.submit(email.form as HTMLFormElement);
    const alert = await screen.findByTestId("signin-error");
    expect(alert.textContent).toContain("Sign-in failed. Check your details and try again.");
    expect(email.value).toBe("someone@example.com");
    expect(password.value).toBe("");
    expect(code.value).toBe("");
    expect(document.activeElement).toBe(email);
  });

  it("tab order is email, password, code, sign in (the code field is the last input, so Enter submits)", async () => {
    mount("/signin");
    await screen.findByTestId("signin-card");
    const form = screen.getByTestId("signin-email").closest("form") as HTMLFormElement;
    const order = Array.from(form.querySelectorAll<HTMLElement>("input, button")).map((el) => el.dataset.testid);
    expect(order).toEqual(["signin-email", "signin-password", "signin-password-toggle", "signin-code", "signin-submit"]);
    expect(form.querySelector("button[type=submit]")).not.toBeNull();
  });
});
