import type { components } from "../generated";
import { ORG_ID, recorded } from "./mockAdmin";

type S = components["schemas"];

/** Typed test data for the A1 screens, built on the recorded (spec example) answers. Fictional values only. */
export const CHARGE_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f8021";
export const RULESET_ID = "72bdd3f5-68b5-59b0-8e62-2075a1f43c47";
export const money = (n: number): S["Money"] => ({ amount_paise: n, currency: "INR" });

export const ORG = `/organisations/${ORG_ID}`;
export const SUB_PATH = `${ORG}/subscription`;
export const CHARGES_PATH = `${ORG}/charges`;
export const CHARGE_PATH = `${ORG}/charges/${CHARGE_ID}`;

export const SUBSCRIPTION = "GET /v1/organisations/{organisation_id}/subscription";
export const CHARGES = "GET /v1/organisations/{organisation_id}/charges";
export const CHARGE = "GET /v1/organisations/{organisation_id}/charges/{charge_id}";
export const PAYMENTS = "GET /v1/organisations/{organisation_id}/charges/{charge_id}/payments";
export const RAISE = "POST /v1/organisations/{organisation_id}/charges";
export const PAY = "POST /v1/organisations/{organisation_id}/charges/{charge_id}/payments";
export const BILLING_CONFIGS = "GET /v1/billing-configurations";
export const APPROVALS = "GET /v1/approvals";
export const DECISION = "PUT /v1/approvals/{approval_id}/decision";

export function subscription(over: Partial<S["Subscription"]> = {}): S["SubscriptionHistory"] {
  const base = recorded<S["SubscriptionHistory"]>("getOrganisationSubscription");
  return { ...base, current: { ...(base.current as S["Subscription"]), ...over } };
}

/** The GST configuration in force (the recorded one starts in the future, so tests ask for an earlier start). */
export function config(over: Partial<S["BillingConfiguration"]> = {}): S["BillingConfiguration"] {
  return { ...recorded<S["BillingConfigurationPage"]>("listBillingConfigurations").items[0], effective_from: "2026-04-01", ...over } as S["BillingConfiguration"];
}

export function charge(over: Partial<S["Charge"]> = {}): S["Charge"] {
  return { ...recorded<S["Charge"]>("getCharge"), ...over };
}

export function chargePage(items: S["Charge"][]): S["ChargePage"] {
  return { items };
}

export function payment(over: Partial<S["LedgerPayment"]> = {}): S["LedgerPayment"] {
  return { ...recorded<S["LedgerPaymentPage"]>("listChargePayments").items[0], ...over } as S["LedgerPayment"];
}

export function approval(over: Partial<S["VendorApproval"]> = {}): S["VendorApproval"] {
  return {
    id: "ap-1",
    kind: "org_suspend",
    state: "pending",
    organisation_id: ORG_ID,
    requested_by: "u-someone-else",
    ticket_reference: "T-1050",
    reason: "Owner asked in writing to pause the account.",
    subject: "Suspend Example Hospitality (read and export only after approval)",
    verification_method: "callback_to_registered_number",
    created_at: "2026-11-24T05:12:00.000Z",
    expires_at: new Date(Date.now() + 23 * 3_600_000).toISOString(),
    ...over,
  };
}

export function ruleSet(over: Partial<S["TaxRuleSetMaster"]> = {}): S["TaxRuleSetMaster"] {
  return { ...recorded<S["TaxRuleSetMasterPage"]>("listTaxRuleSetMasters").items[0], ...over } as S["TaxRuleSetMaster"];
}

/** A fetch that drops the connection once for a matching request, then behaves normally. */
export function dropOnce(inner: typeof fetch, match: (req: Request) => boolean): typeof fetch {
  let dropped = false;
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (!dropped && match(req)) {
      // The write reaches the server (and is recorded by the mock) but the answer never arrives.
      await inner(req.clone());
      dropped = true;
      throw new TypeError("Failed to fetch");
    }
    return inner(req);
  };
}
