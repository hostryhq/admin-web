import { createEffect, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Card, DataTable, InlineAlert, PageHeader, StatusBadge, Tabs, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome, type Failure, type Outcome } from "../api/outcome";
import { createQuery, type AnyQuery } from "../api/query";
import { DeviceStateBadge } from "../components/badges";
import { DescriptionList, Empty, ErrorState, ist, SkeletonBlock, StaleTag } from "../components/common";
import { ROUTES } from "../routes";
import { SessionContext } from "../session/session";
import { endedPath } from "../shell/support";

type S = components["schemas"];
export const SUPPORT_TABS = ["profile", "structure", "registrations", "series", "settings", "members", "roles", "devices"] as const;
export type SupportTab = (typeof SUPPORT_TABS)[number];

/**
 * Screen 14: read-only view of one organisation's configuration, inside a support session. Every
 * tab is one audited read (said on the page). It is read-only by construction: there is no edit
 * control and the client only issues GETs here (AC 55). A read refused because the session ended
 * returns to screen 15 and shows no stale data (AC 56); a 503 means the access could not be
 * recorded, so nothing is shown (BR-48). Members show the masked mobile string the server returned,
 * never a full number, and no email or ID document exists in the data (AC 54).
 *
 * Gap: the member record has no "new-device caution" field yet (AC 96), so none is shown.
 */
export function SupportSessionView(): JSX.Element {
  const { t } = useI18n();
  const params = useParams<{ orgId: string; tab?: string }>();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const support = () => state.session()?.support;
  const active = () => support()?.organisationId === params.orgId;
  const tab = (): SupportTab => ((SUPPORT_TABS as readonly string[]).includes(params.tab ?? "") ? (params.tab as SupportTab) : "profile");

  const select = (id: string) => navigate(`${ROUTES.supportSession.path.replace(":orgId", params.orgId).replace("/:tab?", "")}/${id}`);

  const onRefused = () => {
    state.setSupport(undefined);
    navigate(endedPath(support()?.organisationName, "expired"), { replace: true });
  };

  return (
    <>
      <PageHeader title={`${t("admin.support.title")}${support()?.organisationName ? ` - ${support()?.organisationName}` : ""}`} />
      <Show
        when={active()}
        fallback={
          <Empty title={t("admin.support.none")} data-testid="support-none">
            <a href={ROUTES.organisationDetail.path.replace(":orgId", params.orgId)}>{t("admin.orgs.detail.back")}</a>
          </Empty>
        }
      >
        <p class="hy-hint" data-testid="support-recorded">
          {t("admin.support.recorded")}
        </p>
        <Tabs
          label={t("admin.support.tabs.label")}
          tabs={SUPPORT_TABS.map((id) => ({ id, label: t(`admin.support.tab.${id}`), "data-testid": `support-tab-${id}` }))}
          selected={tab()}
          onSelect={select}
          altShortcuts
        >
          <TabContent orgId={params.orgId} tab={tab()} onRefused={onRefused} />
        </Tabs>
      </Show>
    </>
  );
}

/** One audited read per tab selection. `key` changes with the tab so each selection reads again. */
function useRead<T>(orgId: string, tab: () => SupportTab, onlyFor: SupportTab[], call: (orgId: string) => Promise<Outcome<T>>, onRefused: () => void) {
  const q = createQuery(
    () => (onlyFor.includes(tab()) ? `${orgId}/${tab()}` : undefined),
    () => call(orgId),
  );
  createEffect(
    () => q.failure(),
    (f) => {
      if (f && (f.code === "support_session_required" || f.code === "support_session_ended" || f.status === 401)) onRefused();
    },
  );
  return q;
}

function failureText(f: Failure | undefined): string {
  return f?.status === 503 ? "admin.support.audit.failed" : f?.status === 404 ? "admin.error.notfound.item" : "admin.error.generic";
}

function Read(props: { q: AnyQuery; children: JSX.Element }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <Show when={props.q.loading() && !props.q.data()}>
        <SkeletonBlock rows={4} data-testid="support-loading" />
      </Show>
      <Show when={props.q.failure() && !props.q.data()}>
        <Show
          when={props.q.failure()?.status === 503}
          fallback={<ErrorState failure={props.q.failure()} onRetry={props.q.reload} data-testid="support-error" />}
        >
          <InlineAlert kind="danger" data-testid="support-audit-failed">
            {t(failureText(props.q.failure()))}
          </InlineAlert>
        </Show>
      </Show>
      <Show when={props.q.data()}>
        <StaleTag at={props.q.loadedAt()} />
        {props.children}
      </Show>
    </>
  );
}

function TabContent(props: { orgId: string; tab: SupportTab; onRefused: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const p = (orgId: string) => ({ params: { path: { organisation_id: orgId } } });
  const read = <T,>(only: SupportTab[], call: (orgId: string) => Promise<Outcome<T>>) => useRead(props.orgId, () => props.tab, only, call, props.onRefused);

  const profile = read(["profile"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/profile", p(id))));
  const brands = read(["structure"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/brands", p(id))));
  const outlets = read(["structure"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/outlets", p(id))));
  const regs = read(["registrations"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/tax-registrations", p(id))));
  const series = read(["series"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/document-series", p(id))));
  const settings = read(["settings"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/settings", p(id))));
  const members = read(["members"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/members", p(id))));
  const roles = read(["members", "roles"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/roles", p(id))));
  const devices = read(["devices"], (id) => outcome(api.GET("/v1/organisations/{organisation_id}/support-view/devices", p(id))));

  const roleName = (id: string) => roles.data()?.items.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  const memberCols: Column<S["Member"]>[] = [
    { id: "name", header: t("admin.support.members.name"), cell: (m) => m.display_name },
    { id: "status", header: t("admin.support.members.status"), cell: (m) => <StatusBadge kind={m.status === "active" ? "success" : "neutral"} label={t(`admin.support.members.status.${m.status}`)} /> },
    { id: "roles", header: t("admin.support.members.roles"), cell: (m) => m.role_assignments.map((a) => roleName(a.role_id)).join(", ") },
    { id: "mobile", header: t("admin.support.members.mobile"), cell: (m) => <span class="hy-num" data-testid="member-mobile">{m.mobile_masked ?? ""}</span> },
  ];
  const deviceCols: Column<S["Device"]>[] = [
    { id: "name", header: t("admin.devices.col.kind"), cell: (d) => `${t(`admin.devices.kind.${d.kind}`)} - ${d.name}` },
    { id: "state", header: t("admin.devices.col.state"), cell: (d) => <DeviceStateBadge state={d.state} /> },
    { id: "registered", header: t("admin.devices.col.registered"), cell: (d) => <span class="hy-num">{ist(d.registered_at, false)}</span> },
    { id: "billing", header: t("admin.devices.col.billing"), cell: (d) => t(`admin.support.billing.${d.billing_capability}`) },
  ];
  const seriesCols: Column<S["DocumentSeries"]>[] = [
    { id: "code", header: t("admin.support.series.code"), cell: (s) => <span class="hy-num">{s.code}</span> },
    { id: "type", header: t("admin.support.series.type"), cell: (s) => t(`admin.support.doctype.${s.doc_type}`) },
    { id: "status", header: t("admin.support.series.status"), cell: (s) => t(`admin.support.series.status.${s.status}`) },
  ];
  const roleCols: Column<S["Role"]>[] = [
    { id: "name", header: t("admin.support.roles.name"), cell: (r) => r.name },
    { id: "perms", header: t("admin.support.roles.permissions"), numeric: true, cell: (r) => r.permissions.length },
  ];
  const regCols: Column<S["TaxRegistration"]>[] = [
    { id: "legal", header: t("admin.create.tax.legalname"), cell: (r) => r.legal_name },
    { id: "regime", header: t("admin.create.tax.regime"), cell: (r) => t(`admin.create.regime.${r.regime}`) },
    { id: "gstin", header: t("admin.create.gstin"), cell: (r) => <span class="hy-num">{r.gstin ?? ""}</span> },
    { id: "state", header: t("admin.registration.col.state"), cell: (r) => t(`admin.registration.state.${r.regime === "unregistered" ? "not_required" : r.verification.state}`) },
  ];

  return (
    <div data-testid={`support-panel-${props.tab}`}>
      <Show when={props.tab === "profile"}>
        <Read q={profile}>
          <Card>
            <DescriptionList
              rows={[
                { label: t("admin.support.profile.name"), value: profile.data()?.name, testid: "support-profile-name" },
                { label: t("admin.orgs.col.status"), value: profile.data() ? t(`admin.orgs.status.${profile.data()?.status}`) : "" },
                { label: t("admin.orgs.col.created"), value: ist(profile.data()?.created_at) },
              ]}
            />
          </Card>
        </Read>
      </Show>
      <Show when={props.tab === "structure"}>
        <Read q={brands}>
          <h3>{t("admin.orgs.detail.brands")}</h3>
          <ul class="hy-list" data-testid="support-brands">
            <For each={brands.data()?.items ?? []}>{(b) => <li>{b.name}</li>}</For>
          </ul>
        </Read>
        <Read q={outlets}>
          <h3>{t("admin.orgs.detail.outlets")}</h3>
          <ul class="hy-list" data-testid="support-outlets">
            <For each={outlets.data()?.items ?? []}>{(o) => <li>{o.name} - {t(`admin.create.kind.${o.kind}`)}</li>}</For>
          </ul>
        </Read>
      </Show>
      <Show when={props.tab === "registrations"}>
        <Read q={regs}>
          <DataTable caption={t("admin.support.tab.registrations")} columns={regCols} rows={regs.data()?.items ?? []} rowKey={(r) => r.id} empty={<Empty title={t("admin.support.empty")} />} data-testid="support-registrations" />
        </Read>
      </Show>
      <Show when={props.tab === "series"}>
        <Read q={series}>
          <DataTable caption={t("admin.support.tab.series")} columns={seriesCols} rows={series.data()?.items ?? []} rowKey={(s) => s.id} empty={<Empty title={t("admin.support.empty")} />} data-testid="support-series" />
        </Read>
      </Show>
      <Show when={props.tab === "settings"}>
        <Read q={settings}>
          <Card>
            <DescriptionList
              rows={[
                { label: t("admin.support.settings.offline"), value: String(settings.data()?.offline_window_days ?? ""), testid: "support-offline-days" },
                { label: t("admin.support.settings.idle"), value: String(settings.data()?.idle_lock_minutes ?? "") },
              ]}
            />
          </Card>
        </Read>
      </Show>
      <Show when={props.tab === "members"}>
        <Read q={members}>
          <p class="hy-hint">{t("admin.support.masked.note")}</p>
          <DataTable caption={t("admin.support.tab.members")} columns={memberCols} rows={members.data()?.items ?? []} rowKey={(m) => m.id} empty={<Empty title={t("admin.support.empty")} />} data-testid="support-members" />
        </Read>
      </Show>
      <Show when={props.tab === "roles"}>
        <Read q={roles}>
          <DataTable caption={t("admin.support.tab.roles")} columns={roleCols} rows={roles.data()?.items ?? []} rowKey={(r) => r.id} empty={<Empty title={t("admin.support.empty")} />} data-testid="support-roles" />
        </Read>
      </Show>
      <Show when={props.tab === "devices"}>
        <Read q={devices}>
          <DataTable caption={t("admin.support.tab.devices")} columns={deviceCols} rows={devices.data()?.items ?? []} rowKey={(d) => d.id} empty={<Empty title={t("admin.devices.empty")} />} data-testid="support-devices" />
        </Read>
      </Show>
    </div>
  );
}
