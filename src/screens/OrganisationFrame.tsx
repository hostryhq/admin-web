import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, PageHeader, Tabs, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createQuery } from "../api/query";
import { CopyId, Empty, ErrorState, SkeletonBlock, StaleTag } from "../components/common";
import { OrgStatusBadge } from "../components/badges";
import { ROUTES } from "../routes";
import { hasPermission, SessionContext } from "../session/session";
import { StartSupportDialog } from "./StartSupportDialog";

export type OrganisationView = components["schemas"]["OrganisationDetailView"];
export type OrgTab = "overview" | "devices";

/**
 * Shared page frame for one organisation (screens 6 and 10): heading, status, copyable id, the
 * Start support session action and the Overview / Devices tabs. It reads the directory view, which
 * is not an audited read. Controls the user may not use are absent, not disabled (AC 13, 61).
 * The Devices tab is a separate route so the device read (audited) happens only when it is opened.
 */
export function OrganisationFrame(props: {
  tab: OrgTab;
  children: (view: () => OrganisationView, reload: () => void) => JSX.Element;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const [startOpen, setStartOpen] = createSignal(false);

  const q = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}", { params: { path: { organisation_id: id } } })),
  );

  const tabs = () => [
    { id: "overview", label: t("admin.orgs.tab.overview"), "data-testid": "org-tab-overview" },
    ...(can("admin.device.read") ? [{ id: "devices", label: t("admin.orgs.tab.devices"), "data-testid": "org-tab-devices" }] : []),
  ];
  const select = (id: string) =>
    navigate(
      (id === "devices" ? ROUTES.organisationDevices.path : ROUTES.organisationDetail.path).replace(":orgId", params.orgId),
    );

  const backLink = () => (
    <a href={ROUTES.organisations.path} data-testid="org-back">
      {t("admin.orgs.detail.back")}
    </a>
  );

  return (
    <>
      <p>{backLink()}</p>
      <Show when={q.loading() && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.orgs.detail.title")}
        </h1>
        <SkeletonBlock rows={4} data-testid="org-loading" />
      </Show>
      <Show when={q.failure()?.status === 404}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.orgs.detail.title")}
        </h1>
        <Empty title={t("admin.orgs.detail.notfound")} data-testid="org-notfound" />
      </Show>
      <Show when={q.failure() && q.failure()?.status !== 404 && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.orgs.detail.title")}
        </h1>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="org-error" />
      </Show>
      <Show when={q.data()}>
        {(view) => (
          <>
            <PageHeader
              title={view().organisation.name}
              actions={
                <>
                  <OrgStatusBadge status={view().organisation.status} />
                  <CopyId id={view().organisation.id} data-testid="org-id" />
                  <Show when={can("admin.support.session.start")}>
                    <Button variant="primary" data-testid="org-start-support" onClick={() => setStartOpen(true)}>
                      {t("admin.support.start.title")}
                    </Button>
                  </Show>
                </>
              }
            />
            <StaleTag at={q.loadedAt()} />
            <Tabs label={t("admin.orgs.tabs.label")} tabs={tabs()} selected={props.tab} onSelect={select} altShortcuts>
              {props.children(view, q.reload)}
            </Tabs>
            <StartSupportDialog
              open={startOpen()}
              onClose={() => setStartOpen(false)}
              organisationId={view().organisation.id}
              organisationName={view().organisation.name}
            />
          </>
        )}
      </Show>
    </>
  );
}
