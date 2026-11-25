// Records the admin API test double's answers into src/test/fixtures/admin-double.json.
//
//   node scripts/record-double.mjs http://127.0.0.1:18431
//
// The svc-admin double (svc-admin/double) answers the spec's own examples, so the recording is the
// spec's examples with the double's session, CSRF and Origin rules applied. Tests replay it through
// src/test/mockAdmin.ts, so they need neither Go nor the private svc-admin repo (CI has only the
// ui-kit and client-core siblings). Re-record after the contract changes; a diff in the JSON is the
// contract change made visible. It covers every operation of the Phase 2 contract (74) except sign-in
// and the A0 account setup, which are recorded too: one recording per operationId.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://127.0.0.1:18431";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", "test", "fixtures", "admin-double.json");

const COOKIE = "__Host-hostry-admin=double-seed-session";
const CSRF = "csrf_example_token";
const ORG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60";
const DEVICE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e";
const USER = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a66";
const INVITE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62";
const REG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63";
const APPROVAL = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6d";
const CHARGE = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f8021";
const PAYMENT = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f8031";
const RULESET = "72bdd3f5-68b5-59b0-8e62-2075a1f43c47";

const lifecycle = { approval_id: APPROVAL, ticket: "SUP-2050", reason: "Owner asked in writing to pause the account." };

/** [operationId, method, template, concrete path, body, extra headers] */
const ops = [
  ["signIn", "POST", "/v1/sessions", "/v1/sessions", { email: "platform@example.invalid", password: "correct-horse-battery-staple", totp_code: "123456" }],
  ["beginAccountSetup", "POST", "/v1/account-setups", "/v1/account-setups", { setup_token: "example-token" }],
  ["completeAccountSetup", "POST", "/v1/account-setup-completions", "/v1/account-setup-completions", { setup_token: "example-token", password: "correct-horse-battery-staple", totp_code: "123456" }],
  ["signOut", "DELETE", "/v1/sessions/current", "/v1/sessions/current"],
  ["getSession", "GET", "/v1/sessions/current", "/v1/sessions/current"],
  ["listVendorUsers", "GET", "/v1/vendor-users", "/v1/vendor-users"],
  ["listOrganisations", "GET", "/v1/organisations", "/v1/organisations"],
  ["getOrganisation", "GET", "/v1/organisations/{organisation_id}", `/v1/organisations/${ORG}`],
  ["listOwnerInvitations", "GET", "/v1/organisations/{organisation_id}/owner-invitations", `/v1/organisations/${ORG}/owner-invitations`],
  ["listOrganisationDevices", "GET", "/v1/organisations/{organisation_id}/devices", `/v1/organisations/${ORG}/devices`],
  ["getOrganisationDevice", "GET", "/v1/organisations/{organisation_id}/devices/{device_id}", `/v1/organisations/${ORG}/devices/${DEVICE}`],
  ["listAuditEntries", "GET", "/v1/audit-entries", "/v1/audit-entries"],
  ["getSupportOrganisation", "GET", "/v1/organisations/{organisation_id}/support-view/profile", `/v1/organisations/${ORG}/support-view/profile`],
  ["listSupportBrands", "GET", "/v1/organisations/{organisation_id}/support-view/brands", `/v1/organisations/${ORG}/support-view/brands`],
  ["listSupportOutlets", "GET", "/v1/organisations/{organisation_id}/support-view/outlets", `/v1/organisations/${ORG}/support-view/outlets`],
  ["listSupportTaxRegistrations", "GET", "/v1/organisations/{organisation_id}/support-view/tax-registrations", `/v1/organisations/${ORG}/support-view/tax-registrations`],
  ["listSupportDocumentSeries", "GET", "/v1/organisations/{organisation_id}/support-view/document-series", `/v1/organisations/${ORG}/support-view/document-series`],
  ["getSupportSettings", "GET", "/v1/organisations/{organisation_id}/support-view/settings", `/v1/organisations/${ORG}/support-view/settings`],
  ["listSupportMembers", "GET", "/v1/organisations/{organisation_id}/support-view/members", `/v1/organisations/${ORG}/support-view/members`],
  ["listSupportRoles", "GET", "/v1/organisations/{organisation_id}/support-view/roles", `/v1/organisations/${ORG}/support-view/roles`],
  ["listSupportDevices", "GET", "/v1/organisations/{organisation_id}/support-view/devices", `/v1/organisations/${ORG}/support-view/devices`],
  ["listVendorApprovals", "GET", "/v1/approvals", "/v1/approvals?state=pending"],
  ["getVendorApproval", "GET", "/v1/approvals/{approval_id}", `/v1/approvals/${APPROVAL}`],
  [
    "fileVendorApproval",
    "POST",
    "/v1/approvals",
    "/v1/approvals",
    { kind: "device_revoke_over_quota", organisation_id: ORG, subject_id: DEVICE, ticket_reference: "SUP-2041", reason: "Owner phoned to report a lost tablet.", verification_method: "callback_to_registered_number" },
  ],
  ["approveVendorApproval", "PUT", "/v1/approvals/{approval_id}/decision", `/v1/approvals/${APPROVAL}/decision`, { totp_code: "123456" }],
  ["claimCodeHalf", "POST", "/v1/approvals/{approval_id}/code-half-claims", `/v1/approvals/${APPROVAL}/code-half-claims`],
  ["cancelVendorApproval", "PUT", "/v1/approvals/{approval_id}/cancellation", `/v1/approvals/${APPROVAL}/cancellation`, { reason: "Requester could not be verified." }],
  ["getSupportSession", "GET", "/v1/support-sessions/current", "/v1/support-sessions/current"],
  [
    "createOrganisation",
    "POST",
    "/v1/organisations",
    "/v1/organisations",
    {
      name: "Example Hospitality",
      outlet: { name: "Main Road", kind: "restaurant", state_code: "33" },
      tax_registration: { legal_name: "Example Hospitality Pvt Ltd", regime: "regular", gstin: "33ABCDE1234F1Z7" },
      owner: { name: "Asha", mobile_e164: "+919876543210" },
    },
  ],
  ["createOwnerInvitation", "POST", "/v1/organisations/{organisation_id}/owner-invitations", `/v1/organisations/${ORG}/owner-invitations`, { name: "Asha", mobile_e164: "+919876543210" }],
  ["renewOwnerInvitation", "POST", "/v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/renewals", `/v1/organisations/${ORG}/owner-invitations/${INVITE}/renewals`],
  ["cancelOwnerInvitation", "PUT", "/v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/cancellation", `/v1/organisations/${ORG}/owner-invitations/${INVITE}/cancellation`],
  ["verifyTaxRegistration", "PUT", "/v1/organisations/{organisation_id}/tax-registrations/{registration_id}/verification", `/v1/organisations/${ORG}/tax-registrations/${REG}/verification`, { method: "certificate_seen" }],
  ["rejectTaxRegistration", "PUT", "/v1/organisations/{organisation_id}/tax-registrations/{registration_id}/rejection", `/v1/organisations/${ORG}/tax-registrations/${REG}/rejection`, { reason: "The GSTIN does not match the legal name." }],
  [
    "revokeOrganisationDevice",
    "PUT",
    "/v1/organisations/{organisation_id}/devices/{device_id}/revocation",
    `/v1/organisations/${ORG}/devices/${DEVICE}/revocation`,
    { ticket_reference: "SUP-2041", reason: "Owner phoned to report a lost tablet.", verification_method: "callback_to_registered_number", confirm: true },
  ],
  ["startSupportSession", "POST", "/v1/support-sessions", "/v1/support-sessions", { organisation_id: ORG, ticket_reference: "SUP-2041", reason: "Owner phoned to report a lost tablet.", duration_minutes: 30 }],
  ["endSupportSession", "DELETE", "/v1/support-sessions/current", "/v1/support-sessions/current"],
  ["createVendorUser", "POST", "/v1/vendor-users", "/v1/vendor-users", { id: USER, email: "staff@example.invalid", display_name: "Priya", role: "support" }],
  ["updateVendorUser", "PATCH", "/v1/vendor-users/{vendor_user_id}", `/v1/vendor-users/${USER}`, { role: "support" }],
  ["resetVendorUserTotp", "POST", "/v1/vendor-users/{vendor_user_id}/totp-resets", `/v1/vendor-users/${USER}/totp-resets`],

  // Admin A1: plans and billing configuration
  ["listPlans", "GET", "/v1/plans", "/v1/plans"],
  ["getPlan", "GET", "/v1/plans/{plan_key}", "/v1/plans/table_service"],
  [
    "createPlan",
    "POST",
    "/v1/plans",
    "/v1/plans",
    { key: "table_service", name_key: "plan.table_service", version: { feature_keys: ["restaurant.core"], included_outlets: 1, prices: [{ cycle: "monthly", list_price: { amount_paise: 129900, currency: "INR" } }] } },
  ],
  [
    "createPlanVersion",
    "POST",
    "/v1/plans/{plan_key}/versions",
    "/v1/plans/table_service/versions",
    { feature_keys: ["restaurant.core"], included_outlets: 1, prices: [{ cycle: "monthly", list_price: { amount_paise: 129900, currency: "INR" } }] },
  ],
  ["activatePlanVersion", "POST", "/v1/plans/{plan_key}/versions/{version}/activation", "/v1/plans/table_service/versions/1/activation"],
  ["retirePlanVersion", "POST", "/v1/plans/{plan_key}/versions/{version}/retirement", "/v1/plans/table_service/versions/1/retirement"],
  ["listBillingConfigurations", "GET", "/v1/billing-configurations", "/v1/billing-configurations"],
  [
    "createBillingConfiguration",
    "POST",
    "/v1/billing-configurations",
    "/v1/billing-configurations",
    { effective_from: "2026-12-01", hostry_state_code: "33", sac: "997331", gst_rate_bp: 1800, gst_registered: true, payment_tolerance_paise: 99, payment_terms_days: 7 },
  ],

  // Admin A1: subscription, charges, payments, ledger
  ["getOrganisationSubscription", "GET", "/v1/organisations/{organisation_id}/subscription", `/v1/organisations/${ORG}/subscription`],
  ["startSubscription", "POST", "/v1/organisations/{organisation_id}/subscription", `/v1/organisations/${ORG}/subscription`, { plan_key: "table_service", plan_version: 1, cycle: "monthly", start_date: "2026-12-01" }],
  ["changeSubscription", "PUT", "/v1/organisations/{organisation_id}/subscription", `/v1/organisations/${ORG}/subscription`, { plan_key: "table_service", plan_version: 1, cycle: "monthly", effective_from: "2027-01-01" }],
  ["cancelSubscription", "POST", "/v1/organisations/{organisation_id}/subscription/cancellation", `/v1/organisations/${ORG}/subscription/cancellation`, {}],
  ["listCharges", "GET", "/v1/organisations/{organisation_id}/charges", `/v1/organisations/${ORG}/charges`],
  ["raiseCharge", "POST", "/v1/organisations/{organisation_id}/charges", `/v1/organisations/${ORG}/charges`, { kind: "period", period_start: "2026-12-01", period_end: "2026-12-31" }],
  ["getCharge", "GET", "/v1/organisations/{organisation_id}/charges/{charge_id}", `/v1/organisations/${ORG}/charges/${CHARGE}`],
  ["setChargeInvoiceReference", "PUT", "/v1/organisations/{organisation_id}/charges/{charge_id}/invoice-reference", `/v1/organisations/${ORG}/charges/${CHARGE}/invoice-reference`, { invoice_reference: { number: "INV/26/118", date: "2026-12-02" } }],
  ["listChargePayments", "GET", "/v1/organisations/{organisation_id}/charges/{charge_id}/payments", `/v1/organisations/${ORG}/charges/${CHARGE}/payments`],
  [
    "recordPayment",
    "POST",
    "/v1/organisations/{organisation_id}/charges/{charge_id}/payments",
    `/v1/organisations/${ORG}/charges/${CHARGE}/payments`,
    { amount: { amount_paise: 153282, currency: "INR" }, method: "upi", reference: "UTR1234567890", received_on: "2026-12-02" },
  ],
  ["reversePayment", "POST", "/v1/organisations/{organisation_id}/charges/{charge_id}/payments/{payment_id}/reversal", `/v1/organisations/${ORG}/charges/${CHARGE}/payments/${PAYMENT}/reversal`, { reason: "Cheque bounced at the bank." }],
  ["waiveCharge", "POST", "/v1/organisations/{organisation_id}/charges/{charge_id}/waiver", `/v1/organisations/${ORG}/charges/${CHARGE}/waiver`, { reason: "Goodwill during onboarding delay." }],
  ["cancelCharge", "POST", "/v1/organisations/{organisation_id}/charges/{charge_id}/cancellation", `/v1/organisations/${ORG}/charges/${CHARGE}/cancellation`, { reason: "Raised for the wrong period." }],
  ["listLedgerEntries", "GET", "/v1/ledger-lists/{list_kind}", "/v1/ledger-lists/overdue_charges"],
  ["exportLedger", "GET", "/v1/ledger-exports", "/v1/ledger-exports?from=2026-11-01&to=2026-11-30"],

  // Admin A1: tax rule sets
  ["listTaxRuleSetMasters", "GET", "/v1/tax-rule-sets", "/v1/tax-rule-sets"],
  ["getTaxRuleSetMaster", "GET", "/v1/tax-rule-sets/{rule_set_id}", `/v1/tax-rule-sets/${RULESET}`],
  [
    "createTaxRuleSetDraft",
    "POST",
    "/v1/tax-rule-sets",
    "/v1/tax-rule-sets",
    {
      name: "GST restaurant services 2026 B",
      effective_date: "2026-12-15",
      calc_v: 1,
      rules: [{ tax_class: "fnb_standard", regime: "regular", specified_premises: false, order_channel: "dine_in", doc_type: "tax_invoice", gst_applies: true, cgst_bp: 250, sgst_bp: 250, igst_bp: 0 }],
    },
  ],
  [
    "updateTaxRuleSetDraft",
    "PATCH",
    "/v1/tax-rule-sets/{rule_set_id}",
    `/v1/tax-rule-sets/${RULESET}`,
    {
      name: "GST restaurant services 2026 B",
      effective_date: "2026-12-15",
      calc_v: 1,
      rules: [{ tax_class: "fnb_standard", regime: "regular", specified_premises: false, order_channel: "dine_in", doc_type: "tax_invoice", gst_applies: true, cgst_bp: 250, sgst_bp: 250, igst_bp: 0 }],
    },
    { "If-Match": '"1"' },
  ],
  ["validateTaxRuleSet", "POST", "/v1/tax-rule-sets/{rule_set_id}/validation", `/v1/tax-rule-sets/${RULESET}/validation`],
  ["signTaxRuleSet", "POST", "/v1/tax-rule-sets/{rule_set_id}/signature", `/v1/tax-rule-sets/${RULESET}/signature`, { signoff: { reviewer_name: "R. Iyer", signed_on: "2026-11-20", reference_note: "CA review ref C-2026-114" } }],
  ["publishTaxRuleSet", "POST", "/v1/tax-rule-sets/{rule_set_id}/publication", `/v1/tax-rule-sets/${RULESET}/publication`, { approval_id: APPROVAL }],
  ["deleteTaxRuleSetDraft", "DELETE", "/v1/tax-rule-sets/{rule_set_id}", `/v1/tax-rule-sets/${RULESET}`],

  // Admin A1: lifecycle (each executes an approved request once; the double answers the second try 409)
  ["suspendOrganisation", "POST", "/v1/organisations/{organisation_id}/suspension", `/v1/organisations/${ORG}/suspension`, { ...lifecycle, approval_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6e" }],
  ["reinstateOrganisation", "POST", "/v1/organisations/{organisation_id}/reinstatement", `/v1/organisations/${ORG}/reinstatement`, { ...lifecycle, approval_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a6f" }],
  ["closeOrganisation", "POST", "/v1/organisations/{organisation_id}/closure", `/v1/organisations/${ORG}/closure`, { ...lifecycle, approval_id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70", owner_export_offered: true }],
];

const recorded = {};
let n = 0;
for (const [id, method, template, path, body, extra] of ops) {
  const headers = { Cookie: COOKIE, Origin: base, ...(extra ?? {}) };
  if (method !== "GET") {
    headers["X-CSRF-Token"] = CSRF;
    headers["Idempotency-Key"] = `record-${++n}`;
  }
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const json = type.includes("json");
  recorded[id] = { method, template, status: res.status, ...(json || !text ? {} : { contentType: type }), body: !text ? null : json ? JSON.parse(text) : text };
  console.log(`${id}: ${res.status}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ csrf: CSRF, org: ORG, device: DEVICE, operations: recorded }, null, 2) + "\n");
console.log(`wrote ${out} (${Object.keys(recorded).length} operations)`);
