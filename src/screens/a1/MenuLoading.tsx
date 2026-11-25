import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { Button, Input, InlineAlert, PageHeader, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { toSupportInfo } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { useWriteGuard } from "../../components/common";
import { Select, TextArea } from "../../components/fields";
import { formKeys, newIntentKey } from "../../components/formkeys";
import { orgPath, ROUTES } from "../../routes";
import { SessionContext } from "../../session/session";
import { MIN_REASON, TICKET_PATTERN } from "../StartSupportDialog";

const DURATIONS = [15, 30, 45, 60] as const;

/**
 * AS23: menu loading in an act-mode session (A1-S19, Should, behind a switch; AC 83 to 86). Requests
 * an act session for one organisation with a ticket, a reason and a duration of at most 60 minutes.
 * Identity answers `mode_not_supported` while the switch is off (until the security review signs
 * `catalog.import`, ADR-0014 A1.3 item 6), and the page then shows only the disabled notice and no
 * controls (AC 83). The contract has no owner-code or menu-import operation yet, so beyond starting the
 * session this screen offers nothing; when those operations exist the import preview belongs here.
 */
export function MenuLoading(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const org = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}", { params: { path: { organisation_id: id } } })),
  );
  const [ticket, setTicket] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [minutes, setMinutes] = createSignal("30");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [off, setOff] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  const key = newIntentKey();
  const valid = () => TICKET_PATTERN.test(ticket()) && reason().trim().length >= MIN_REASON;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || (guard.disabled() && error() !== "admin.write.unknown")) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.POST("/v1/support-sessions", {
        params: { header: mut(key) },
        body: { organisation_id: params.orgId, ticket_reference: ticket(), reason: reason().trim(), duration_minutes: Number(minutes()), mode: "act" },
      }),
    );
    setBusy(false);
    if (!r.ok) {
      if (r.failure.code === "mode_not_supported") setOff(true);
      else setError(writeError(r.failure, { support_session_conflict: "admin.support.start.conflict" }));
      return;
    }
    state.setSupport(toSupportInfo(r.data.session, org.data()?.organisation.name));
    toasts.show(t("admin.act.started"));
    setStarted(true);
  };

  return (
    <>
      <p>
        <a href={orgPath(ROUTES.organisationDetail, params.orgId)} data-testid="act-back">
          {t("admin.orgs.detail.back.org")}
        </a>
      </p>
      <PageHeader title={t("admin.act.title", { org: org.data()?.organisation.name ?? "" })} />
      <Show when={off()}>
        <InlineAlert kind="info" data-testid="act-disabled">
          {t("admin.act.disabled")}
        </InlineAlert>
      </Show>
      <Show when={started()}>
        <InlineAlert kind="success" data-testid="act-started">
          {t("admin.act.started")}
        </InlineAlert>
      </Show>
      <Show when={!off() && !started()}>
        <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate data-testid="act-form">
          <Input
            name="ticket"
            required
            autocomplete="off"
            label={`${t("admin.act.ticket")} *`}
            value={ticket()}
            onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())}
            data-autofocus
            data-testid="act-ticket"
          />
          <TextArea
            name="reason"
            label={`${t("admin.act.reason")} *`}
            value={reason()}
            counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
            onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
            data-testid="act-reason"
          />
          <Select
            name="duration"
            label={t("admin.act.duration")}
            value={minutes()}
            options={DURATIONS.map((m) => ({ value: String(m), label: String(m) }))}
            onChange={(e: Event) => setMinutes((e.currentTarget as HTMLSelectElement).value)}
            data-testid="act-duration"
          />
          <p class="hy-hint">{t("admin.act.only")}</p>
          <Show when={error()}>
            <InlineAlert kind="danger" data-testid="act-error">
              {t(error() ?? "")}
            </InlineAlert>
          </Show>
          <div class="hy-actions">
            <Button type="submit" variant="primary" disabled={!valid() || busy() || (guard.disabled() && error() !== "admin.write.unknown")} title={guard.title()} data-testid="act-request">
              {t("admin.act.request")}
            </Button>
          </div>
        </form>
      </Show>
    </>
  );
}
