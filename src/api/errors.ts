import type { Failure } from "./outcome";

/**
 * i18n key for a failed write. A network drop is "result unknown": the same Idempotency-Key is
 * reused when the user submits again, so a write that did land is returned, not repeated (flows 0).
 * `byCode` lets a dialog name the problem codes it knows; server text is never shown.
 */
export function writeError(f: Failure, byCode: Readonly<Record<string, string>> = {}): string {
  if (f.network) return "admin.write.unknown";
  if (f.code && byCode[f.code]) return byCode[f.code] as string;
  if (f.status === 503) return "admin.error.upstream";
  if (f.status === 403) return "admin.error.forbidden";
  if (f.status === 404) return "admin.error.notfound.item";
  if (f.status === 409) return "admin.error.conflict";
  if (f.status === 412) return "admin.error.changed";
  if (f.status === 422) return "admin.error.invalid";
  return "admin.error.generic";
}
