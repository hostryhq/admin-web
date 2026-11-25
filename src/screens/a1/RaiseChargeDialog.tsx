import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { AmountBreakdown, Button, DateField, InlineAlert, Input, MoneyField, formatBasisPoints, formatMoney, useI18n } from "@hostry/ui-kit";
import { looksPersonal } from "../../components/personal";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { fmtDate, addDays, periodEnd, todayIst } from "../../components/dates";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, TextArea } from "../../components/fields";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { MIN_REASON } from "../StartSupportDialog";
import { inForce } from "./BillingConfig";
import { breakdownRows } from "./chargeView";

type S = components["schemas"];

/** The next period: starts the day after `paid_through` (or on the start date for a first charge). */
export function nextPeriod(sub: S["Subscription"] | undefined): { start: string; end: string } {
  const cycle = sub?.cycle === "annual" ? "annual" : "monthly";
  const start = sub?.paid_through ? addDays(sub.paid_through, 1) : (sub?.start_date ?? todayIst());
  return { start, end: periodEnd(start, cycle) };
}

/**
 * AS11: raise a charge (A1-S09; AC 27 to 31, 43). Period and type are prefilled. The GST split is the
 * service's, so it is shown from the stored result right after the write (and on the charge page), not
 * recomputed in the browser; before the write the dialog states the configuration the service will use.
 * A duplicate period is refused and offers an extra charge with a reason (AC 31). The panel never issues
 * an invoice: the reference is entered later on the charge. The submit is disabled while in flight (AC 43).
 */
export function RaiseChargeDialog(props: {
  open: boolean;
  organisationId: string;
  subscription: S["Subscription"] | undefined;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const cfg = createQuery(
    () => "cfg",
    () => outcome(api.GET("/v1/billing-configurations", { params: { query: { limit: 100 } } })),
  );
  const config = () => inForce(cfg.data()?.items ?? [], todayIst());
  const p = nextPeriod(props.subscription);
  const [kind, setKind] = createSignal<"period" | "extra">("period");
  const [start, setStart] = createSignal(p.start);
  const [end, setEnd] = createSignal(p.end);
  const [taxable, setTaxable] = createSignal<number | undefined>();
  const [reason, setReason] = createSignal("");
  const [dup, setDup] = createSignal(false);
  const [note, setNote] = createSignal("");
  const [created, setCreated] = createSignal<S["Charge"] | undefined>();

  const valid = () =>
    start() !== "" && end() >= start() && note().length <= 200 && !looksPersonal(note()) && !(kind() === "extra" && looksPersonal(reason())) && (kind() === "period" ? props.subscription?.cycle !== "none" : taxable() !== undefined && taxable() !== 0 && reason().trim().length >= MIN_REASON);

  const base = () => {
    const s = props.subscription;
    if (!s) return undefined;
    return s.agreed_price.amount_paise + s.addons.reduce((n, a) => n + a.agreed_price.amount_paise * a.quantity, 0);
  };

  const done = (): JSX.Element | undefined => {
    const c = created();
    if (!c) return undefined;
    const { rows, noGst } = breakdownRows(c, t);
    return (
      <>
        <p data-testid="raise-done-title">{t("admin.charge.raise.done")}</p>
        <AmountBreakdown label={t("admin.charge.raise.title")} rows={rows} totalPaise={c.total.amount_paise} totalLabel={t("admin.charge.raise.total")} data-testid="raise-breakdown" />
        <Show when={noGst}>
          <p class="hy-hint" data-testid="raise-nogst">
            {t("admin.charge.raise.nogst")}
          </p>
        </Show>
        <p data-testid="raise-due">
          {t("admin.charge.raise.due")}: <span class="hy-num">{fmtDate(c.due_date)}</span>
        </p>
        <p class="hy-hint">{t("admin.charge.raise.books")}</p>
        <a href={orgPath(ROUTES.chargeDetail, c.organisation_id, { chargeId: c.id })} data-testid="raise-open-charge">
          {t("admin.charge.raise.open")}
        </a>
      </>
    );
  };

  return (
    <FormDialog
      open={props.open}
      title={t("admin.charge.raise.title")}
      submitLabel={t("admin.charge.raise.submit")}
      valid={valid()}
      onClose={() => {
        const had = created() !== undefined;
        props.onClose();
        if (had) props.onDone();
      }}
      done={done()}
      data-testid="raise-dialog"
      onSubmit={async (key) => {
        setDup(false);
        const r = await outcome(
          api.POST("/v1/organisations/{organisation_id}/charges", {
            params: { path: { organisation_id: props.organisationId }, header: mut(key) },
            body: {
              kind: kind(),
              period_start: start(),
              period_end: end(),
              ...(kind() === "extra" ? { taxable: { amount_paise: taxable() ?? 0, currency: "INR" as const }, reason: reason().trim() } : {}),
              ...(note().trim() ? { note: note().trim() } : {}),
            },
          }),
        );
        if (!r.ok) {
          if (r.failure.code === "duplicate_period") setDup(true);
          return writeError(r.failure, { duplicate_period: "admin.charge.raise.dup", no_subscription: "admin.charge.raise.nosub" });
        }
        setCreated(r.data);
        return undefined;
      }}
    >
      <RadioGroup
        legend={t("admin.charge.raise.type")}
        name="kind"
        value={kind()}
        onChange={(v) => setKind(v as "period" | "extra")}
        options={[
          { value: "period", label: t("admin.charge.raise.type.sub") },
          { value: "extra", label: t("admin.charge.raise.type.extra") },
        ]}
        data-testid="raise-kind"
      />
      <div class="hy-filterbar">
        <DateField label={t("admin.charge.raise.start")} value={start()} onChange={setStart} data-testid="raise-start" />
        <DateField label={t("admin.charge.raise.end")} value={end()} onChange={setEnd} data-testid="raise-end" />
      </div>
      <Show when={kind() === "period"}>
        <p data-testid="raise-base">
          {t("admin.charge.raise.taxable")}: <span class="hy-num">{base() === undefined ? "" : formatMoney(base() ?? 0)}</span>
        </p>
      </Show>
      <Show when={kind() === "extra"}>
        <MoneyField label={t("admin.charge.raise.taxable")} valuePaise={taxable()} onChange={setTaxable} data-testid="raise-taxable" />
        <TextArea
          name="reason"
          label={`${t("admin.charge.raise.reason")} *`}
          value={reason()}
          counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
          onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid="raise-reason"
        />
      </Show>
      <Input
        name="note"
        label={t("admin.charges.note")}
        value={note()}
        maxlength={200}
        autocomplete="off"
        error={looksPersonal(note()) ? t("admin.charges.note.refused") : undefined}
        onInput={(e: InputEvent) => setNote((e.currentTarget as HTMLInputElement).value)}
        data-testid="raise-note"
      />
      <p class="hy-hint">{t("admin.charges.note.hint")}</p>
      <Show when={config()}>
        {(c) => (
          <p class="hy-hint" data-testid="raise-config">
            {c().gst_registered ? t("admin.charge.raise.cfg", { rate: `${formatBasisPoints(c().gst_rate_bp)}%`, sac: c().sac }) : t("admin.charge.raise.nogst")}
          </p>
        )}
      </Show>
      <p class="hy-hint">{t("admin.charge.raise.books")}</p>
      <Show when={dup() && kind() === "period"}>
        <InlineAlert
          kind="warning"
          data-testid="raise-dup"
          actions={
            <Button data-testid="raise-dup-extra" onClick={() => setKind("extra")}>
              {t("admin.charge.raise.type.extra")}
            </Button>
          }
        >
          {t("admin.charge.raise.dup")}
        </InlineAlert>
      </Show>
    </FormDialog>
  );
}
