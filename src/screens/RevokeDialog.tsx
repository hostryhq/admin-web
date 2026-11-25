import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Dialog, InlineAlert, Input, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { ist, useWriteGuard } from "../components/common";
import { RadioGroup, TextArea } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";
import { ROUTES } from "../routes";
import { MIN_REASON, TICKET_PATTERN } from "./StartSupportDialog";

type Device = components["schemas"]["VendorDevice"];
type Method = components["schemas"]["RequesterVerification"];
const METHODS: Method[] = ["callback_to_registered_number", "owner_request_in_app", "other"];

/**
 * Screen 11. One confirmation: the submit button is the confirmation and is enabled only when the
 * ticket reference, verification method and reason (10+ characters; a note for "other") are valid
 * (AC 38). Enter in a field does not submit; Ctrl+Enter does. Over the quota the server answers
 * `vendor_approval_required` (AC 86, 87): the device stays active, the same request is filed as a
 * two-person approval (`fileVendorApproval`, as the contract describes) and the dialog says a second
 * Hostry person must approve it. Once approved, the requester repeats the revoke with the
 * `approval_id` (`approvalId` below, found by the devices screen).
 */
export function RevokeDialog(props: {
  open: boolean;
  organisationId: string;
  device: Device;
  outletName: string;
  /** An approved two-person approval of this user for this device: sent with the revoke. */
  approvalId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} title={t("admin.revoke.title")} onClose={props.onClose} data-testid="revoke-dialog">
      <RevokeForm {...props} />
    </Dialog>
  );
}

function RevokeForm(props: {
  organisationId: string;
  device: Device;
  outletName: string;
  approvalId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [ticket, setTicket] = createSignal("");
  const [method, setMethod] = createSignal<Method>("callback_to_registered_number");
  const [note, setNote] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [needsApproval, setNeedsApproval] = createSignal(false);
  const key = newIntentKey();

  const valid = () =>
    TICKET_PATTERN.test(ticket()) &&
    reason().trim().length >= MIN_REASON &&
    (method() !== "other" || note().trim().length >= MIN_REASON);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.PUT("/v1/organisations/{organisation_id}/devices/{device_id}/revocation", {
        params: { path: { organisation_id: props.organisationId, device_id: props.device.id }, header: mut(key) },
        body: {
          ticket_reference: ticket(),
          reason: reason().trim(),
          verification_method: method(),
          ...(method() === "other" ? { verification_note: note().trim() } : {}),
          confirm: true,
          ...(props.approvalId ? { approval_id: props.approvalId } : {}),
        },
      }),
    );
    setBusy(false);
    if (r.ok) {
      toasts.show(t(r.data.changed ? "admin.revoke.done" : "admin.revoke.already"));
      props.onDone();
      return;
    }
    const f = r.failure;
    if (f.code === "vendor_approval_required") {
      const filed = await outcome(
        api.POST("/v1/approvals", {
          params: { header: mut(key) },
          body: {
            kind: "device_revoke_over_quota",
            organisation_id: props.organisationId,
            subject_id: props.device.id,
            ticket_reference: ticket(),
            reason: reason().trim(),
            verification_method: method(),
          },
        }),
      );
      if (filed.ok) setNeedsApproval(true);
      else setError(filed.failure.code === "second_approver_unavailable" ? "admin.revoke.approval.unavailable" : "admin.error.generic");
    } else if (f.status === 404) setError("admin.revoke.notfound");
    else if (f.status === 403) setError("admin.error.forbidden");
    else if (f.status === 422) setError("admin.revoke.invalid");
    else setError(f.status === 503 ? "admin.error.upstream" : "admin.error.generic");
  };

  return (
    <Show
      when={!needsApproval()}
      fallback={
        <div class="hy-stack" data-testid="revoke-approval">
          <InlineAlert kind="warning">{t("admin.revoke.approval.needed")}</InlineAlert>
          <div class="hy-actions">
            <a class="hy-btn hy-linkbutton" href={ROUTES.approvals.path} data-testid="revoke-approval-link" onClick={props.onClose}>
              {t("admin.approvals.title")}
            </a>
            <Button variant="primary" data-autofocus data-testid="revoke-approval-close" onClick={props.onDone}>
              {t("admin.common.close")}
            </Button>
          </div>
        </div>
      }
    >
      <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
        <p data-testid="revoke-device">
          {t(`admin.devices.kind.${props.device.kind}`)} - {props.outletName} - {t("admin.revoke.registered", { date: ist(props.device.registered_at, false) })}
        </p>
        <p class="hy-hint">{t("admin.revoke.warn")}</p>
        <Show when={props.approvalId}>
          <InlineAlert kind="info" data-testid="revoke-approved">
            {t("admin.revoke.approved.note")}
          </InlineAlert>
        </Show>
        <Input
          name="ticket"
          required
          autocomplete="off"
          label={`${t("admin.revoke.ticket")} *`}
          value={ticket()}
          onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())}
          data-autofocus
          data-testid="revoke-ticket"
        />
        <RadioGroup
          legend={`${t("admin.revoke.method")} *`}
          name="method"
          value={method()}
          onChange={(v) => setMethod(v as Method)}
          options={METHODS.map((m) => ({ value: m, label: t(`admin.revoke.method.${m}`) }))}
          data-testid="revoke-method"
        />
        <Show when={method() === "other"}>
          <TextArea
            name="note"
            label={`${t("admin.revoke.method.note")} *`}
            value={note()}
            counter={t("admin.common.min.chars", { n: note().trim().length, min: MIN_REASON })}
            onInput={(e: InputEvent) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
            data-testid="revoke-note"
          />
        </Show>
        <TextArea
          name="reason"
          required
          label={`${t("admin.revoke.reason")} *`}
          value={reason()}
          counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
          onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid="revoke-reason"
        />
        <p class="hy-hint">{t("admin.revoke.audit.note")}</p>
        <Show when={error()}>
          <InlineAlert kind="danger" data-testid="revoke-error">
            {t(error() ?? "")}
          </InlineAlert>
        </Show>
        <div class="hy-actions">
          <Button onClick={props.onClose} data-testid="revoke-cancel">
            {t("admin.common.cancel")}
          </Button>
          <Button type="submit" variant="danger" disabled={!valid() || busy() || guard.disabled()} title={guard.title()} data-testid="revoke-submit">
            {t("admin.revoke.submit")}
          </Button>
        </div>
      </form>
    </Show>
  );
}
