// Records the admin API test double's answers into src/test/fixtures/admin-double.json.
//
//   node scripts/record-double.mjs http://127.0.0.1:18431
//
// The svc-admin double (svc-admin/double) answers the spec's own examples, so the recording is the
// spec's examples with the double's session, CSRF and Origin rules applied. Tests replay it through
// src/test/mockAdmin.ts, so they need neither Go nor the private svc-admin repo (CI has only the
// ui-kit and client-core siblings). Re-record after the contract changes; a diff in the JSON is the
// contract change made visible.
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

/** [operationId, method, template, concrete path, body] */
const ops = [
  ["signIn", "POST", "/v1/sessions", "/v1/sessions", { email: "platform@example.invalid", password: "correct-horse-battery-staple", totp_code: "123456" }],
  ["beginAccountSetup", "POST", "/v1/account-setups", "/v1/account-setups", { setup_token: "example-token" }],
  ["completeAccountSetup", "POST", "/v1/account-setup-completions", "/v1/account-setup-completions", { setup_token: "example-token", password: "correct-horse-battery-staple", totp_code: "123456" }],
  ["signOut", "DELETE", "/v1/sessions/current", "/v1/sessions/current"],
  ["getSession", "GET", "/v1/sessions/current", "/v1/sessions/current"],
  ["listVendorUsers", "GET", "/v1/vendor-users", "/v1/vendor-users"],
  ["listOrganisations", "GET", "/v1/organisations", "/v1/organisations"],
  ["getOrganisation", "GET", "/v1/organisations/{organisation_id}", `/v1/organisations/${ORG}`],
  ["listOrganisationDevices", "GET", "/v1/organisations/{organisation_id}/devices", `/v1/organisations/${ORG}/devices`],
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
  [
    "fileVendorApproval",
    "POST",
    "/v1/approvals",
    "/v1/approvals",
    { kind: "device_revoke_over_quota", organisation_id: ORG, subject_id: DEVICE, ticket_reference: "SUP-2041", reason: "Owner phoned to report a lost tablet.", verification_method: "callback_to_registered_number" },
  ],
  ["approveVendorApproval", "PUT", "/v1/approvals/{approval_id}/decision", `/v1/approvals/${APPROVAL}/decision`, { totp_code: "123456" }],
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
];

const recorded = {};
let n = 0;
for (const [id, method, template, path, body] of ops) {
  const headers = { Cookie: COOKIE, Origin: base };
  if (method !== "GET") {
    headers["X-CSRF-Token"] = CSRF;
    headers["Idempotency-Key"] = `record-${++n}`;
  }
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  recorded[id] = { method, template, status: res.status, body: text ? JSON.parse(text) : null };
  console.log(`${id}: ${res.status}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ csrf: CSRF, org: ORG, device: DEVICE, operations: recorded }, null, 2) + "\n");
console.log(`wrote ${out}`);
