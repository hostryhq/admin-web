import type { components } from "../generated";
import { DEVICE_ID, ORG_ID, recorded } from "./mockAdmin";

type S = components["schemas"];

/** Typed test data built on the recorded (spec example) answers. Fictional values only. */
export const OUTLET_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61";

export function summary(i: number, extra: Partial<S["OrganisationSummary"]> = {}): S["OrganisationSummary"] {
  return {
    id: `0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, "0")}`,
    name: `Org ${i}`,
    status: "trial",
    outlet_count: 1,
    created_at: "2026-11-24T05:12:00.000Z",
    owner_status: "pending",
    ...extra,
  };
}

export function orgList(items: S["OrganisationSummary"][], extra: Partial<S["OrganisationList"]> = {}): S["OrganisationList"] {
  return { items, owner_status_available: true, ...extra };
}

export function detail(extra: Partial<S["OrganisationDetailView"]> = {}): S["OrganisationDetailView"] {
  return { ...recorded<S["OrganisationDetailView"]>("getOrganisation"), ...extra };
}

export function invitation(extra: Partial<S["OwnerInvitation"]> = {}): S["OwnerInvitation"] {
  return { ...recorded<S["OwnerInvitation"]>("createOwnerInvitation"), ...extra };
}

export function device(state: S["DeviceState"], id: string, extra: Partial<S["VendorDevice"]> = {}): S["VendorDevice"] {
  const base = recorded<S["VendorDevicePage"]>("listOrganisationDevices").items[0] as S["VendorDevice"];
  return { ...base, id, state, ...extra };
}

export function audit(id: string, extra: Partial<S["VendorAuditEntry"]> = {}): S["VendorAuditEntry"] {
  const base = recorded<S["VendorAuditPage"]>("listAuditEntries").items[0] as S["VendorAuditEntry"];
  return { ...base, id, ...extra };
}

export function staff(id: string, extra: Partial<S["VendorUser"]> = {}): S["VendorUser"] {
  const base = recorded<S["VendorUserPage"]>("listVendorUsers").items[0] as S["VendorUser"];
  return { ...base, id, ...extra };
}

export { DEVICE_ID, ORG_ID };
