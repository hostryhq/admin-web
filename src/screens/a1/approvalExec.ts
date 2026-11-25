import type { AdminApi } from "../../api/client";
import { mut } from "../../api/headers";
import { outcome, type Failure, type Outcome } from "../../api/outcome";
import type { components } from "../../generated";

type S = components["schemas"];
export type Approval = S["VendorApproval"];

/** Kinds another service executes after approval (ADR-0014 A1.3); the grant stays in the admin service. */
export const EXECUTING_KINDS: readonly Approval["kind"][] = ["org_suspend", "org_reinstate", "org_close", "tax_rule_set_publish"];
export const isExecuting = (a: Pick<Approval, "kind">): boolean => EXECUTING_KINDS.includes(a.kind);

/** Approved but its action has not happened: the guard refused (open_trading_day, lead time) and the approval stays approved until it lapses. */
export const awaitsExecution = (a: Approval): boolean => a.state === "approved" && isExecuting(a);

/**
 * Names the approval to the executing operation again after a guard refused it (the approver's session
 * holds a fresh single-use grant; the browser never sees it). `409 approval_not_executable` carries a
 * `reason` (not_approved, lapsed, executed, not_approver, subject_changed).
 */
export async function retryExecution(api: AdminApi, a: Approval, key: string): Promise<Outcome<unknown>> {
  const header = mut(key);
  const lifecycle = { approval_id: a.id, ticket: a.ticket_reference, reason: a.reason ?? a.ticket_reference, ...(a.kind === "org_close" ? { owner_export_offered: true } : {}) };
  const org = a.organisation_id ?? "";
  switch (a.kind) {
    case "org_suspend":
      return outcome(api.POST("/v1/organisations/{organisation_id}/suspension", { params: { path: { organisation_id: org }, header }, body: lifecycle }));
    case "org_reinstate":
      return outcome(api.POST("/v1/organisations/{organisation_id}/reinstatement", { params: { path: { organisation_id: org }, header }, body: lifecycle }));
    case "org_close":
      return outcome(api.POST("/v1/organisations/{organisation_id}/closure", { params: { path: { organisation_id: org }, header }, body: lifecycle }));
    case "tax_rule_set_publish":
      return outcome(api.POST("/v1/tax-rule-sets/{rule_set_id}/publication", { params: { path: { rule_set_id: a.subject_id ?? "" }, header }, body: { approval_id: a.id } }));
    default:
      return { ok: false, failure: { status: 400 } };
  }
}

/** i18n key for why an approved action did not execute: the guard code, or the `reason` of approval_not_executable. */
export function notExecutedKey(f: Pick<Failure, "code"> & { reason?: string }, code?: string): string {
  const c = f.code ?? code;
  if (c === "approval_not_executable") return `admin.approvals.reason.${f.reason ?? "unknown"}`;
  return c ? `admin.approvals.reason.${c}` : "admin.approvals.reason.unknown";
}

export const KNOWN_REASONS = ["open_trading_day", "effective_date_too_soon", "not_signed", "not_approved", "lapsed", "executed", "not_approver", "subject_changed", "unknown"] as const;
