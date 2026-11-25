import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Card, DataTable, InlineAlert, Input, OneTimeReveal, PageHeader, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createPaged } from "../../api/query";
import { Empty, ErrorState, ist, shortId, StaleTag } from "../../components/common";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, TextArea } from "../../components/fields";
import { remainingLabel, remainingText } from "../../components/remaining";
import { isIndianMobile, PhoneField } from "../../components/phone";
import type { components } from "../../generated";
import { hasPermission, SessionContext } from "../../session/session";
import { MIN_REASON, TICKET_PATTERN } from "../StartSupportDialog";

type S = components["schemas"];
type Approval = S["VendorApproval"];
type CodeKind = "sign_in_code" | "owner_recovery";
const METHODS: S["RequesterVerification"][] = ["callback_to_registered_number", "owner_request_in_app", "other"];
/** Problem codes the service may use while the function is switched off (BR-A1-102 to 104). */
const OFF_CODES = new Set(["feature_disabled", "function_switched_off", "switched_off", "not_enabled"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AS24: sign-in codes and owner number recovery (A1-S23, S24, Should, behind switches; AC 92 to 96).
 * A sign-in code is split in two halves, one per vendor user: the requester sees characters 1 to 4 once
 * after the second user approves (approving is in Approvals, which shows the approver's own half). A half
 * is shown only by `OneTimeReveal`: it leaves the DOM after "I wrote it down" and is never in storage,
 * the URL or the console (AC 96). Recovery waits 24 hours and either vendor user may cancel it during
 * the delay. While a function is switched off the page says so (AC 93).
 */
export function SignInCodes(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const [filing, setFiling] = createSignal<CodeKind | undefined>();
  const [off, setOff] = createSignal(false);
  const [reveal, setReveal] = createSignal<string | undefined>();
  const [cancelling, setCancelling] = createSignal<Approval | undefined>();

  const paged = createPaged(
    () => "codes",
    (_k, cursor) => outcome(api.GET("/v1/approvals", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const mine = () => paged.rows().filter((a) => (a.kind === "sign_in_code" || a.kind === "owner_recovery") && a.requested_by === state.session()?.userId);

  const claim = async (a: Approval) => {
    const r = await outcome(api.POST("/v1/approvals/{approval_id}/code-half-claims", { params: { path: { approval_id: a.id }, header: mut() } }));
    if (!r.ok) {
      toasts.show(t(r.failure.status === 409 ? "admin.signin.half.gone" : writeError(r.failure)));
      return;
    }
    setReveal(r.data.half);
  };

  const columns: Column<Approval>[] = [
    { id: "kind", header: t("admin.approvals.col.kind"), cell: (a) => t(`admin.approvals.kind.${a.kind}`) },
    { id: "org", header: t("admin.approvals.col.item"), cell: (a) => a.subject ?? (a.organisation_id ? shortId(a.organisation_id) : "") },
    { id: "ticket", header: t("admin.approvals.col.ticket"), cell: (a) => a.ticket_reference },
    { id: "state", header: t("admin.approvals.col.state"), cell: (a) => <span data-testid={`code-state-${a.id}`}>{t(`admin.signin.status.${statusOf(a)}`)}</span> },
    {
      id: "time",
      header: t("admin.approvals.col.expires"),
      cell: (a) =>
        a.kind === "owner_recovery" && a.state === "approved" && a.completes_at
          ? t("admin.recovery.countdown", { t: remainingLabel(t, a.completes_at) })
          : a.state === "pending"
            ? remainingLabel(t, a.expires_at)
            : "",
    },
    {
      id: "actions",
      header: t("admin.devices.col.actions"),
      cell: (a) => (
        <span class="hy-actions">
          <Show when={a.kind === "sign_in_code" && a.state === "approved"}>
            <Button variant="primary" data-testid={`code-half-${a.id}`} onClick={() => void claim(a)}>
              {t("admin.signin.half.show")}
            </Button>
          </Show>
          <Show when={a.kind === "owner_recovery" && (a.state === "approved" || a.state === "pending") && can("admin.recovery.create")}>
            <Button data-testid={`recovery-cancel-${a.id}`} onClick={() => setCancelling(a)}>
              {t("admin.recovery.cancel")}
            </Button>
          </Show>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("admin.codes.title")} />
      <Show when={off()}>
        <InlineAlert kind="info" data-testid="codes-off">
          {t("admin.switch.off")}
        </InlineAlert>
      </Show>
      <Show when={reveal()}>
        <Card title={t("admin.signin.half.a")}>
          <OneTimeReveal label={t("admin.signin.half.a")} secret={reveal() ?? ""} onDone={() => setReveal(undefined)} data-testid="code-reveal" />
          <p class="hy-hint">{t("admin.signin.half.once")}</p>
        </Card>
      </Show>
      <div class="hy-actions">
        <Show when={can("admin.signin_code.create")}>
          <Button variant="primary" data-testid="codes-new-signin" onClick={() => setFiling("sign_in_code")}>
            {t("admin.signin.req.title")}
          </Button>
        </Show>
        <Show when={can("admin.recovery.create")}>
          <Button data-testid="codes-new-recovery" onClick={() => setFiling("owner_recovery")}>
            {t("admin.recovery.title")}
          </Button>
        </Show>
      </div>
      <p class="hy-hint">{t("admin.recovery.after.cancel")}</p>
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="codes-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.codes.title")}
          columns={columns}
          rows={mine()}
          rowKey={(a) => a.id}
          loading={paged.first.loading() && !paged.first.data()}
          empty={<Empty title={t("admin.codes.empty")} data-testid="codes-empty" />}
          data-testid="codes-table"
        />
      </Show>
      <Show when={filing()}>
        {(kind) => (
          <FileDialog
            kind={kind()}
            onClose={() => setFiling(undefined)}
            onOff={() => {
              setFiling(undefined);
              setOff(true);
            }}
            onDone={() => {
              setFiling(undefined);
              paged.first.reload();
            }}
          />
        )}
      </Show>
      <Show when={cancelling()}>
        {(a) => (
          <CancelRecovery
            approval={a()}
            onClose={() => setCancelling(undefined)}
            onDone={() => {
              setCancelling(undefined);
              paged.first.reload();
            }}
          />
        )}
      </Show>
    </>
  );
}

/** Requested, approved, delivered to the owner (done), or expired/cancelled. */
function statusOf(a: Approval): "requested" | "approved" | "delivered" | "expired" {
  if (a.state === "completed") return "delivered";
  if (a.state === "approved") return "approved";
  if (a.state === "pending" && !remainingText(a.expires_at).expired) return "requested";
  return "expired";
}

function FileDialog(props: { kind: CodeKind; onClose: () => void; onOff: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [org, setOrg] = createSignal("");
  const [ticket, setTicket] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [method, setMethod] = createSignal<S["RequesterVerification"]>("callback_to_registered_number");
  const [mobile, setMobile] = createSignal("");
  const valid = () =>
    UUID.test(org().trim()) &&
    TICKET_PATTERN.test(ticket()) &&
    reason().trim().length >= MIN_REASON &&
    (props.kind === "sign_in_code" || isIndianMobile(mobile()));
  return (
    <FormDialog
      open
      title={t(props.kind === "sign_in_code" ? "admin.signin.req.title" : "admin.recovery.title")}
      submitLabel={t("admin.signin.req.submit")}
      valid={valid()}
      onClose={props.onClose}
      data-testid="codes-dialog"
      onSubmit={async (key) => {
        const r = await outcome(
          api.POST("/v1/approvals", {
            params: { header: mut(key) },
            body: {
              kind: props.kind,
              organisation_id: org().trim(),
              ticket_reference: ticket(),
              reason: reason().trim(),
              verification_method: method(),
              ...(props.kind === "owner_recovery" ? { new_mobile_e164: `+91${mobile()}` } : {}),
            },
          }),
        );
        if (!r.ok) {
          if (r.failure.code && OFF_CODES.has(r.failure.code)) {
            props.onOff();
            return undefined;
          }
          return writeError(r.failure, { second_approver_unavailable: "admin.approvals.error.unavailable" });
        }
        toasts.show(t("admin.codes.requested"));
        props.onDone();
        return undefined;
      }}
    >
      <Input
        name="organisation"
        label={`${t("admin.codes.org")} *`}
        value={org()}
        autocomplete="off"
        onInput={(e: InputEvent) => setOrg((e.currentTarget as HTMLInputElement).value)}
        data-autofocus
        data-testid="codes-org"
      />
      <Input name="ticket" label={`${t("admin.lifecycle.ticket")} *`} value={ticket()} autocomplete="off" onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())} data-testid="codes-ticket" />
      <Show when={props.kind === "owner_recovery"}>
        <PhoneField name="mobile" label={`${t("admin.recovery.newmobile")} *`} prefix={t("admin.create.mobile.prefix")} value={mobile()} onValue={setMobile} data-testid="codes-mobile" />
      </Show>
      <RadioGroup
        legend={`${t("admin.revoke.method")} *`}
        name="method"
        value={method()}
        onChange={(v) => setMethod(v as S["RequesterVerification"])}
        options={METHODS.map((m) => ({ value: m, label: t(`admin.revoke.method.${m}`) }))}
        data-testid="codes-method"
      />
      <TextArea
        name="reason"
        label={`${t("admin.lifecycle.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="codes-reason"
      />
    </FormDialog>
  );
}

function CancelRecovery(props: { approval: Approval; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [reason, setReason] = createSignal("");
  return (
    <FormDialog
      open
      title={t("admin.recovery.cancel")}
      submitLabel={t("admin.recovery.cancel")}
      danger
      valid={reason().trim().length >= MIN_REASON}
      onClose={props.onClose}
      data-testid="recovery-cancel-dialog"
      onSubmit={async (key) => {
        const r = await outcome(api.PUT("/v1/approvals/{approval_id}/cancellation", { params: { path: { approval_id: props.approval.id }, header: mut(key) }, body: { reason: reason().trim() } }));
        if (!r.ok) return writeError(r.failure);
        toasts.show(t("admin.approvals.cancelled"));
        props.onDone();
        return undefined;
      }}
    >
      <p class="hy-hint">{ist(props.approval.created_at)}</p>
      <TextArea
        name="reason"
        label={`${t("admin.revoke.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-autofocus
        data-testid="recovery-cancel-reason"
      />
    </FormDialog>
  );
}
