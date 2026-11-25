/**
 * Route table. A0 screens are numbered as in docs/design/admin-a0-flows.md section 3 (1 to 16);
 * A1 screens are 101 to 124 for AS01 to AS24 in docs/design/admin-a1-flows.md. Dialogs have no
 * route: A0 screens 9, 11 and 13 and A1's AS11, AS13, AS14, AS19, AS20 and AS22 open over a page.
 *
 * `permission` is a string or a list meaning "any of". A route without one needs sign-in only.
 * Controls and nav items the user may not use are absent, and a direct URL shows the forbidden page
 * (flows section 6). The server re-checks every permission regardless.
 */
export type NavId = "orgs" | "onboarding" | "billing" | "plans" | "taxrules" | "approvals" | "codes" | "audit" | "staff";

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
  navId?: NavId;
};

export const ROUTES = {
  signin: { id: "signin", screen: 1, path: "/signin", titleKey: "admin.signin.title", public: true },
  setup: { id: "setup", screen: 2, path: "/setup", titleKey: "admin.setup.title", public: true },
  sessionEnded: { id: "sessionEnded", screen: 3, path: "/session-ended", titleKey: "admin.session.title", public: true },
  staff: { id: "staff", screen: 4, path: "/staff", titleKey: "admin.staff.title", permission: "admin.user.manage", navId: "staff" },
  organisations: { id: "organisations", screen: 5, path: "/organisations", titleKey: "admin.orgs.title", permission: "admin.org.read", navId: "orgs" },
  organisationNew: { id: "organisationNew", screen: 7, path: "/organisations/new", titleKey: "admin.orgs.new", permission: "admin.org.create", navId: "onboarding" },
  organisationCreated: {
    id: "organisationCreated",
    screen: 8,
    path: "/organisations/:orgId/created",
    titleKey: "admin.orgs.created.title",
    permission: "admin.org.create",
    navId: "onboarding",
  },
  organisationDetail: { id: "organisationDetail", screen: 6, path: "/organisations/:orgId", titleKey: "admin.orgs.detail.title", permission: "admin.org.read", navId: "orgs" },
  organisationDevices: {
    id: "organisationDevices",
    screen: 10,
    path: "/organisations/:orgId/devices",
    titleKey: "admin.orgs.devices.title",
    permission: "admin.device.read",
    navId: "orgs",
  },
  audit: { id: "audit", screen: 12, path: "/audit", titleKey: "admin.audit.title", permission: ["admin.audit.read", "admin.audit.read_own"], navId: "audit" },
  approvals: { id: "approvals", screen: 121, path: "/approvals", titleKey: "admin.approvals.title", permission: "admin.approval.read", navId: "approvals" },
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

  // A1: onboarding
  board: { id: "board", screen: 101, path: "/onboarding", titleKey: "admin.board.title", permission: "admin.org.read", navId: "onboarding" },
  unverified: { id: "unverified", screen: 104, path: "/onboarding/unverified", titleKey: "admin.queue.title", permission: "admin.org.read", navId: "onboarding" },
  stepGstin: {
    id: "stepGstin",
    screen: 103,
    path: "/organisations/:orgId/onboarding/gstin",
    titleKey: "admin.verify.title",
    permission: "admin.org.read",
    navId: "onboarding",
  },
  stepPlan: {
    id: "stepPlan",
    screen: 105,
    path: "/organisations/:orgId/onboarding/plan",
    titleKey: "admin.plan.step.title",
    permission: "admin.org.read",
    navId: "onboarding",
  },
  checklist: {
    id: "checklist",
    screen: 106,
    path: "/organisations/:orgId/onboarding",
    titleKey: "admin.checklist.title",
    permission: "admin.org.read",
    navId: "onboarding",
  },
  // A1: plans and billing configuration
  plans: { id: "plans", screen: 107, path: "/plans", titleKey: "admin.plans.title", permission: "admin.subscription.read", navId: "plans" },
  planNew: { id: "planNew", screen: 108, path: "/plans/new", titleKey: "admin.plans.new", permission: "admin.plan.manage", navId: "plans" },
  planNewVersion: {
    id: "planNewVersion",
    screen: 108,
    path: "/plans/:planKey/new-version",
    titleKey: "admin.plans.newversion",
    permission: "admin.plan.manage",
    navId: "plans",
  },
  planVersion: {
    id: "planVersion",
    screen: 108,
    path: "/plans/:planKey/versions/:version",
    titleKey: "admin.version.view",
    permission: "admin.subscription.read",
    navId: "plans",
  },
  billingConfig: {
    id: "billingConfig",
    screen: 109,
    path: "/billing-configuration",
    titleKey: "admin.billcfg.title",
    permission: "admin.subscription.read",
    navId: "plans",
  },
  // A1: subscription, charges
  subscription: {
    id: "subscription",
    screen: 110,
    path: "/organisations/:orgId/subscription",
    titleKey: "admin.sub.title",
    permission: "admin.subscription.read",
    navId: "orgs",
  },
  charges: {
    id: "charges",
    screen: 112,
    path: "/organisations/:orgId/charges",
    titleKey: "admin.charges.title",
    permission: "admin.subscription.read",
    navId: "orgs",
  },
  chargeDetail: {
    id: "chargeDetail",
    screen: 112,
    path: "/organisations/:orgId/charges/:chargeId",
    titleKey: "admin.charges.detail",
    permission: "admin.subscription.read",
    navId: "orgs",
  },
  lists: { id: "lists", screen: 115, path: "/lists/:kind?", titleKey: "admin.lists.title", permission: "admin.subscription.read", navId: "billing" },
  reports: { id: "reports", screen: 116, path: "/reports", titleKey: "admin.ledger.title", permission: "admin.report.ledger", navId: "billing" },
  // A1: tax rule sets
  taxRules: { id: "taxRules", screen: 117, path: "/tax-rules", titleKey: "admin.tax.title", permission: "admin.taxrules.manage", navId: "taxrules" },
  taxRuleSet: {
    id: "taxRuleSet",
    screen: 118,
    path: "/tax-rules/:ruleSetId",
    titleKey: "admin.ruleset.view",
    permission: "admin.taxrules.manage",
    navId: "taxrules",
  },
  // A1: menu loading and codes
  menuLoading: {
    id: "menuLoading",
    screen: 123,
    path: "/organisations/:orgId/menu-loading",
    titleKey: "admin.act.page",
    permission: "admin.support.session.act",
    navId: "orgs",
  },
  codes: {
    id: "codes",
    screen: 124,
    path: "/sign-in-codes",
    titleKey: "admin.codes.title",
    permission: ["admin.signin_code.create", "admin.recovery.create"],
    navId: "codes",
  },
} as const satisfies Record<string, RouteMeta>;

export type RouteId = keyof typeof ROUTES;

/** Landing page after sign-in. */
export const HOME_PATH = ROUTES.organisations.path;

export type NavEntry = {
  id: NavId;
  path: string;
  labelKey: string;
  permission: string | readonly string[];
};

/** Top-nav entries in display order; those without permission are removed, not disabled. */
export const NAV: readonly NavEntry[] = [
  { id: "orgs", path: ROUTES.organisations.path, labelKey: "admin.orgs.title", permission: "admin.org.read" },
  { id: "onboarding", path: ROUTES.board.path, labelKey: "admin.nav.onboarding", permission: "admin.org.read" },
  { id: "billing", path: "/lists", labelKey: "admin.nav.billing", permission: "admin.subscription.read" },
  { id: "plans", path: ROUTES.plans.path, labelKey: "admin.nav.plans", permission: "admin.subscription.read" },
  { id: "taxrules", path: ROUTES.taxRules.path, labelKey: "admin.nav.taxrules", permission: "admin.taxrules.manage" },
  { id: "approvals", path: ROUTES.approvals.path, labelKey: "admin.approvals.title", permission: "admin.approval.read" },
  { id: "codes", path: ROUTES.codes.path, labelKey: "admin.nav.codes", permission: ROUTES.codes.permission },
  { id: "audit", path: ROUTES.audit.path, labelKey: "admin.audit.title", permission: ROUTES.audit.permission },
  { id: "staff", path: ROUTES.staff.path, labelKey: "admin.staff.title", permission: "admin.user.manage" },
];

export const orgPath = (route: { path: string }, orgId: string, extra: Record<string, string> = {}): string =>
  Object.entries({ ":orgId": orgId, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`:${k}`, v])) }).reduce(
    (p, [k, v]) => p.replace(k, v),
    route.path,
  );
