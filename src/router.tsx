import type { JSX } from "@solidjs/web";
import { createRouter, useNavigate, type RouterHistory } from "@solidjs/router";
import { HOME_PATH, ROUTES, type RouteMeta } from "./routes";
import { Approvals } from "./screens/Approvals";
import { AuditLog } from "./screens/AuditLog";
import { BillingConfig } from "./screens/a1/BillingConfig";
import { ChargeDetail } from "./screens/a1/ChargeDetail";
import { GoLive } from "./screens/a1/GoLive";
import { GstinStep } from "./screens/a1/GstinStep";
import { LedgerReports } from "./screens/a1/LedgerReports";
import { MenuLoading } from "./screens/a1/MenuLoading";
import { OnboardingBoard } from "./screens/a1/OnboardingBoard";
import { OrgCharges } from "./screens/a1/OrgCharges";
import { OrgSubscription } from "./screens/a1/OrgSubscription";
import { PlanEditor } from "./screens/a1/PlanEditor";
import { Plans } from "./screens/a1/Plans";
import { PlanStep } from "./screens/a1/PlanStep";
import { RuleSetEditor } from "./screens/a1/RuleSetEditor";
import { SignInCodes } from "./screens/a1/SignInCodes";
import { TaxRules } from "./screens/a1/TaxRules";
import { UnverifiedQueue } from "./screens/a1/UnverifiedQueue";
import { WorkLists } from "./screens/a1/WorkLists";
import { CreateOrganisation } from "./screens/CreateOrganisation";
import { CreationResult } from "./screens/CreationResult";
import { NotFound } from "./screens/Forbidden";
import { OrganisationDetail } from "./screens/OrganisationDetail";
import { OrganisationDevices } from "./screens/OrganisationDevices";
import { OrganisationList } from "./screens/OrganisationList";
import { SessionEnded } from "./screens/SessionEnded";
import { SetupAccount } from "./screens/SetupAccount";
import { SignIn } from "./screens/SignIn";
import { SupportSessionEnded } from "./screens/SupportSessionEnded";
import { SupportSessionView } from "./screens/SupportSessionView";
import { VendorStaff } from "./screens/VendorStaff";

const NOT_FOUND: RouteMeta = { id: "notFound", screen: 0, path: "*404", titleKey: "admin.error.notfound" };

/** `/` goes to the organisation list; the shell sends signed-out users on to sign-in. */
function Home(): JSX.Element {
  const navigate = useNavigate();
  navigate(HOME_PATH, { replace: true });
  return null;
}

/**
 * One router per app. Each route's `info` is its `RouteMeta`; the shell reads it for the page title,
 * the permission gate and the current nav item. A factory so tests can pass a memory history.
 */
export function createAdminRouter(history?: RouterHistory) {
  const r = ROUTES;
  return createRouter({
    ...(history ? { history } : {}),
    routes: [
      { path: "/", component: Home },
      { path: r.signin.path, component: SignIn, info: r.signin },
      { path: r.setup.path, component: SetupAccount, info: r.setup },
      { path: r.sessionEnded.path, component: SessionEnded, info: r.sessionEnded },
      { path: r.staff.path, component: VendorStaff, info: r.staff },
      { path: r.organisations.path, component: OrganisationList, info: r.organisations },
      { path: r.organisationNew.path, component: CreateOrganisation, info: r.organisationNew },
      { path: r.organisationCreated.path, component: CreationResult, info: r.organisationCreated },
      { path: r.organisationDetail.path, component: OrganisationDetail, info: r.organisationDetail },
      { path: r.organisationDevices.path, component: OrganisationDevices, info: r.organisationDevices },
      { path: r.audit.path, component: AuditLog, info: r.audit },
      { path: r.approvals.path, component: Approvals, info: r.approvals },
      { path: r.supportSession.path, component: SupportSessionView, info: r.supportSession },
      { path: r.supportSessionEnded.path, component: SupportSessionEnded, info: r.supportSessionEnded },
      // A1
      { path: r.board.path, component: OnboardingBoard, info: r.board },
      { path: r.unverified.path, component: UnverifiedQueue, info: r.unverified },
      { path: r.stepGstin.path, component: GstinStep, info: r.stepGstin },
      { path: r.stepPlan.path, component: PlanStep, info: r.stepPlan },
      { path: r.checklist.path, component: GoLive, info: r.checklist },
      { path: r.plans.path, component: Plans, info: r.plans },
      { path: r.planNew.path, component: () => <PlanEditor mode="new" />, info: r.planNew },
      { path: r.planNewVersion.path, component: () => <PlanEditor mode="newversion" />, info: r.planNewVersion },
      { path: r.planVersion.path, component: () => <PlanEditor mode="view" />, info: r.planVersion },
      { path: r.billingConfig.path, component: BillingConfig, info: r.billingConfig },
      { path: r.subscription.path, component: OrgSubscription, info: r.subscription },
      { path: r.charges.path, component: OrgCharges, info: r.charges },
      { path: r.chargeDetail.path, component: ChargeDetail, info: r.chargeDetail },
      { path: r.lists.path, component: WorkLists, info: r.lists },
      { path: r.reports.path, component: LedgerReports, info: r.reports },
      { path: r.taxRules.path, component: TaxRules, info: r.taxRules },
      { path: r.taxRuleSet.path, component: RuleSetEditor, info: r.taxRuleSet },
      { path: r.menuLoading.path, component: MenuLoading, info: r.menuLoading },
      { path: r.codes.path, component: SignInCodes, info: r.codes },
      { path: "*404", component: NotFound, info: NOT_FOUND },
    ],
  });
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;
