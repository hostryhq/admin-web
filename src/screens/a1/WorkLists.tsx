import { createEffect, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, DataTable, PageHeader, StatTile, Tabs, formatMoney, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { outcome } from "../../api/outcome";
import { createPaged } from "../../api/query";
import { Empty, ErrorState, StaleTag } from "../../components/common";
import { fmtDate, todayIst } from "../../components/dates";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type S = components["schemas"];
type Kind = S["LedgerListKind"];
type Row = S["LedgerListRow"];

export const LIST_KINDS: readonly Kind[] = ["overdue_charges", "charges_to_raise", "charges_without_invoice_reference", "pilots_ending", "retired_version_subscriptions", "outlets_over_limit"];
const TAB_KEY: Record<Kind, string> = {
  overdue_charges: "overdue",
  charges_to_raise: "toraise",
  charges_without_invoice_reference: "noref",
  pilots_ending: "pilots",
  retired_version_subscriptions: "retired",
  outlets_over_limit: "overlimit",
};

export const BUCKETS = [
  { id: "1-7", from: 1, to: 7 },
  { id: "8-15", from: 8, to: 15 },
  { id: "16-30", from: 16, to: 30 },
  { id: "30+", from: 31, to: Infinity },
] as const;

/** Sum of the listed amounts by age bucket: the same rows as the list, so the totals reconcile (AC 56). */
export function bucketTotals(rows: readonly Row[]): { id: string; paise: number }[] {
  return BUCKETS.map((b) => ({
    id: b.id,
    paise: rows.filter((r) => (r.age_days ?? 0) >= b.from && (r.age_days ?? 0) <= b.to).reduce((n, r) => n + (r.amount?.amount_paise ?? 0), 0),
  }));
}

function useList(kind: Kind) {
  const api = useApi();
  const paged = createPaged(
    () => kind,
    (k, cursor) => outcome(api.GET("/v1/ledger-lists/{list_kind}", { params: { path: { list_kind: k }, query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  return paged;
}

/**
 * AS15: the six work lists (A1-S13, S14; AC 24, 33, 38, 39, 55, 56, 61, 62). Each is a view the
 * service derives on read: nothing is sent and nothing is switched off automatically, and no list has
 * a Suspend or Lapse action (AC 57). The overdue buckets add up the very rows listed. Lists page at
 * 100 and load on demand; the tab counts come from the first page ("100+" when there is more).
 */
export function WorkLists(): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams<{ kind?: string }>();
  const state = useContext(SessionContext);
  const canLedger = () => hasPermission(state.session(), "admin.report.ledger");
  const kind = (): Kind => (LIST_KINDS.find((k) => k === params.kind) ?? "overdue_charges");
  const lists = Object.fromEntries(LIST_KINDS.map((k) => [k, useList(k)])) as Record<Kind, ReturnType<typeof useList>>;
  const current = () => lists[kind()];

  const count = (k: Kind): string => {
    const l = lists[k];
    if (l.first.loading() && !l.first.data()) return "";
    const n = l.rows().length;
    return l.hasMore() ? ` (${n}+)` : ` (${n})`;
  };
  const tabs = () => LIST_KINDS.map((k) => ({ id: k, label: `${t(`admin.lists.tab.${TAB_KEY[k]}`)}${count(k)}`, "data-testid": `lists-tab-${k}` }));

  // Totals need every overdue row, so the overdue list keeps loading until it is complete.
  createEffect(
    () => ({ more: lists.overdue_charges.hasMore(), busy: lists.overdue_charges.moreBusy(), failed: lists.overdue_charges.moreFailed() }),
    (s) => {
      if (s.more && !s.busy && !s.failed) void lists.overdue_charges.more();
    },
  );

  const open = (r: Row) => {
    if ((kind() === "overdue_charges" || kind() === "charges_without_invoice_reference") && r.subject_id) {
      navigate(orgPath(ROUTES.chargeDetail, r.organisation_id, { chargeId: r.subject_id }));
    } else if (kind() === "charges_to_raise") navigate(`${orgPath(ROUTES.charges, r.organisation_id)}?raise=1`);
    else navigate(orgPath(ROUTES.subscription, r.organisation_id));
  };

  const columns = (): Column<Row>[] => [
    { id: "org", header: t("admin.charges.col.org"), cell: (r) => r.organisation_name },
    ...(kind() === "overdue_charges" || kind() === "charges_to_raise" || kind() === "charges_without_invoice_reference"
      ? [{ id: "amount", header: t("admin.lists.col.amount"), numeric: true, cell: (r: Row) => (r.amount ? formatMoney(r.amount.amount_paise) : "") }]
      : []),
    {
      id: "due",
      header: kind() === "pilots_ending" ? t("admin.lists.review") : t("admin.lists.col.due"),
      cell: (r) => (r.due_date ? fmtDate(r.due_date) : ""),
    },
    ...(kind() === "overdue_charges" ? [{ id: "age", header: t("admin.lists.col.age"), numeric: true, cell: (r: Row) => (r.age_days === undefined ? "" : t("admin.board.days", { n: r.age_days })) }] : []),
    {
      id: "action",
      header: t("admin.devices.col.actions"),
      cell: (r) => (
        <Button data-testid={`lists-open-${r.subject_id ?? r.organisation_id}`} onClick={() => open(r)}>
          {t(kind() === "charges_to_raise" ? "admin.sub.raise" : "admin.lists.open")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("admin.lists.title")}
        actions={
          <>
            <a class="hy-btn hy-linkbutton" href={ROUTES.billingConfig.path} data-testid="lists-billcfg">
              {t("admin.billcfg.title")}
            </a>
            <Show when={canLedger()}>
              <a class="hy-btn hy-linkbutton" href={ROUTES.reports.path} data-testid="lists-reports">
                {t("admin.ledger.title")}
              </a>
            </Show>
          </>
        }
      />
      <p class="hy-hint" data-testid="lists-today">
        {t("admin.lists.today", { date: fmtDate(todayIst()) })}
      </p>
      <Tabs label={t("admin.lists.title")} tabs={tabs()} selected={kind()} onSelect={(id) => navigate(`/lists/${id}`)}>
        <div class="hy-stack" data-testid={`lists-panel-${kind()}`}>
          <Show when={kind() === "overdue_charges" && !current().hasMore() && current().first.data()}>
            <div class="hy-actions" data-testid="lists-buckets">
              <For each={bucketTotals(current().rows())}>
                {(b) => (
                  <StatTile
                    label={b.id === "30+" ? t("admin.lists.bucket.over", { n: 30 }) : t("admin.lists.bucket", { from: b.id.split("-")[0] ?? "", to: b.id.split("-")[1] ?? "" })}
                    value={formatMoney(b.paise)}
                    data-testid={`lists-bucket-${b.id}`}
                  />
                )}
              </For>
              <StatTile label={t("admin.charges.col.total")} value={formatMoney(current().rows().reduce((n, r) => n + (r.amount?.amount_paise ?? 0), 0))} data-testid="lists-bucket-total" />
            </div>
          </Show>
          <Show when={kind() === "outlets_over_limit"}>
            <p class="hy-hint">{t("admin.lists.overlimit.note")}</p>
          </Show>
          <StaleTag at={current().first.loadedAt()} />
          <Show when={current().first.failure() && !current().first.data()}>
            <ErrorState failure={current().first.failure()} onRetry={current().first.reload} data-testid="lists-error" />
          </Show>
          <Show when={!current().first.failure() || current().first.data()}>
            <DataTable
              caption={t(`admin.lists.tab.${TAB_KEY[kind()]}`)}
              columns={columns()}
              rows={current().rows()}
              rowKey={(r) => r.subject_id ?? r.organisation_id}
              loading={current().first.loading() && !current().first.data()}
              onOpen={open}
              empty={<Empty title={t("admin.lists.empty")} data-testid="lists-empty" />}
              data-testid="lists-table"
            />
          </Show>
          <Show when={current().hasMore() && kind() !== "overdue_charges"}>
            <p>
              <Button disabled={current().moreBusy()} onClick={current().more} data-testid="lists-more">
                {t("admin.common.more")}
              </Button>
            </p>
          </Show>
          <p class="hy-hint">{t("admin.lists.nothing")}</p>
        </div>
      </Tabs>
    </>
  );
}
