import { onSettled } from "solid-js";

/**
 * The single-letter shortcuts `c` (raise a charge) and `p` (record a payment) act on "the organisation"
 * or "the charge" the page shows. The global key handler fires an event; the page that owns the action
 * listens, so a shortcut does nothing on a page that has no such action (and never needs a permission
 * of its own: the page only listens when it shows the button).
 */
export type ShortcutAction = "raise-charge" | "record-payment";
const EVENT = "hostry:shortcut";

export function emitShortcut(action: ShortcutAction): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: action }));
}

export function onShortcutEvent(action: ShortcutAction, run: () => void): void {
  onSettled(() => {
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail === action) run();
    };
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  });
}
