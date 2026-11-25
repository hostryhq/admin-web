/**
 * Route table for the A0 screens, numbered as in docs/design/admin-a0-flows.md section 3.
 * Dialogs have no route: screen 9 (invitation resend/extend, cancel, re-issue), 11 (revoke device)
 * and 13 (start support session) open over screens 6, 10 and 6. Screen 16 is the approvals queue (A0-S19).
 *
 * `permission` is a string or a list meaning "any of". A route without one needs sign-in only.
 * Controls and nav items the user may not use are absent, and a direct URL shows the forbidden page
 * (flows section 6). The server re-checks every permission regardless.
 */
export type RouteMeta = {
  id: string;
  /** Screen number in the flows doc, or 0 for app-level pages. */
  screen: number;
  path: string;
  /** i18n key for the page title (also the document title). */
  titleKey: string;
  permission?: string | readonly string[];
  /** Reachable without a session (sign-in, setup, session ended). */
  public?: boolean;
  /** Which top-nav item is current on this route. */
  navId?: "orgs" | "audit" | "approvals" | "staff";
};

export const ROUTES = {
  signin: { id: "signin", screen: 1, path: "/signin", titleKey: "admin.signin.title", public: true },
  setup: { id: "setup", screen: 2, path: "/setup", titleKey: "admin.setup.title", public: true },
  sessionEnded: {
    id: "sessionEnded",
    screen: 3,
    path: "/session-ended",
    titleKey: "admin.session.title",
    public: true,
  },
  staff: {
    id: "staff",
    screen: 4,
    path: "/staff",
    titleKey: "admin.staff.title",
    permission: "admin.user.manage",
    navId: "staff",
  },
  organisations: {
    id: "organisations",
    screen: 5,
    path: "/organisations",
    titleKey: "admin.orgs.title",
    permission: "admin.org.read",
    navId: "orgs",
  },
  organisationNew: {
    id: "organisationNew",
    screen: 7,
    path: "/organisations/new",
    titleKey: "admin.orgs.new",
    permission: "admin.org.create",
    navId: "orgs",
  },
  organisationCreated: {
    id: "organisationCreated",
    screen: 8,
    path: "/organisations/:orgId/created",
    titleKey: "admin.orgs.created.title",
    permission: "admin.org.create",
    navId: "orgs",
  },
  organisationDetail: {
    id: "organisationDetail",
    screen: 6,
    path: "/organisations/:orgId",
    titleKey: "admin.orgs.detail.title",
    permission: "admin.org.read",
    navId: "orgs",
  },
  organisationDevices: {
    id: "organisationDevices",
    screen: 10,
    path: "/organisations/:orgId/devices",
    titleKey: "admin.orgs.devices.title",
    permission: "admin.device.read",
    navId: "orgs",
  },
  audit: {
    id: "audit",
    screen: 12,
    path: "/audit",
    titleKey: "admin.audit.title",
    permission: ["admin.audit.read", "admin.audit.read_own"],
    navId: "audit",
  },
  approvals: {
    id: "approvals",
    screen: 16,
    path: "/approvals",
    titleKey: "admin.approvals.title",
    permission: "admin.device.revoke",
    navId: "approvals",
  },
  supportSession: {
    id: "supportSession",
    screen: 14,
    path: "/support-session/:orgId/:tab?",
    titleKey: "admin.support.title",
    permission: "admin.support.session.start",
    navId: "orgs",
  },
  supportSessionEnded: {
    id: "supportSessionEnded",
    screen: 15,
    path: "/support-session-ended",
    titleKey: "admin.support.ended.title",
    permission: "admin.support.session.start",
    navId: "orgs",
  },
} as const satisfies Record<string, RouteMeta>;

export type RouteId = keyof typeof ROUTES;

/** Landing page after sign-in. */
export const HOME_PATH = ROUTES.organisations.path;

export type NavEntry = {
  id: "orgs" | "audit" | "approvals" | "staff";
  path: string;
  labelKey: string;
  permission: string | readonly string[];
};

/** Top-nav entries in display order; those without permission are removed, not disabled. */
export const NAV: readonly NavEntry[] = [
  { id: "orgs", path: ROUTES.organisations.path, labelKey: "admin.orgs.title", permission: "admin.org.read" },
  { id: "audit", path: ROUTES.audit.path, labelKey: "admin.audit.title", permission: ROUTES.audit.permission },
  { id: "approvals", path: ROUTES.approvals.path, labelKey: "admin.approvals.title", permission: "admin.device.revoke" },
  { id: "staff", path: ROUTES.staff.path, labelKey: "admin.staff.title", permission: "admin.user.manage" },
];
