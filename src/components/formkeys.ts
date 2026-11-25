/**
 * Keyboard rule for forms and dialogs (flows 0 and screens 7, 11): Ctrl+Enter submits; a plain Enter
 * in a single-line field does not, so a stray Enter cannot confirm a risky action. Enter on a
 * button or in a textarea keeps its normal meaning.
 */
export function formKeys(e: KeyboardEvent): void {
  if (e.key !== "Enter") return;
  const target = e.target as HTMLElement;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    (e.currentTarget as HTMLFormElement).requestSubmit();
    return;
  }
  if (target.tagName === "INPUT") e.preventDefault();
}

/** A fresh idempotency key for one user intent; reused for retries of that same intent (AC 22, 23). */
export function newIntentKey(): string {
  return crypto.randomUUID();
}
