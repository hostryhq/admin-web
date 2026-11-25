import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, Dialog, InlineAlert, Input, useI18n } from "@hostry/ui-kit";
import { toSupportInfo, useApi } from "../api/context";
import { mut } from "../api/headers";
import { outcome } from "../api/outcome";
import { useWriteGuard } from "../components/common";
import { Select, TextArea } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";
import { ROUTES } from "../routes";
import { SessionContext } from "../session/session";

export const TICKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
export const MIN_REASON = 10;
const DURATIONS = [15, 30, 45, 60] as const;

/**
 * Screen 13. Read-only support session: ticket reference, reason (10+ characters) and duration (max
 * 60 minutes). If the user already has a session the dialog offers to end it first (BR-47, AC 60);
 * the server also refuses a second (`support_session_active`).
 */
export function StartSupportDialog(props: {
  open: boolean;
  onClose: () => void;
  organisationId: string;
  organisationName: string;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} title={t("admin.support.start.title")} onClose={props.onClose} data-testid="support-start-dialog">
      <StartSupportForm {...props} />
    </Dialog>
  );
}

function StartSupportForm(props: { onClose: () => void; organisationId: string; organisationName: string }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();

  const [ticket, setTicket] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [duration, setDuration] = createSignal("30");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [conflict, setConflict] = createSignal(state.session()?.support !== undefined);
  const key = newIntentKey();

  const valid = () => TICKET_PATTERN.test(ticket()) && reason().trim().length >= MIN_REASON;
  const active = () => state.session()?.support;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.POST("/v1/support-sessions", {
        params: { header: mut(key) },
        body: {
          organisation_id: props.organisationId,
          ticket_reference: ticket(),
          reason: reason().trim(),
          duration_minutes: Number(duration()),
        },
      }),
    );
    setBusy(false);
    if (r.ok) {
      state.setSupport(toSupportInfo(r.data.session, props.organisationName));
      props.onClose();
      navigate(ROUTES.supportSession.path.replace(":orgId", props.organisationId).replace("/:tab?", ""));
      return;
    }
    if (r.failure.code === "support_session_active") setConflict(true);
    else setError(r.failure.status === 403 ? "admin.error.forbidden" : r.failure.status === 422 ? "admin.support.start.invalid" : "admin.error.generic");
  };

  const endCurrent = async () => {
    setBusy(true);
    const r = await outcome(api.DELETE("/v1/support-sessions/current", { params: { header: mut() } }));
    setBusy(false);
    if (!r.ok) {
      setError("admin.error.generic");
      return;
    }
    state.setSupport(undefined);
    setConflict(false);
  };

  return (
    <Show
      when={!conflict()}
      fallback={
        <div class="hy-stack" data-testid="support-active">
          <h3>{t("admin.support.active.title")}</h3>
          <p>{t("admin.support.active.body", { org: active()?.organisationName ?? t("admin.support.active.unknown") })}</p>
          <Show when={error()}>
            <InlineAlert kind="danger">{t(error() ?? "")}</InlineAlert>
          </Show>
          <div class="hy-actions">
            <Button data-testid="support-active-cancel" onClick={props.onClose}>
              {t("admin.common.cancel")}
            </Button>
            <Button variant="primary" disabled={busy() || guard.disabled()} data-autofocus data-testid="support-active-end" onClick={endCurrent}>
              {t("admin.support.active.end")}
            </Button>
          </div>
        </div>
      }
    >
      <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
        <p>{t("admin.support.start.org", { org: props.organisationName })}</p>
        <p class="hy-hint">{t("admin.support.start.warn")}</p>
        <Input
          name="ticket"
          required
          autocomplete="off"
          label={`${t("admin.support.start.ticket")} *`}
          value={ticket()}
          onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())}
          data-autofocus
          data-testid="support-ticket"
        />
        <TextArea
          name="reason"
          required
          label={`${t("admin.support.start.reason")} *`}
          value={reason()}
          counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
          onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
          data-testid="support-reason"
        />
        <Select
          name="duration"
          label={t("admin.support.start.duration")}
          options={DURATIONS.map((d) => ({ value: String(d), label: String(d) }))}
          value={duration()}
          onChange={(e: Event) => setDuration((e.currentTarget as HTMLSelectElement).value)}
          data-testid="support-duration"
        />
        <Show when={error()}>
          <InlineAlert kind="danger" data-testid="support-error">
            {t(error() ?? "")}
          </InlineAlert>
        </Show>
        <div class="hy-actions">
          <Button data-testid="support-cancel" onClick={props.onClose}>
            {t("admin.common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid() || busy() || guard.disabled()} title={guard.title()} data-testid="support-submit">
            {t("admin.support.start.submit")}
          </Button>
        </div>
      </form>
    </Show>
  );
}
