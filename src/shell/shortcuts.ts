import { ROUTES } from "../routes";
import { emitShortcut } from "../screens/a1/shortcutEvents";

/** Global keyboard map from docs/design/admin-a0-flows.md section 0. j/k, Enter and Alt+1..5 live in ui-kit. */
export type ShortcutDeps = {
  can: (need: string | readonly string[]) => boolean;
  navigate: (path: string) => void;
  /** Focus the organisation search box if the current screen has one; returns whether it did. */
  focusSearch: () => boolean;
  openHelp: () => void;
  /** A modal dialog is open: shortcuts stay quiet so the dialog owns the keyboard. */
  dialogOpen: () => boolean;
  supportSessionActive: () => boolean;
  endSupportSession: () => void;
  now?: () => number;
};

const CHORD_MS = 1500;

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

/**
 * Returns a keydown handler. Nothing fires while a text field has focus or a dialog is open,
 * every shortcut is permission-gated, and none is the only way to do its task.
 */
export function createShortcutHandler(deps: ShortcutDeps): (e: KeyboardEvent) => void {
  const now = deps.now ?? Date.now;
  let chordAt: number | undefined;

  return (e) => {
    if (e.defaultPrevented) return;

    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "e") {
      if (deps.supportSessionActive() && deps.can("admin.support.session.start")) {
        e.preventDefault();
        deps.endSupportSession();
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (inTextField(e.target) || deps.dialogOpen()) return;

    if (chordAt !== undefined) {
      const fresh = now() - chordAt <= CHORD_MS;
      chordAt = undefined;
      if (fresh) {
        const go = (path: string, need: string | readonly string[]) => {
          if (!deps.can(need)) return;
          e.preventDefault();
          deps.navigate(path);
        };
        if (e.key === "o") return go(ROUTES.organisations.path, "admin.org.read");
        if (e.key === "a") return go(ROUTES.audit.path, ROUTES.audit.permission);
        if (e.key === "s") return go(ROUTES.staff.path, "admin.user.manage");
        if (e.key === "b") return go(ROUTES.board.path, "admin.org.read");
        if (e.key === "p") return go(ROUTES.plans.path, "admin.subscription.read");
        if (e.key === "l") return go("/lists", "admin.subscription.read");
        if (e.key === "t") return go(ROUTES.taxRules.path, "admin.taxrules.manage");
        if (e.key === "v") return go(ROUTES.approvals.path, "admin.approval.read");
        return;
      }
    }

    switch (e.key) {
      case "g":
        chordAt = now();
        break;
      case "/":
        if (deps.can("admin.org.read") && deps.focusSearch()) e.preventDefault();
        break;
      case "n":
        if (deps.can("admin.org.create")) {
          e.preventDefault();
          deps.navigate(ROUTES.organisationNew.path);
        }
        break;
      case "c":
        if (deps.can("admin.subscription.manage")) emitShortcut("raise-charge");
        break;
      case "p":
        if (deps.can("admin.subscription.manage")) emitShortcut("record-payment");
        break;
      case "?":
        e.preventDefault();
        deps.openHelp();
        break;
    }
  };
}

export type ShortcutEntry = { keys: string; labelKey: string; need?: string | readonly string[] };

/** The sheet shows only what this user can use. */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: "/", labelKey: "admin.shortcuts.search", need: "admin.org.read" },
  { keys: "g o", labelKey: "admin.shortcuts.orgs", need: "admin.org.read" },
  { keys: "g a", labelKey: "admin.shortcuts.audit", need: ROUTES.audit.permission },
  { keys: "g s", labelKey: "admin.shortcuts.staff", need: "admin.user.manage" },
  { keys: "g b", labelKey: "admin.shortcuts.board", need: "admin.org.read" },
  { keys: "g p", labelKey: "admin.shortcuts.plans", need: "admin.subscription.read" },
  { keys: "g l", labelKey: "admin.shortcuts.lists", need: "admin.subscription.read" },
  { keys: "g t", labelKey: "admin.shortcuts.tax", need: "admin.taxrules.manage" },
  { keys: "g v", labelKey: "admin.shortcuts.approvals", need: "admin.approval.read" },
  { keys: "c", labelKey: "admin.shortcuts.raise", need: "admin.subscription.manage" },
  { keys: "p", labelKey: "admin.shortcuts.pay", need: "admin.subscription.manage" },
  { keys: "n", labelKey: "admin.shortcuts.new", need: "admin.org.create" },
  { keys: "j / k", labelKey: "admin.shortcuts.rows" },
  { keys: "Enter", labelKey: "admin.shortcuts.open" },
  { keys: "Esc", labelKey: "admin.shortcuts.close" },
  { keys: "Ctrl+Enter", labelKey: "admin.shortcuts.submit" },
  { keys: "Alt+1..5", labelKey: "admin.shortcuts.tabs" },
  { keys: "?", labelKey: "admin.shortcuts.help" },
  { keys: "Ctrl+Shift+E", labelKey: "admin.shortcuts.endsession", need: "admin.support.session.start" },
];
