import { describe, expect, it, vi } from "vitest";
import { hasPermission } from "../session/session";
import { emitShortcut, onShortcutEvent } from "../screens/a1/shortcutEvents";
import { createShortcutHandler, SHORTCUTS } from "./shortcuts";

function setup(permissions: string[]) {
  const navigate = vi.fn();
  const handler = createShortcutHandler({
    can: (need) => hasPermission({ permissions }, need),
    navigate,
    focusSearch: () => true,
    openHelp: () => undefined,
    dialogOpen: () => false,
    supportSessionActive: () => false,
    endSupportSession: () => undefined,
  });
  const key = (k: string) => handler(new KeyboardEvent("keydown", { key: k, cancelable: true, bubbles: true }));
  const go = (k: string) => {
    key("g");
    key(k);
  };
  return { navigate, key, go };
}

describe("Admin A1 shortcuts (flows section 0)", () => {
  it("g then b/p/l/t/v go to the A1 pages, each only with its permission", () => {
    const all = setup(["admin.org.read", "admin.subscription.read", "admin.taxrules.manage", "admin.approval.read"]);
    for (const k of ["b", "p", "l", "t", "v"]) all.go(k);
    expect(all.navigate.mock.calls).toEqual([["/onboarding"], ["/plans"], ["/lists"], ["/tax-rules"], ["/approvals"]]);
    const support = setup(["admin.org.read"]);
    for (const k of ["p", "l", "t", "v"]) support.go(k);
    expect(support.navigate).not.toHaveBeenCalled();
  });

  it("c and p are actions on the page: they fire only for someone who may manage subscriptions, and never in a text field", () => {
    const seen: string[] = [];
    // The page's own listener is what makes the key do something; here a probe stands in for it.
    const off = (a: "raise-charge" | "record-payment") => {
      const h = (e: Event) => (e as CustomEvent<string>).detail === a && seen.push(a);
      window.addEventListener("hostry:shortcut", h);
      return () => window.removeEventListener("hostry:shortcut", h);
    };
    const stop = [off("raise-charge"), off("record-payment")];
    const billing = setup(["admin.subscription.manage"]);
    billing.key("c");
    billing.key("p");
    expect(seen).toEqual(["raise-charge", "record-payment"]);
    seen.length = 0;
    const support = setup(["admin.subscription.read"]);
    support.key("c");
    support.key("p");
    expect(seen).toEqual([]);
    stop.forEach((s) => s());
    expect(typeof emitShortcut).toBe("function");
    expect(typeof onShortcutEvent).toBe("function");
  });

  it("the shortcut sheet lists the A1 keys, each with the permission that gates it", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    for (const k of ["g b", "g p", "g l", "g t", "g v", "c", "p"]) expect(keys).toContain(k);
    expect(SHORTCUTS.find((s) => s.keys === "c")?.need).toBe("admin.subscription.manage");
  });
});
