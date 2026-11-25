/**
 * The contract declares `X-CSRF-Token` and `Idempotency-Key` as required header parameters on every
 * state-changing operation, so the generated types ask for them at each call. The real CSRF token
 * is attached by the client middleware from the session (src/api/client.ts), which overwrites the
 * empty placeholder here; the idempotency key is the caller's intent key so a retry of the same
 * intent reuses it (AC 22, 23, 81).
 */
export function mut(idempotencyKey: string = crypto.randomUUID()): { "X-CSRF-Token": string; "Idempotency-Key": string } {
  return { "X-CSRF-Token": "", "Idempotency-Key": idempotencyKey };
}

/** Public operations (sign-in, setup) take the idempotency key but no CSRF token. */
export function idem(idempotencyKey: string = crypto.randomUUID()): { "Idempotency-Key": string } {
  return { "Idempotency-Key": idempotencyKey };
}
