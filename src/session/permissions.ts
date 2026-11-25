import { ALL_A0_PERMISSIONS } from "./session";

/** The A1 permissions (billing, plans, tax rules, lifecycle, approvals), for tests and fixtures. */
export const ALL_A1_PERMISSIONS = [
  "admin.subscription.read",
  "admin.subscription.start",
  "admin.subscription.manage",
  "admin.subscription.adjust",
  "admin.plan.manage",
  "admin.taxrules.manage",
  "admin.taxrules.publish",
  "admin.report.ledger",
  "admin.org.lifecycle.request",
  "admin.org.lifecycle.approve",
  "admin.approval.create",
  "admin.approval.read",
  "admin.approval.decide",
  "admin.signin_code.create",
  "admin.signin_code.approve",
  "admin.recovery.create",
  "admin.recovery.approve",
  "admin.support.session.act",
] as const;

/** Every permission the panel knows, for fixtures. */
export const ALL_PERMISSIONS = [...ALL_A0_PERMISSIONS, ...ALL_A1_PERMISSIONS] as const;

/** Which permission lets a user approve each approval kind (x-permission-by-kind of approveVendorApproval). */
export const APPROVE_PERMISSION = {
  sign_in_code: "admin.signin_code.approve",
  owner_recovery: "admin.recovery.approve",
  device_revoke_over_quota: "admin.device.revoke",
  org_suspend: "admin.org.lifecycle.approve",
  org_reinstate: "admin.org.lifecycle.approve",
  org_close: "admin.org.lifecycle.approve",
  tax_rule_set_publish: "admin.taxrules.publish",
} as const;
