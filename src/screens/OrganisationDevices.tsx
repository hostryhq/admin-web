import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { Button, DataTable, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createQuery } from "../api/query";
import { Empty, ErrorState, ist, StaleTag, useWriteGuard } from "../components/common";
import { DeviceStateBadge } from "../components/badges";
import { hasPermission, SessionContext } from "../session/session";
import { OrganisationFrame, type OrganisationView } from "./OrganisationFrame";
import { RevokeDialog } from "./RevokeDialog";

type Device = components["schemas"]["VendorDevice"];

/**
 * Screen 10: devices of one organisation. Opening it is an audited read (said on the page). Only
 * `active` devices show Revoke, and only to users with `admin.device.revoke` (AC 36, 42). There is no
 * un-revoke, wipe or hasten control anywhere (AC 41). No key, PIN or pack data is ever shown (BR-40).
 */
export function OrganisationDevices(): JSX.Element {
  return <OrganisationFrame tab="devices">{(view) => <Devices view={view} />}</OrganisationFrame>;
}

function Devices(props: { view: () => OrganisationView }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const canRevoke = () => hasPermission(state.session(), "admin.device.revoke");
  const [revoking, setRevoking] = createSignal<Device | undefined>();

  const q = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}/devices", { params: { path: { organisation_id: id } } })),
  );

  // Approved two-person approvals of this user (an over-quota revoke is completed by repeating it with the approval id).
  const approved = createQuery(
    () => (canRevoke() ? "approved" : undefined),
    () => outcome(api.GET("/v1/approvals", { params: { query: { state: "approved", limit: 100 } } })),
  );
  const approvalFor = (deviceId: string) =>
    approved
      .data()
      ?.items.find((a) => a.kind === "device_revoke_over_quota" && a.subject_id === deviceId && a.requested_by === state.session()?.userId)?.id;

  const outletName = (id: string) => props.view().outlets.find((o) => o.id === id)?.name ?? id.slice(0, 8);

  const columns = (): Column<Device>[] => [
    { id: "kind", header: t("admin.devices.col.kind"), cell: (d) => t(`admin.devices.kind.${d.kind}`) },
    { id: "outlet", header: t("admin.devices.col.outlet"), cell: (d) => outletName(d.outlet_id) },
    { id: "state", header: t("admin.devices.col.state"), cell: (d) => <DeviceStateBadge state={d.state} /> },
    { id: "registered", header: t("admin.devices.col.registered"), cell: (d) => <span class="hy-num">{ist(d.registered_at, false)}</span> },
    {
      id: "contact",
      header: t("admin.devices.col.contact"),
      cell: (d) => <span class="hy-num">{d.last_contact_at ? ist(d.last_contact_at) : t("admin.devices.never")}</span>,
    },
    { id: "billing", header: t("admin.devices.col.billing"), cell: (d) => (d.billing_capable ? t("admin.common.yes") : t("admin.common.no")) },
    {
      id: "protection",
      header: t("admin.devices.col.protection"),
      cell: (d) => (d.key_protection ? t(`admin.devices.protection.${d.key_protection === "os-software" ? "software" : d.key_protection}`) : ""),
    },
    {
      id: "actions",
      header: t("admin.devices.col.actions"),
      cell: (d) => (
        <Show when={canRevoke() && d.state === "active"}>
          <Button
            variant="danger"
            disabled={guard.disabled()}
            title={guard.title()}
            data-testid={`device-revoke-${d.id}`}
            onClick={() => setRevoking(d)}
          >
            {t("admin.devices.revoke")}
          </Button>
        </Show>
      ),
    },
  ];

  return (
    <div class="hy-stack" data-testid="org-devices">
      <p class="hy-hint" data-testid="devices-audited">
        {t("admin.devices.audited")}
      </p>
      <StaleTag at={q.loadedAt()} />
      <Show when={q.failure() && !q.data()}>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="devices-error" />
      </Show>
      <Show when={!q.failure() || q.data()}>
        <DataTable
          caption={t("admin.devices.title")}
          columns={columns()}
          rows={q.data()?.items ?? []}
          rowKey={(d) => d.id}
          loading={q.loading() && !q.data()}
          empty={<Empty title={t("admin.devices.empty")} data-testid="devices-empty" />}
          data-testid="devices-table"
        />
      </Show>
      <Show when={revoking()}>
        {(d) => (
          <RevokeDialog
            open
            organisationId={params.orgId}
            device={d()}
            outletName={outletName(d().outlet_id)}
            approvalId={approvalFor(d().id)}
            onClose={() => setRevoking(undefined)}
            onDone={() => {
              setRevoking(undefined);
              q.reload();
            }}
          />
        )}
      </Show>
    </div>
  );
}
