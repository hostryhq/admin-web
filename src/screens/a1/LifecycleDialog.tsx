import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { CheckRow, Input, InlineAlert, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { remainingLabel } from "../../components/remaining";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, TextArea } from "../../components/fields";
import type { components } from "../../generated";
import { MIN_REASON, TICKET_PATTERN } from "../StartSupportDialog";

type S = components["schemas"];
export type LifecycleAction = "suspend" | "reinstate" | "close";
const KIND = { suspend: "org_suspend", reinstate: "org_reinstate", close: "org_close" } as const;
const METHODS: S["RequesterVerification"][] = ["callback_to_registered_number", "owner_request_in_app", "other"];

/** Which lifecycle actions the organisation's status allows: suspend or close while open, reinstate while suspended, nothing once closed. */
export function allowedActions(status: S["OrganisationStatus"]): LifecycleAction[] {
  if (status === "closed") return [];
  if (status === "suspended") return ["reinstate", "close"];
  return ["suspend", "close"];
}

/**
 * AS22: request suspension, reinstatement or closure (A1-S17; AC 67 to 72). This only files the
 * request: a second platform admin approves it and approving executes it (ADR-0014 A1.3). With fewer
 * than two eligible users the dialog says so and offers no override. A day in progress blocks suspend
 * and close (`open_trading_day`), checked again at execution. Close needs the export-offered box.
 */
export function LifecycleDialog(props: {
  open: boolean;
  organisationId: string;
  organisationName: string;
  status: S["OrganisationStatus"];
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const actions = () => allowedActions(props.status);
  const [action, setAction] = createSignal<LifecycleAction>(actions()[0] ?? "suspend");
  const [ticket, setTicket] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [method, setMethod] = createSignal<S["RequesterVerification"]>("callback_to_registered_number");
  const [exportOffered, setExportOffered] = createSignal(false);
  const [blocked, setBlocked] = createSignal<string | undefined>();

  const valid = () =>
    actions().length > 0 &&
    TICKET_PATTERN.test(ticket()) &&
    reason().trim().length >= MIN_REASON &&
    (action() !== "close" || exportOffered());

  return (
    <FormDialog
      open={props.open}
      title={t(`admin.lifecycle.${action()}.title`, { org: props.organisationName })}
      submitLabel={t(`admin.lifecycle.submit.${action()}`)}
      danger={action() === "close"}
      valid={valid()}
      onClose={props.onClose}
      data-testid="lifecycle-dialog"
      onSubmit={async (key) => {
        setBlocked(undefined);
        const r = await outcome(
          api.POST("/v1/approvals", {
            params: { header: mut(key) },
            body: {
              kind: KIND[action()],
              organisation_id: props.organisationId,
              ticket_reference: ticket(),
              reason: reason().trim(),
              verification_method: method(),
            },
          }),
        );
        if (!r.ok) {
          if (r.failure.code === "open_trading_day") {
            setBlocked("admin.lifecycle.opentrading");
            return "admin.lifecycle.opentrading";
          }
          return writeError(r.failure, { second_approver_unavailable: "admin.lifecycle.noapprover" });
        }
        toasts.show(t("admin.lifecycle.pending", { t: remainingLabel(t, r.data.expires_at) }));
        props.onDone();
        return undefined;
      }}
    >
      <Show when={actions().length > 1}>
        <RadioGroup
          legend={t("admin.lifecycle.action")}
          name="action"
          value={action()}
          onChange={(v) => setAction(v as LifecycleAction)}
          options={actions().map((a) => ({ value: a, label: t(`admin.lifecycle.${a}`) }))}
          data-testid="lifecycle-action"
        />
      </Show>
      <p data-testid="lifecycle-body">{t(`admin.lifecycle.${action()}.body`)}</p>
      <Show when={action() !== "reinstate"}>
        <p class="hy-hint">{t("admin.lifecycle.devices")}</p>
      </Show>
      <Input
        name="ticket"
        required
        autocomplete="off"
        label={`${t("admin.lifecycle.ticket")} *`}
        value={ticket()}
        onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())}
        data-autofocus
        data-testid="lifecycle-ticket"
      />
      <RadioGroup
        legend={`${t("admin.revoke.method")} *`}
        name="method"
        value={method()}
        onChange={(v) => setMethod(v as S["RequesterVerification"])}
        options={METHODS.map((m) => ({ value: m, label: t(`admin.revoke.method.${m}`) }))}
        data-testid="lifecycle-method"
      />
      <TextArea
        name="reason"
        label={`${t("admin.lifecycle.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="lifecycle-reason"
      />
      <Show when={action() === "close"}>
        <CheckRow label={t("admin.lifecycle.close.export")} checked={exportOffered()} onChange={setExportOffered} data-testid="lifecycle-export" />
        <p class="hy-hint">{t("admin.lifecycle.close.noreopen")}</p>
      </Show>
      <Show when={blocked()}>
        <InlineAlert kind="warning" data-testid="lifecycle-blocked">
          {t("admin.lifecycle.opentrading")}
        </InlineAlert>
      </Show>
    </FormDialog>
  );
}
