import { Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { PageHeader, WizardStepper, useI18n, type WizardStep } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { createQuery } from "../../api/query";
import { ErrorState, SkeletonBlock, StaleTag } from "../../components/common";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";
import { loadFacts, registrationsVerified, type Facts } from "./onboarding";

export type WizardStepId = "org" | "gstin" | "plan" | "golive";

/**
 * Statuses of the four steps, read from what the services hold, never from page state (BR-A1-2):
 * done, next, `locked` with the role that can do it (permission missing), or the step on screen.
 */
export function stepStatuses(
  current: WizardStepId,
  facts: Facts | undefined,
  can: (p: string) => boolean,
  t: (k: string, p?: Record<string, string | number>) => string,
): WizardStep[] {
  const doneOf = (id: WizardStepId): boolean => {
    if (id === "org") return true;
    if (!facts) return false;
    if (id === "gstin") return registrationsVerified(facts.org);
    if (id === "plan") return facts.subscription !== undefined && facts.subscription !== "denied" && facts.subscription.current !== undefined;
    return false;
  };
  const lockedFor = (id: WizardStepId): string | undefined => {
    if (id === "gstin" && !can("admin.registration.verify")) return t("admin.wizard.step.forrole", { role: t("admin.wizard.role.verifier") });
    if (id === "plan" && !can("admin.subscription.start") && !can("admin.subscription.manage")) return t("admin.wizard.step.forrole", { role: t("admin.wizard.role.billing") });
    return undefined;
  };
  const labels: Record<WizardStepId, string> = {
    org: t("admin.wizard.step.org"),
    gstin: t("admin.wizard.step.gstin"),
    plan: t("admin.wizard.step.plan"),
    golive: t("admin.wizard.step.golive"),
  };
  return (["org", "gstin", "plan", "golive"] as const).map((id) => {
    const reason = lockedFor(id);
    const status: WizardStep["status"] =
      id === current ? "current" : doneOf(id) ? "done" : reason ? "locked" : "next";
    return { id, label: labels[id], status, ...(status === "locked" && reason ? { lockedReason: reason } : {}) };
  });
}

/**
 * AS03, AS05, AS06 frame: organisation name, the stepper, and the step body. It reads the facts once
 * and hands them to the step with a reload. Completed steps are links; "locked" steps say for whom.
 */
export function WizardFrame(props: {
  current: Exclude<WizardStepId, "org">;
  /** The checklist step reads devices too (an audited read). */
  withDevices?: boolean;
  children: (facts: () => Facts, reload: () => void) => JSX.Element;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);

  const q = createQuery(
    () => params.orgId,
    (id) => loadFacts(api, id, props.withDevices === true),
  );

  const open = (id: string) => {
    const route = id === "org" ? ROUTES.organisationDetail : id === "gstin" ? ROUTES.stepGstin : id === "plan" ? ROUTES.stepPlan : ROUTES.checklist;
    navigate(orgPath(route, params.orgId));
  };

  return (
    <>
      <p>
        <a href={ROUTES.board.path} data-testid="wizard-back">
          {t("admin.board.title")}
        </a>
      </p>
      <Show when={q.loading() && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.wizard.title")}
        </h1>
        <SkeletonBlock rows={4} data-testid="wizard-loading" />
      </Show>
      <Show when={q.failure() && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.wizard.title")}
        </h1>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="wizard-error" />
      </Show>
      <Show when={q.data()}>
        {(facts) => (
          <>
            <PageHeader title={facts().org.organisation.name} />
            <StaleTag at={q.loadedAt()} />
            <WizardStepper label={t("admin.wizard.title")} steps={stepStatuses(props.current, facts(), can, t)} onOpen={open} />
            <div class="hy-stack" data-testid={`wizard-body-${props.current}`}>
              {props.children(facts, q.reload)}
            </div>
          </>
        )}
      </Show>
    </>
  );
}
