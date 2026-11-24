import { describe, expect, it, vi } from "vitest";
import { hasPermission } from "../session/session";
import { createShortcutHandler, SHORTCUTS } from "./shortcuts";

function setup(permissions: string[], extra: { dialogOpen?: boolean; support?: boolean; search?: boolean } = {}) {
  let t = 0;
  const navigate = vi.fn();
  const openHelp = vi.fn();
  const endSupportSession = vi.fn();
  const focusSearch = vi.fn(() => extra.search ?? true);
  const session = { permissions };
  const handler = createShortcutHandler({
    can: (need) => hasPermission(session, need),
    navigate,
    focusSearch,
    openHelp,
    dialogOpen: () => extra.dialogOpen ?? false,
    supportSessionActive: () => extra.support ?? false,
    endSupportSession,
    now: () => t,
  });
  const key = (k: string, init: KeyboardEventInit = {}, target?: Element) => {
    const e = new KeyboardEvent("keydown", { key: k, cancelable: true, bubbles: true, ...init });
    if (target) Object.defineProperty(e, "target", { value: target });
    handler(e);
    return e;
  };
  return { key, navigate, openHelp, endSupportSession, focusSearch, advance: (ms: number) => void (t += ms) };
}

describe("global shortcuts", () => {
  it("g then o/a/s navigates, gated by permission", () => {
    const all = setup(["admin.org.read", "admin.audit.read_own", "admin.user.manage"]);
    all.key("g");
    all.key("o");
    all.key("g");
    all.key("a");
    all.key("g");
    all.key("s");
    expect(all.navigate.mock.calls).toEqual([["/organisations"], ["/audit"], ["/staff"]]);

    const billing = setup(["admin.org.read"]);
    billing.key("g");
    billing.key("s");
    billing.key("g");
    billing.key("a");
    expect(billing.navigate).not.toHaveBeenCalled();
  });

  it("the chord expires after 1.5 seconds", () => {
    const s = setup(["admin.org.read"]);
    s.key("g");
    s.advance(1600);
    s.key("o");
    expect(s.navigate).not.toHaveBeenCalled();
  });

  it("n needs admin.org.create; / needs admin.org.read and a search box", () => {
    const viewer = setup(["admin.org.read"]);
    viewer.key("n");
    expect(viewer.navigate).not.toHaveBeenCalled();
    expect(viewer.key("/").defaultPrevented).toBe(true);

    const noSearch = setup(["admin.org.read"], { search: false });
    expect(noSearch.key("/").defaultPrevented).toBe(false);

    const creator = setup(["admin.org.create"]);
    creator.key("n");
    expect(creator.navigate).toHaveBeenCalledWith("/organisations/new");
    creator.key("/");
    expect(creator.focusSearch).not.toHaveBeenCalled();
  });

  it("stays quiet in text fields, with modifiers, and while a dialog is open", () => {
    const field = document.createElement("input");
    const s = setup(["admin.org.create"]);
    s.key("n", {}, field);
    s.key("n", { ctrlKey: true });
    expect(s.navigate).not.toHaveBeenCalled();
    const d = setup(["admin.org.create"], { dialogOpen: true });
    d.key("n");
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("? opens the sheet; Ctrl+Shift+E ends a support session only while one is active and permitted", () => {
    const s = setup(["admin.support.session.start"]);
    s.key("?");
    expect(s.openHelp).toHaveBeenCalledOnce();
    s.key("E", { ctrlKey: true, shiftKey: true });
    expect(s.endSupportSession).not.toHaveBeenCalled();

    const active = setup(["admin.support.session.start"], { support: true });
    active.key("E", { ctrlKey: true, shiftKey: true });
    expect(active.endSupportSession).toHaveBeenCalledOnce();

    const noPerm = setup([], { support: true });
    noPerm.key("E", { ctrlKey: true, shiftKey: true });
    expect(noPerm.endSupportSession).not.toHaveBeenCalled();
  });

  it("the sheet lists only shortcuts the user can use", () => {
    const visible = (perms: string[]) =>
      SHORTCUTS.filter((s) => hasPermission({ permissions: perms }, s.need)).map((s) => s.keys);
    expect(visible([])).not.toContain("g s");
    expect(visible(["admin.user.manage"])).toContain("g s");
  });
});
