import type { JSX } from "@solidjs/web";
import { createRouter, useNavigate, type RouterHistory } from "@solidjs/router";
import { HOME_PATH, ROUTES, type RouteMeta } from "./routes";
import { Approvals } from "./screens/Approvals";
import { AuditLog } from "./screens/AuditLog";
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
      { path: "*404", component: NotFound, info: NOT_FOUND },
    ],
  });
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;
