import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { AmountBreakdown, Button, Card, DataTable, DateField, InvoiceRefField, formatMoney, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createPaged, createQuery } from "../../api/query";
import { DescriptionList, ErrorState, ist, SkeletonBlock, StaleTag } from "../../components/common";
import { daysBetween, fmtDate, todayIst } from "../../components/dates";
import { ChargeStatusBadge, OverdueChip } from "../../components/ledgerBadges";
import { newIntentKey } from "../../components/formkeys";
import type { components } from "../../generated";
import { hasPermission, SessionContext } from "../../session/session";
import { OrganisationFrame } from "../OrganisationFrame";
import { breakdownRows, isPartPaid, overdueDays } from "./chargeView";
import { inForce } from "./BillingConfig";
import { AdjustDialog, PaymentDialog, type AdjustKind } from "./PaymentDialogs";
import { onShortcutEvent } from "./shortcutEvents";

type S = components["schemas"];

/**
 * AS12, detail: one charge with its payments (A1-S10 to S12; AC 32 to 35, 44, 52, 53). Opening it is
 * an audited read and the page says so. The invoice reference is set once and then locked; to correct
 * it a platform admin cancels the charge and raises it again. Corrections are new rows ("Reversed by"
 * chains), never edits (AC 34). Controls appear only with the permission (AC 35, 54).
 */
export function ChargeDetail(): JSX.Element {
  return <OrganisationFrame tab="charges">{() => <Detail />}</OrganisationFrame>;
}

function Detail(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ orgId: string; chargeId: string }>();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const [paying, setPaying] = createSignal(false);
  const [adjust, setAdjust] = createSignal<{ kind: AdjustKind; payment?: S["LedgerPayment"] } | undefined>();

  const q = createQuery(
    () => ({ org: params.orgId, id: params.chargeId }),
    (k) => outcome(api.GET("/v1/organisations/{organisation_id}/charges/{charge_id}", { params: { path: { organisation_id: k.org, charge_id: k.id } } })),
  );
  const pay = createPaged(
    () => ({ org: params.orgId, id: params.chargeId }),
    (k, cursor) =>
      outcome(
        api.GET("/v1/organisations/{organisation_id}/charges/{charge_id}/payments", {
          params: { path: { organisation_id: k.org, charge_id: k.id }, query: { limit: 100, ...(cursor ? { cursor } : {}) } },
        }),
      ),
  );
  const cfg = createQuery(
    () => "cfg",
    () => outcome(api.GET("/v1/billing-configurations", { params: { query: { limit: 100 } } })),
  );
  const reload = () => {
    q.reload();
    pay.first.reload();
  };
  const charge = () => q.data();
  const canPay = () => can("admin.subscription.manage") && charge()?.status === "open" && (charge()?.outstanding.amount_paise ?? 0) > 0;
  onShortcutEvent("record-payment", () => {
    if (canPay()) setPaying(true);
  });

  const reversedIds = () => new Set(pay.rows().filter((p) => p.reversal_of !== undefined).map((p) => p.reversal_of as string));

  const columns: Column<S["LedgerPayment"]>[] = [
    { id: "date", header: t("admin.payment.date"), cell: (p) => fmtDate(p.received_on) },
    { id: "amount", header: t("admin.payment.amount"), numeric: true, cell: (p) => (p.reversal_of ? `-${formatMoney(p.amount.amount_paise)}` : formatMoney(p.amount.amount_paise)) },
    { id: "method", header: t("admin.payment.method"), cell: (p) => t(`admin.payment.method.${p.method}`) },
    { id: "ref", header: t("admin.payment.ref"), cell: (p) => p.reference ?? "" },
    {
      id: "chain",
      header: t("admin.charges.chain"),
      cell: (p) =>
        p.reversal_of ? (
          <span data-testid={`payment-reversal-${p.id}`}>{t("admin.payment.reversal.of", { reason: p.reason ?? "" })}</span>
        ) : reversedIds().has(p.id) ? (
          <span data-testid={`payment-reversed-${p.id}`}>{t("admin.payment.reversed")}</span>
        ) : (
          ""
        ),
    },
    {
      id: "actions",
      header: t("admin.devices.col.actions"),
      cell: (p) => (
        <Show when={can("admin.subscription.adjust") && p.reversal_of === undefined && !reversedIds().has(p.id)}>
          <Button variant="danger" data-testid={`payment-reverse-${p.id}`} onClick={() => setAdjust({ kind: "reverse", payment: p })}>
            {t("admin.adjust.reverse.title")}
          </Button>
        </Show>
      ),
    },
  ];

  return (
    <div class="hy-stack" data-testid="charge-detail">
      <p>
        <a href={`/organisations/${params.orgId}/charges`} data-testid="charge-back">
          {t("admin.charges.title")}
        </a>
      </p>
      <Show when={q.loading() && !q.data()}>
        <SkeletonBlock rows={5} data-testid="charge-loading" />
      </Show>
      <Show when={q.failure() && !q.data()}>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="charge-error" />
      </Show>
      <Show when={charge()}>
        {(c) => {
          const br = () => breakdownRows(c(), t);
          return (
            <>
              <Card title={t("admin.charges.detail")}>
                <StaleTag at={q.loadedAt()} />
                <p class="hy-hint" data-testid="charge-audited">
                  {t("admin.charges.detail.audited")}
                </p>
                <div class="hy-actions">
                  <ChargeStatusBadge status={c().status} partPaid={isPartPaid(c())} />
                  <Show when={overdueDays(c(), todayIst(), daysBetween) > 0}>
                    <OverdueChip days={overdueDays(c(), todayIst(), daysBetween)} />
                  </Show>
                </div>
                <DescriptionList
                  rows={[
                    { label: t("admin.charges.col.period"), value: `${fmtDate(c().period_start)} - ${fmtDate(c().period_end)}`, testid: "charge-period" },
                    { label: t("admin.charges.col.due"), value: fmtDate(c().due_date), testid: "charge-due" },
                    { label: t("admin.charges.outstanding"), value: <span class="hy-num">{formatMoney(c().outstanding.amount_paise)}</span>, testid: "charge-outstanding" },
                    ...(c().kind === "extra" ? [{ label: t("admin.charge.raise.type.extra"), value: c().reason ?? "", testid: "charge-reason" }] : []),
                    ...(c().note ? [{ label: t("admin.charges.note"), value: c().note ?? "", testid: "charge-note" }] : []),
                  ]}
                />
                <AmountBreakdown label={t("admin.charges.detail")} rows={br().rows} totalPaise={c().total.amount_paise} totalLabel={t("admin.charge.raise.total")} data-testid="charge-breakdown" />
                <Show when={br().noGst}>
                  <p class="hy-hint">{t("admin.charge.raise.nogst")}</p>
                </Show>
              </Card>

              <Card title={t("admin.charges.ref.label")}>
                <RefBlock charge={c()} canSet={can("admin.subscription.manage")} onSet={reload} />
              </Card>

              <Card title={t("admin.payment.title")}>
                <Show when={pay.first.failure() && !pay.first.data()}>
                  <ErrorState failure={pay.first.failure()} onRetry={pay.first.reload} data-testid="payments-error" />
                </Show>
                <DataTable
                  caption={t("admin.payment.title")}
                  columns={columns}
                  rows={pay.rows()}
                  rowKey={(p) => p.id}
                  loading={pay.first.loading() && !pay.first.data()}
                  empty={<p class="hy-hint" data-testid="payments-empty">{t("admin.payment.none")}</p>}
                  data-testid="payments-table"
                />
                <div class="hy-actions">
                  <Show when={canPay()}>
                    <Button variant="primary" data-testid="charge-pay" onClick={() => setPaying(true)}>
                      {t("admin.payment.title")}
                    </Button>
                  </Show>
                  <Show when={can("admin.subscription.adjust") && c().status === "open"}>
                    <Button data-testid="charge-waive" onClick={() => setAdjust({ kind: "waive" })}>
                      {t("admin.adjust.waive.title")}
                    </Button>
                    <Button variant="danger" data-testid="charge-cancel" onClick={() => setAdjust({ kind: "cancel" })}>
                      {t("admin.adjust.cancel.title")}
                    </Button>
                  </Show>
                </div>
              </Card>
              <p class="hy-hint" data-testid="charge-chain">
                {t("admin.charges.chain")}: {t("admin.charges.raised", { time: ist(c().created_at) })}
              </p>

              <Show when={paying()}>
                <PaymentDialog
                  organisationId={params.orgId}
                  charge={c()}
                  payments={pay.rows()}
                  tolerancePaise={inForce(cfg.data()?.items ?? [], todayIst())?.payment_tolerance_paise}
                  onClose={() => setPaying(false)}
                  onDone={() => {
                    setPaying(false);
                    reload();
                  }}
                />
              </Show>
              <Show when={adjust()}>
                {(a) => (
                  <AdjustDialog
                    kind={a().kind}
                    organisationId={params.orgId}
                    chargeId={c().id}
                    {...(a().payment ? { paymentId: a().payment?.id ?? "", subject: `${formatMoney(a().payment?.amount.amount_paise ?? 0)} (${t(`admin.payment.method.${a().payment?.method ?? "upi"}`)}, ${fmtDate(a().payment?.received_on)})` } : {})}
                    onClose={() => setAdjust(undefined)}
                    onDone={() => {
                      setAdjust(undefined);
                      reload();
                    }}
                  />
                )}
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}

/**
 * Invoice reference and date (BR-A1-34, AC 44). Editable once by `admin.subscription.manage`, then
 * read-only with a lock. A mistyped one is not edited: a platform admin cancels the charge and raises
 * it again (A1-Q8). The panel never issues the invoice (P2A-6).
 */
function RefBlock(props: { charge: S["Charge"]; canSet: boolean; onSet: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const key = newIntentKey();
  const [date, setDate] = createSignal(todayIst());
  const [error, setError] = createSignal<string | undefined>();
  const ref = () => props.charge.invoice_reference;
  const set = async (number: string) => {
    setError(undefined);
    const r = await outcome(
      api.PUT("/v1/organisations/{organisation_id}/charges/{charge_id}/invoice-reference", {
        params: { path: { organisation_id: props.charge.organisation_id, charge_id: props.charge.id }, header: mut(key) },
        body: { invoice_reference: { number, date: date() } },
      }),
    );
    if (!r.ok) {
      setError(writeError(r.failure, { invoice_reference_set: "admin.charges.ref.alreadyset" }));
      return;
    }
    toasts.show(t("admin.charges.ref.saved"));
    props.onSet();
  };
  return (
    <div class="hy-stack" data-testid="charge-ref-block">
      <p class="hy-hint">{t("admin.charge.raise.books")}</p>
      <Show
        when={ref()}
        fallback={
          <Show when={props.canSet} fallback={<p data-testid="charge-ref-none">{t("admin.charges.ref.none")}</p>}>
            <DateField label={t("admin.charges.ref.date")} value={date()} max={todayIst()} onChange={setDate} data-testid="charge-ref-date" />
            <InvoiceRefField label={t("admin.charges.ref.label")} value={undefined} {...(error() ? { error: t(error() ?? "") } : {})} onSet={set} data-testid="charge-ref" />
          </Show>
        }
      >
        {(r) => (
          <>
            <InvoiceRefField label={t("admin.charges.ref.label")} value={r().number} onSet={() => undefined} data-testid="charge-ref" />
            <p data-testid="charge-ref-date-locked">
              {t("admin.charges.ref.date")}: <span class="hy-num">{fmtDate(r().date)}</span>
            </p>
            <p class="hy-hint">{t("admin.charges.ref.fix")}</p>
          </>
        )}
      </Show>
    </div>
  );
}
