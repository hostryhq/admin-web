import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, DataTable, Dialog, InlineAlert, OtpField, PageHeader, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createQuery } from "../api/query";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Empty, ErrorState, ist, shortId, StaleTag, useWriteGuard } from "../components/common";
import { TextArea } from "../components/fields";
import { formKeys } from "../components/formkeys";
import { SessionContext } from "../session/session";
import { MIN_REASON } from "./StartSupportDialog";

type VendorApproval = components["schemas"]["VendorApproval"];
const KIND = "device_revoke_over_quota";

/**
 * Approvals queue (A0-S19, AC 90): pending device-revoke requests that need a second Hostry person
 * (two-person rule, ADR-0005 A2.3). Approve asks for a fresh TOTP code; Reject asks for a reason. The
 * list holds only this kind, the screen is hidden from users without `admin.device.revoke`, and the
 * requester's own request has no Approve (the server refuses it anyway). No override exists.
 *
 * Gap against AC 90: the contract's approval record has no `reason` (only ticket, verification method
 * and requester), so no reason column is shown until the API returns one.
 */
export function Approvals(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const [approving, setApproving] = createSignal<VendorApproval | undefined>();
  const [rejecting, setRejecting] = createSignal<VendorApproval | undefined>();

  const q = createQuery(
    () => "pending",
    () => outcome(api.GET("/v1/approvals", { params: { query: { state: "pending", limit: 100 } } })),
  );
  const rows = () => (q.data()?.items ?? []).filter((a) => a.kind === KIND && a.state === "pending");
  const isOwn = (a: VendorApproval) => a.requested_by === state.session()?.userId;
  const done = (msg: string) => {
    setApproving(undefined);
    setRejecting(undefined);
    toasts.show(t(msg));
    q.reload();
  };

  const columns: Column<VendorApproval>[] = [
    { id: "org", header: t("admin.approvals.col.org"), cell: (a) => (a.organisation_id ? <code class="hy-num" title={a.organisation_id}>{shortId(a.organisation_id)}</code> : "") },
    { id: "device", header: t("admin.approvals.col.device"), cell: (a) => (a.subject_id ? <code class="hy-num" title={a.subject_id}>{shortId(a.subject_id)}</code> : "") },
    { id: "ticket", header: t("admin.approvals.col.ticket"), cell: (a) => a.ticket_reference },
    { id: "method", header: t("admin.approvals.col.method"), cell: (a) => t(`admin.revoke.method.${a.verification_method}`) },
    { id: "requester", header: t("admin.approvals.col.requester"), cell: (a) => (isOwn(a) ? t("admin.audit.you") : shortId(a.requested_by)) },
    { id: "created", header: t("admin.approvals.col.created"), cell: (a) => <span class="hy-num">{ist(a.created_at)}</span> },
    {
      id: "actions",
      header: t("admin.devices.col.actions"),
      cell: (a) => (
        <span class="hy-actions">
          <Show when={!isOwn(a)}>
            <Button variant="primary" disabled={guard.disabled()} title={guard.title()} data-testid={`approval-approve-${a.id}`} onClick={() => setApproving(a)}>
              {t("admin.approvals.approve")}
            </Button>
          </Show>
          <Button disabled={guard.disabled()} title={guard.title()} data-testid={`approval-reject-${a.id}`} onClick={() => setRejecting(a)}>
            {t("admin.approvals.reject")}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("admin.approvals.title")} />
      <p class="hy-hint">{t("admin.approvals.intro")}</p>
      <StaleTag at={q.loadedAt()} />
      <Show when={q.failure() && !q.data()}>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="approvals-error" />
      </Show>
      <Show when={!q.failure() || q.data()}>
        <DataTable
          caption={t("admin.approvals.title")}
          columns={columns}
          rows={rows()}
          rowKey={(a) => a.id}
          loading={q.loading() && !q.data()}
          empty={<Empty title={t("admin.approvals.empty")} data-testid="approvals-empty" />}
          data-testid="approvals-table"
        />
      </Show>

      <Dialog open={approving() !== undefined} title={t("admin.approvals.approve")} onClose={() => setApproving(undefined)} data-testid="approve-dialog">
        <ApproveForm
          approval={approving()}
          onClose={() => setApproving(undefined)}
          run={async (code) => {
            const a = approving();
            if (!a) return undefined;
            const r = await outcome(
              api.PUT("/v1/approvals/{approval_id}/decision", { params: { path: { approval_id: a.id }, header: mut() }, body: { totp_code: code } }),
            );
            if (r.ok) {
              done("admin.approvals.approved");
              return undefined;
            }
            return r.failure.code === "second_approver_unavailable" ? "admin.approvals.error.unavailable" : r.failure.status === 503 ? "admin.error.upstream" : "admin.approvals.error.refused";
          }}
        />
      </Dialog>
      <Show when={rejecting()}>
        {(a) => (
          <RejectDialog
            onClose={() => setRejecting(undefined)}
            run={async (reason) => {
              const r = await outcome(
                api.PUT("/v1/approvals/{approval_id}/cancellation", { params: { path: { approval_id: a().id }, header: mut() }, body: { reason } }),
              );
              if (r.ok) {
                done("admin.approvals.rejected");
                return undefined;
              }
              return r.failure.status === 503 ? "admin.error.upstream" : "admin.approvals.error.refused";
            }}
          />
        )}
      </Show>
    </>
  );
}

function ApproveForm(props: { approval: VendorApproval | undefined; onClose: () => void; run: (code: string) => Promise<string | undefined> }): JSX.Element {
  const { t } = useI18n();
  const guard = useWriteGuard();
  const [code, setCode] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const valid = () => /^[0-9]{6}$/.test(code());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    const err = await props.run(code());
    setBusy(false);
    if (err) {
      setError(err);
      setCode("");
    }
  };
  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
      <p>{t("admin.approvals.approve.body", { ticket: props.approval?.ticket_reference ?? "" })}</p>
      <OtpField
        name="code"
        required
        label={t("admin.approvals.totp")}
        value={code()}
        onInput={(e: InputEvent) => setCode((e.currentTarget as HTMLInputElement).value)}
        data-autofocus
        data-testid="approve-code"
      />
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="approve-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-testid="approve-cancel">
          {t("admin.common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid() || busy() || guard.disabled()} data-testid="approve-submit">
          {t("admin.approvals.approve")}
        </Button>
      </div>
    </form>
  );
}

function RejectDialog(props: { onClose: () => void; run: (reason: string) => Promise<string | undefined> }): JSX.Element {
  const { t } = useI18n();
  const [reason, setReason] = createSignal("");
  return (
    <ConfirmDialog
      open
      title={t("admin.approvals.reject")}
      body={t("admin.approvals.reject.body")}
      confirmLabel={t("admin.approvals.reject")}
      danger
      onClose={props.onClose}
      run={() => (reason().trim().length < MIN_REASON ? Promise.resolve("admin.approvals.reason.short") : props.run(reason().trim()))}
      data-testid="reject-dialog"
    >
      <TextArea
        name="reason"
        label={`${t("admin.revoke.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="reject-reason"
      />
    </ConfirmDialog>
  );
}
