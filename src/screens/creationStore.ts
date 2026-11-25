import type { components } from "../generated";

type OnboardingResult = components["schemas"]["OnboardingResult"];

/**
 * The create response, kept in memory for the result screen only (screen 8) so it can show the
 * invitation expiry at once. Nothing is persisted: a reload falls back to reading the organisation.
 * The response carries the masked mobile only; the full number is never stored by this app.
 */
const results = new Map<string, OnboardingResult>();

export function rememberCreation(r: OnboardingResult): void {
  results.set(r.created.organisation.id, r);
}

export function recallCreation(orgId: string): OnboardingResult | undefined {
  return results.get(orgId);
}

export function forgetCreation(orgId: string): void {
  results.delete(orgId);
}
