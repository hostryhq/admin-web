import type { AdminApi } from "../../api/client";
import type { components } from "../../generated";
import { outcome, type Failure, type Outcome } from "../../api/outcome";

type S = components["schemas"];

export type ItemState = "done" | "notyet" | "blocked" | "unknown";
export type ChecklistId = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9";
export type CheckItem = {
  id: ChecklistId;
  state: ItemState;
  /** First-time date or UTC instant for a done item. */
  at?: string;
  /** Extra i18n key for a blocked item. */
  reason?: string;
  informational: boolean;
};

/** What the admin API can tell about one organisation's onboarding. Nothing is stored by the panel (AC 8). */
export type Facts = {
  org: S["OrganisationDetailView"];
  subscription: S["SubscriptionHistory"] | undefined | "denied";
  devices: S["VendorDevice"][] | undefined | "denied";
};

/** The organisation's current subscription, when it could be read and there is one. */
export function currentSubscription(f: Facts): S["Subscription"] | undefined {
  return f.subscription === "denied" || f.subscription === undefined ? undefined : f.subscription.current;
}

/** A registered GSTIN needs verifying; an unregistered one has nothing to verify (A0 AC 73). */
export function registrationsVerified(org: S["OrganisationDetailView"]): boolean {
  return org.registrations.every((r) => r.regime === "unregistered" || r.verification_state === "verified");
}

export function unverifiedRegistrations(org: S["OrganisationDetailView"]): S["DirectoryRegistration"][] {
  return org.registrations.filter((r) => r.regime !== "unregistered" && r.verification_state === "unverified");
}

/** C1 to C9 from the facts at hand (BR-A1-4). C7 to C9 need trading reads the admin API does not have. */
export function checklist(f: Facts): CheckItem[] {
  const sub = f.subscription === "denied" || f.subscription === undefined ? undefined : f.subscription.current;
  const devices = f.devices === "denied" || f.devices === undefined ? undefined : f.devices;
  const c2 = registrationsVerified(f.org);
  const firstDevice = devices?.map((d) => d.registered_at).sort()[0];
  const billing = devices?.some((d) => d.billing_capable) ?? false;
  const known = (x: unknown) => x !== "denied" && x !== undefined;
  const items: CheckItem[] = [
    { id: "C1", state: "done", at: f.org.organisation.created_at, informational: false },
    { id: "C2", state: c2 ? "done" : "notyet", informational: false },
    { id: "C3", state: f.org.owner_status === "accepted" ? "done" : f.org.owner_status === "unknown" ? "unknown" : "notyet", informational: false },
    { id: "C4", state: !known(f.subscription) ? "unknown" : sub ? "done" : "notyet", ...(sub ? { at: sub.start_date } : {}), informational: false },
    { id: "C5", state: !known(f.devices) ? "unknown" : devices && devices.length > 0 ? "done" : "notyet", ...(firstDevice ? { at: firstDevice } : {}), informational: false },
    {
      id: "C6",
      state: !known(f.devices) ? "unknown" : billing ? "done" : !c2 ? "blocked" : "notyet",
      ...(!billing && !c2 ? { reason: "admin.checklist.blocked.gstin" } : {}),
      informational: false,
    },
    { id: "C7", state: "unknown", informational: false },
    { id: "C8", state: "unknown", informational: true },
    { id: "C9", state: "unknown", informational: true },
  ];
  return items;
}

/** Live when C1, C2, C3, C5, C6 and C7 are done (BR-A1-5). C7 cannot be read yet, so this is never true from the panel. */
export function isLive(items: CheckItem[]): boolean {
  return (["C1", "C2", "C3", "C5", "C6", "C7"] as const).every((id) => items.find((i) => i.id === id)?.state === "done");
}

export function firstUnmet(items: CheckItem[]): CheckItem | undefined {
  return items.find((i) => !i.informational && i.state !== "done");
}

/** Reads the facts. Devices are read only for the checklist (that read is audited, A0 AC 36). The organisation read decides success; subscription and devices degrade to "denied" or unknown. */
export async function loadFacts(api: AdminApi, orgId: string, withDevices = false): Promise<Outcome<Facts>> {
  const path = { params: { path: { organisation_id: orgId } } } as const;
  const [org, sub, dev] = await Promise.all([
    outcome(api.GET("/v1/organisations/{organisation_id}", path)),
    outcome(api.GET("/v1/organisations/{organisation_id}/subscription", path)),
    withDevices ? outcome(api.GET("/v1/organisations/{organisation_id}/devices", { params: { path: { organisation_id: orgId }, query: { limit: 100 } } })) : Promise.resolve<Outcome<S["VendorDevicePage"]>>({ ok: false, failure: { status: 0 } }),
  ]);
  if (!org.ok) return org;
  const settle = <T>(o: Outcome<T>): T | undefined | "denied" => (o.ok ? o.data : o.failure.status === 403 ? "denied" : undefined);
  const devices = settle(dev);
  return {
    ok: true,
    status: 200,
    data: { org: org.data, subscription: settle(sub), devices: devices === "denied" || devices === undefined ? devices : devices.items },
  };
}

export type { Failure };
