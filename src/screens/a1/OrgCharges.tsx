import { createEffect, createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { Button, DataTable, Input, formatMoney, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { outcome } from "../../api/outcome";
import { createPaged, createQuery } from "../../api/query";
import { Empty, ErrorState, StaleTag } from "../../components/common";
import { daysBetween, fmtDate, todayIst } from "../../components/dates";
import { Select } from "../../components/fields";
import { ChargeStatusBadge, OverdueChip } from "../../components/ledgerBadges";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";
import { OrganisationFrame } from "../OrganisationFrame";
import { isPartPaid, overdueDays } from "./chargeView";
import { RaiseChargeDialog } from "./RaiseChargeDialog";
import { onShortcutEvent } from "./shortcutEvents";

type Charge = components["schemas"]["Charge"];
const STATUSES = ["open", "paid", "waived", "cancelled"] as const;

/**
 * AS12, list: one organisation's charges (A1-S10; AC 32, 33, 55, 62). Filters: status (sent to the
 * server) and invoice reference (Any or None, which is the "no invoice reference" view, AC 33).
 * A list read writes no audit entry; opening a charge does, and the page says so (AC 52). There is no
 * Edit or Delete anywhere (AC 34). The contract has no cross-organisation charge search, so the
 * organisation's own list and the work lists are the two ways in.
 */
export function OrgCharges(): JSX.Element {
  return (
    <OrganisationFrame tab="charges">
      {() => (
        <Charges />
      )}
    </OrganisationFrame>
  );
}

function Charges(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const canRaise = () => hasPermission(state.session(), "admin.subscription.manage");
  const [status, setStatus] = createSignal("");
  const [ref, setRef] = createSignal("");
  const [text, setText] = createSignal("");
  const [raising, setRaising] = createSignal(false);

  const paged = createPaged(
    () => ({ id: params.orgId, status: status() }),
    (k, cursor) =>
      outcome(
        api.GET("/v1/organisations/{organisation_id}/charges", {
          params: { path: { organisation_id: k.id }, query: { limit: 25, ...(k.status ? { status: k.status as Charge["status"] } : {}), ...(cursor ? { cursor } : {}) } },
        }),
      ),
  );
  const sub = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}/subscription", { params: { path: { organisation_id: id } } })),
  );
  onShortcutEvent("raise-charge", () => {
    if (canRaise() && sub.data()?.current) setRaising(true);
  });
  // "Charges to raise" rows arrive here with ?raise=1 and the dialog open, once.
  const location = useLocation();
  let opened = false;
  createEffect(
    () => sub.data()?.current,
    (s) => {
      if (opened || !s || s.cycle === "none" || !canRaise()) return;
      if (new URLSearchParams(location.search).get("raise") === "1") {
        opened = true;
        setRaising(true);
      }
    },
  );

  const today = todayIst();
  const rows = () =>
    paged
      .rows()
      .filter((c) => (ref() === "none" ? c.invoice_reference === undefined : ref() === "set" ? c.invoice_reference !== undefined : true))
      .filter((c) => {
        const q = text().trim().toLowerCase();
        return !q || c.id.toLowerCase().includes(q) || (c.invoice_reference?.number.toLowerCase().includes(q) ?? false);
      });

  const columns: Column<Charge>[] = [
    { id: "period", header: t("admin.charges.col.period"), cell: (c) => `${fmtDate(c.period_start)} - ${fmtDate(c.period_end)}` },
    { id: "total", header: t("admin.charges.col.total"), numeric: true, cell: (c) => formatMoney(c.total.amount_paise) },
    { id: "due", header: t("admin.charges.col.due"), cell: (c) => fmtDate(c.due_date) },
    { id: "ref", header: t("admin.charges.col.ref"), cell: (c) => c.invoice_reference?.number ?? t("admin.charges.ref.none") },
    {
      id: "status",
      header: t("admin.charges.col.status"),
      cell: (c) => (
        <span class="hy-actions">
          <ChargeStatusBadge status={c.status} partPaid={isPartPaid(c)} />
          <Show when={overdueDays(c, today, daysBetween) > 0}>
            <OverdueChip days={overdueDays(c, today, daysBetween)} />
          </Show>
        </span>
      ),
    },
  ];

  return (
    <div class="hy-stack" data-testid="org-charges">
      <div class="hy-actions">
        <Show when={canRaise() && sub.data()?.current && sub.data()?.current?.cycle !== "none"}>
          <Button variant="primary" data-testid="charges-raise" onClick={() => setRaising(true)}>
            {t("admin.sub.raise")}
          </Button>
        </Show>
      </div>
      <form class="hy-filterbar" role="search" onSubmit={(e: SubmitEvent) => e.preventDefault()}>
        <Input
          name="q"
          type="search"
          label={t("admin.charges.search")}
          value={text()}
          onInput={(e: InputEvent) => setText((e.currentTarget as HTMLInputElement).value)}
          data-shortcut="search"
          data-testid="charges-search"
        />
        <Select
          name="status"
          label={t("admin.charges.col.status")}
          value={status()}
          options={[{ value: "", label: t("admin.common.all") }, ...STATUSES.map((s) => ({ value: s, label: t(`admin.charges.status.${s}`) }))]}
          onChange={(e: Event) => setStatus((e.currentTarget as HTMLSelectElement).value)}
          data-testid="charges-status"
        />
        <Select
          name="ref"
          label={t("admin.charges.col.ref")}
          value={ref()}
          options={[
            { value: "", label: t("admin.charges.ref.any") },
            { value: "none", label: t("admin.charges.ref.none") },
            { value: "set", label: t("admin.charges.ref.set") },
          ]}
          onChange={(e: Event) => setRef((e.currentTarget as HTMLSelectElement).value)}
          data-testid="charges-ref"
        />
      </form>
      <p class="hy-hint">{t("admin.charges.detail.audited")}</p>
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="charges-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.charges.title")}
          columns={columns}
          rows={rows()}
          rowKey={(c) => c.id}
          loading={paged.first.loading() && !paged.first.data()}
          onOpen={(c) => navigate(orgPath(ROUTES.chargeDetail, params.orgId, { chargeId: c.id }))}
          empty={<Empty title={t("admin.charges.empty")} data-testid="charges-empty" />}
          data-testid="charges-table"
        />
      </Show>
      <Show when={paged.hasMore()}>
        <p>
          <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="charges-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
      <Show when={raising()}>
        <RaiseChargeDialog
          open
          organisationId={params.orgId}
          subscription={sub.data()?.current}
          onClose={() => setRaising(false)}
          onDone={paged.first.reload}
        />
      </Show>
    </div>
  );
}
