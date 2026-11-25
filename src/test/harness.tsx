import { render, screen, fireEvent } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { memoryHistory } from "@solidjs/router";
import { App } from "../App";
import { createAppTranslator } from "../i18n";
import { createAdminRouter } from "../router";
import { ALL_A0_PERMISSIONS, createSessionState, type AdminSession } from "../session/session";
import { CSRF, createMockAdmin, type MockAdmin } from "./mockAdmin";

export const USER_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a66";

/** A signed-in session as the browser holds it: names, permissions, the CSRF token. Never a bearer token. */
export function sessionOf(permissions: readonly string[] = ALL_A0_PERMISSIONS, extra: Partial<AdminSession> = {}): AdminSession {
  return { name: "Asha", userId: USER_ID, permissions, csrfToken: CSRF, ...extra };
}

export type Mounted = { mock: MockAdmin; state: ReturnType<typeof createSessionState> };

/** Mounts the whole app on a memory history against the recorded admin mock. */
export function mount(
  path: string,
  options: { session?: AdminSession | null; mock?: MockAdmin; fetch?: typeof fetch; baseUrl?: string } = {},
): Mounted {
  const mock = options.mock ?? createMockAdmin();
  const initial = options.session === null ? undefined : (options.session ?? sessionOf());
  const state = createSessionState(initial);
  render(() => <App router={createAdminRouter(memoryHistory(path))} session={state} translator={createAppTranslator()} fetch={options.fetch ?? mock.fetch} baseUrl={options.baseUrl ?? "http://admin.test"} />);
  return { mock, state };
}

export const byId = (id: string) => screen.getByTestId(id);
export const findById = (id: string) => screen.findByTestId(id);
export const queryById = (id: string) => screen.queryByTestId(id);

/** Types into a field the way the browser reports it. */
export function type(id: string, value: string): void {
  const el = byId(id) as HTMLInputElement | HTMLTextAreaElement;
  fireEvent.input(el, { target: { value } });
  flush();
}

export function choose(id: string, value: string): void {
  const el = byId(id) as HTMLSelectElement;
  fireEvent.change(el, { target: { value } });
  flush();
}

export function click(id: string): void {
  fireEvent.click(byId(id));
  flush();
}

/** Every interactive element on the page has a data-testid (AC 62). Returns the ones that do not. */
export function missingTestIds(root: ParentNode = document.body): string[] {
  const bad: string[] = [];
  root.querySelectorAll("button, a[href], input, select, textarea").forEach((el) => {
    if (!el.getAttribute("data-testid")) bad.push(`${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 30)}`);
  });
  return bad;
}

/** Waits until `fn` stops throwing (polling, no fixed sleeps). */
export async function until<T>(fn: () => T, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      return fn();
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 15));
    }
  }
}
