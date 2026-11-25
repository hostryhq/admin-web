import { describe, expect, it } from "vitest";
import { createAppTranslator, en } from "./index";
import { ALL_A0_PERMISSIONS } from "../session/session";
import { ist } from "../components/common";

const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const files = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes("/generated/") && !path.includes("/test/") && !path.endsWith("/i18n/en.ts"));

// Permission strings share the `admin.` prefix with message keys; they are not messages.
const PERMISSIONS = new Set<string>([...ALL_A0_PERMISSIONS, "admin.approval.read"]);

describe("catalogue (AC 62: no string is hard-coded, keys only)", () => {
  it("every literal message key used in the source exists in the English catalogue", () => {
    const missing: string[] = [];
    for (const [path, text] of files) {
      for (const m of text.matchAll(/"(admin\.[a-z0-9_.]+)"/g)) {
        const key = m[1] as string;
        if (PERMISSIONS.has(key) || key in en) continue;
        missing.push(`${path}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every templated key family resolves for each value the code can produce", () => {
    const t = createAppTranslator().t;
    const families: Record<string, string[]> = {
      "admin.orgs.status": ["trial", "active", "suspended", "closed"],
      "admin.orgs.owner": ["none", "pending", "accepted", "expired", "cancelled", "unknown"],
      "admin.registration.state": ["unverified", "verified", "rejected", "not_required"],
      "admin.registration.method": ["certificate_seen", "gst_portal_lookup", "other"],
      "admin.devices.state": ["active", "revoked", "drained", "wiped", "lost"],
      "admin.devices.kind": ["personal", "pos", "waiter", "kds", "hub"],
      "admin.invite.status": ["pending", "accepted", "expired", "cancelled"],
      "admin.create.kind": ["restaurant", "bakery_outlet", "production_unit", "stall", "property", "service_point"],
      "admin.create.regime": ["regular", "composition", "unregistered"],
      "admin.revoke.method": ["callback_to_registered_number", "owner_request_in_app", "other"],
      "admin.staff.role": ["platform_admin", "onboarding", "support", "billing"],
      "admin.staff.status": ["active", "setup_pending", "deactivated"],
      "admin.support.tab": ["profile", "structure", "registrations", "series", "settings", "members", "roles", "devices"],
      "admin.support.doctype": ["tax_invoice", "bill_of_supply", "plain_bill", "credit_note"],
      "admin.support.series.status": ["dormant", "active", "closed", "closed_unreconciled"],
      "admin.support.billing": ["none", "dormant", "active"],
      "admin.support.members.status": ["invited", "active", "suspended"],
      "admin.audit.result": ["succeeded", "refused", "failed"],
      "admin.devices.protection": ["hardware", "software"],
    };
    const unresolved: string[] = [];
    for (const [family, values] of Object.entries(families)) {
      for (const v of values) if (!(`${family}.${v}` in en)) unresolved.push(`${family}.${v}`);
    }
    expect(unresolved).toEqual([]);
    expect(t("admin.signin.title")).toBe("Sign in");
  });

  it("every GST state code has a name", () => {
    const states = Object.keys(en).filter((k) => k.startsWith("admin.state."));
    expect(states.length).toBeGreaterThanOrEqual(36);
  });

  it("times are shown in IST with the suffix and Western digits (AC 62, 99)", () => {
    const shown = ist("2026-11-24T05:12:00.000Z");
    expect(shown).toMatch(/^24 Nov 2026,? 10:42 IST$/);
    expect(shown).toMatch(/^[\x20-\x7e]+$/); // ASCII only: no Indic or Arabic-Indic digits
  });
});
