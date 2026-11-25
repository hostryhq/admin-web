import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { DateField, Input, InlineAlert, MoneyField, formatMoney, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { todayIst } from "../../components/dates";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, TextArea } from "../../components/fields";
import type { components } from "../../generated";
import { MIN_REASON } from "../StartSupportDialog";

type S = components["schemas"];
const METHODS = ["upi", "bank_transfer", "cash", "cheque"] as const;

/**
 * AS13: record a payment received by hand (A1-S11; AC 45 to 49, 51, 53, 54; P2A-7). Only the four
 * methods exist, there is no gateway option (AC 51). The amount fills with the outstanding amount and
 * the "after this" line is plain subtraction against it; whether a shortfall inside the tolerance
 * counts as paid is the service's call and is stated, not decided, here. More than outstanding is
 * refused inline (AC 48); a reference already on another payment warns and still saves (AC 46, 49).
 */
export function PaymentDialog(props: {
  organisationId: string;
  charge: S["Charge"];
  payments: S["LedgerPayment"][];
  /** The payment tolerance in force, paise; undefined when not loaded. */
  tolerancePaise: number | undefined;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const outstanding = props.charge.outstanding.amount_paise;
  const [amount, setAmount] = createSignal<number | undefined>(outstanding);
  const [method, setMethod] = createSignal<S["PaymentMethod"]>("upi");
  const [ref, setRef] = createSignal("");
  const [date, setDate] = createSignal(todayIst());
  const over = () => (amount() ?? 0) > outstanding;
  const duplicate = () => ref().trim() !== "" && props.payments.some((p) => p.reference === ref().trim() && p.reversal_of === undefined);
  const after = () => outstanding - (amount() ?? 0);
  const valid = () => amount() !== undefined && amount() !== 0 && !over() && date() !== "" && date() <= todayIst() && ref().length <= 40;

  return (
    <FormDialog
      open
      title={t("admin.payment.title")}
      submitLabel={t("admin.payment.submit")}
      valid={valid()}
      onClose={props.onClose}
      data-testid="payment-dialog"
      onSubmit={async (key) => {
        const r = await outcome(
          api.POST("/v1/organisations/{organisation_id}/charges/{charge_id}/payments", {
            params: { path: { organisation_id: props.organisationId, charge_id: props.charge.id }, header: mut(key) },
            body: {
              amount: { amount_paise: amount() ?? 0, currency: "INR" },
              method: method(),
              ...(ref().trim() ? { reference: ref().trim() } : {}),
              received_on: date(),
            },
          }),
        );
        if (!r.ok) return writeError(r.failure, { overpayment: "admin.payment.over" });
        toasts.show(t("admin.payment.recorded"));
        props.onDone();
        return undefined;
      }}
    >
      <p data-testid="payment-outstanding">
        {t("admin.payment.outstanding")}: <span class="hy-num">{formatMoney(outstanding)}</span>
      </p>
      <MoneyField
        label={t("admin.payment.amount")}
        valuePaise={amount()}
        onChange={setAmount}
        error={over() ? t("admin.payment.over") : undefined}
        data-testid="payment-amount"
      />
      <RadioGroup
        legend={t("admin.payment.method")}
        name="method"
        value={method()}
        onChange={(v) => setMethod(v as S["PaymentMethod"])}
        options={METHODS.map((m) => ({ value: m, label: t(`admin.payment.method.${m}`) }))}
        data-testid="payment-method"
      />
      <Input
        name="reference"
        label={t("admin.payment.ref")}
        value={ref()}
        maxlength={40}
        autocomplete="off"
        onInput={(e: InputEvent) => setRef((e.currentTarget as HTMLInputElement).value)}
        data-testid="payment-ref"
      />
      <p class="hy-hint">{t("admin.payment.ref.hint")}</p>
      <DateField label={t("admin.payment.date")} value={date()} max={todayIst()} onChange={setDate} data-testid="payment-date" />
      <Show when={amount() !== undefined && !over()}>
        <p data-testid="payment-after">
          {t("admin.payment.after", { amount: formatMoney(Math.max(0, after())) })}
          <Show when={props.tolerancePaise !== undefined && after() > 0}>
            {" "}
            <span class="hy-hint" data-testid="payment-tolerance">
              {t("admin.payment.tolerance", { amount: formatMoney(props.tolerancePaise ?? 0) })}
            </span>
          </Show>
        </p>
      </Show>
      <Show when={duplicate()}>
        <InlineAlert kind="info" data-testid="payment-dupref">
          {t("admin.payment.dupref")}
        </InlineAlert>
      </Show>
    </FormDialog>
  );
}

export type AdjustKind = "waive" | "cancel" | "reverse";

/**
 * AS14: waive a charge, cancel it, or reverse a payment (A1-S12; AC 35, 50). Platform admins only.
 * Each adds a new row with the reason; nothing is edited or deleted (AC 34). Initial focus is the
 * reason; Enter does not submit, Ctrl+Enter does. The credit-note number from the books is optional and
 * is kept with the reason, because the contract has one reason field.
 */
export function AdjustDialog(props: {
  kind: AdjustKind;
  organisationId: string;
  chargeId: string;
  paymentId?: string;
  /** Already formatted, for the reverse title ("Reverse payment ₹2,475.64 (UPI, 25 Nov)"). */
  subject?: string;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [reason, setReason] = createSignal("");
  const [books, setBooks] = createSignal("");
  const fullReason = () => (books().trim() ? `${reason().trim()} (${t("admin.adjust.books.tag")}: ${books().trim()})` : reason().trim());

  return (
    <FormDialog
      open
      title={props.kind === "reverse" ? `${t("admin.adjust.reverse.title")} ${props.subject ?? ""}`.trim() : t(`admin.adjust.${props.kind}.title`)}
      submitLabel={t(`admin.adjust.submit.${props.kind}`)}
      danger
      valid={reason().trim().length >= MIN_REASON}
      onClose={props.onClose}
      data-testid="adjust-dialog"
      onSubmit={async (key) => {
        const base = { path: { organisation_id: props.organisationId, charge_id: props.chargeId } };
        const body = { reason: fullReason() };
        const r =
          props.kind === "waive"
            ? await outcome(api.POST("/v1/organisations/{organisation_id}/charges/{charge_id}/waiver", { params: { ...base, header: mut(key) }, body }))
            : props.kind === "cancel"
              ? await outcome(api.POST("/v1/organisations/{organisation_id}/charges/{charge_id}/cancellation", { params: { ...base, header: mut(key) }, body }))
              : await outcome(
                  api.POST("/v1/organisations/{organisation_id}/charges/{charge_id}/payments/{payment_id}/reversal", {
                    params: { path: { ...base.path, payment_id: props.paymentId ?? "" }, header: mut(key) },
                    body,
                  }),
                );
        if (!r.ok) return writeError(r.failure);
        toasts.show(t(`admin.adjust.done.${props.kind}`));
        props.onDone();
        return undefined;
      }}
    >
      <p data-testid="adjust-body">{t(`admin.adjust.${props.kind}.body`)}</p>
      <TextArea
        name="reason"
        label={`${t("admin.adjust.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-autofocus
        data-testid="adjust-reason"
      />
      <Show when={props.kind !== "waive"}>
        <Input
          name="books"
          label={t("admin.adjust.books")}
          value={books()}
          autocomplete="off"
          onInput={(e: InputEvent) => setBooks((e.currentTarget as HTMLInputElement).value)}
          data-testid="adjust-books"
        />
      </Show>
    </FormDialog>
  );
}
