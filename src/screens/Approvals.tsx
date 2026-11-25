import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, DataTable, InlineAlert, OneTimeReveal, OtpField, PageHeader, Panel, Tabs, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { writeError } from "../api/errors";
import { mut } from "../api/headers";
import { outcome } from "../api/outcome";
import { createPaged } from "../api/query";
import { Empty, ErrorState, ist, shortId, StaleTag, useWriteGuard } from "../components/common";
import { ApprovalStateBadge } from "../components/ledgerBadges";
import { TextArea } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";
import { remainingText } from "../components/remaining";
import { APPROVE_PERMISSION } from "../session/permissions";
import { hasPermission, SessionContext } from "../session/session";
import { MIN_REASON } from "./StartSupportDialog";
import { awaitsExecution, isExecuting, notExecutedKey, retryExecution, type Approval } from "./a1/approvalExec";

type Tab = "pending" | "mine" | "history";

/**
 * AS21: approvals (A1-S22; AC 68 to 72, 76, 91, 95; ADR-0014 A1.3). One queue for every approval kind:
 * a user sees only the kinds whose approve permission they hold (AC 91). The review panel shows what the
 * request would do in words (`subject`, the reason, ticket and who asked) so an approver never signs an
 * opaque request (security M8). The requester sees their own request with a countdown and no Approve
 * (absent, not greyed). Approving an executing kind executes it: the row then reads Done, or "Approved,
 * not executed" with the reason when a guard refused (open trading day, lead time), and the approver
 * can try again until it lapses. No grant ever reaches the browser. There is no override.
 *
 * Device revoke over the daily limit completes AT approval (P2C-1): approving revokes the device, and
 * nothing is repeated afterwards.
 */
export function Approvals(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const me = () => state.session()?.userId;
  const can = (p: string) => hasPermission(state.session(), p);
  const [tab, setTab] = createSignal<Tab>("pending");
  const [open, setOpen] = createSignal<Approval | undefined>();

  const paged = createPaged(
    () => "approvals",
    (_k, cursor) => outcome(api.GET("/v1/approvals", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const mayApprove = (a: Approval) => can("admin.approval.decide") && can(APPROVE_PERMISSION[a.kind]);
  const isMine = (a: Approval) => a.requested_by === me();
  const live = (a: Approval) => a.state === "pending" && !remainingText(a.expires_at).expired;
  const needsMe = (a: Approval) => (live(a) && !isMine(a) && mayApprove(a)) || (awaitsExecution(a) && a.approved_by === me());
  const rows = (): Approval[] => {
    const all = paged.rows();
    if (tab() === "mine") return all.filter(isMine);
    if (tab() === "history") return all.filter((a) => !live(a) && !awaitsExecution(a));
    return all.filter(needsMe);
  };
  const pendingCount = () => paged.rows().filter(needsMe).length;

  const done = (msg: string) => {
    setOpen(undefined);
    toasts.show(t(msg));
    paged.first.reload();
  };

  const columns: Column<Approval>[] = [
    { id: "kind", header: t("admin.approvals.col.kind"), cell: (a) => t(`admin.approvals.kind.${a.kind}`) },
    {
      id: "item",
      header: t("admin.approvals.col.item"),
      cell: (a) => (
        <span data-testid={`approval-item-${a.id}`}>
          {a.subject ?? (a.organisation_id ? shortId(a.organisation_id) : "")}
          <Show when={a.kind.startsWith("org_")}>
            {" "}
            <span class="hy-hint">{t("admin.approvals.shownowner")}</span>
          </Show>
        </span>
      ),
    },
    { id: "requester", header: t("admin.approvals.col.requester"), cell: (a) => (isMine(a) ? t("admin.audit.you") : shortId(a.requested_by)) },
    { id: "ticket", header: t("admin.approvals.col.ticket"), cell: (a) => a.ticket_reference },
    { id: "state", header: t("admin.approvals.col.state"), cell: (a) => <ApprovalStateBadge state={a.state} executable={isExecuting(a)} /> },
    { id: "expires", header: t("admin.approvals.col.expires"), cell: (a) => (a.state === "pending" ? <Countdown until={a.expires_at} /> : "") },
    {
      id: "actions",
      header: t("admin.devices.col.actions"),
      cell: (a) => (
        <Button variant="primary" data-testid={`approval-review-${a.id}`} onClick={() => setOpen(a)}>
          {t("admin.approvals.review")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t("admin.approvals.title")} />
      <StaleTag at={paged.first.loadedAt()} />
      <Tabs
        label={t("admin.approvals.title")}
        tabs={[
          { id: "pending", label: `${t("admin.approvals.tab.pending")} (${pendingCount()})`, "data-testid": "approvals-tab-pending" },
          { id: "mine", label: t("admin.approvals.tab.mine"), "data-testid": "approvals-tab-mine" },
          { id: "history", label: t("admin.approvals.tab.history"), "data-testid": "approvals-tab-history" },
        ]}
        selected={tab()}
        onSelect={(id) => setTab(id as Tab)}
      >
        <Show when={paged.first.failure() && !paged.first.data()}>
          <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="approvals-error" />
        </Show>
        <Show when={!paged.first.failure() || paged.first.data()}>
          <DataTable
            caption={t("admin.approvals.title")}
            columns={columns}
            rows={rows()}
            rowKey={(a) => a.id}
            loading={paged.first.loading() && !paged.first.data()}
            onOpen={(a) => setOpen(a)}
            empty={<Empty title={t("admin.approvals.empty")} data-testid="approvals-empty" />}
            data-testid="approvals-table"
          />
        </Show>
        <Show when={paged.hasMore()}>
          <p>
            <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="approvals-more">
              {t("admin.common.more")}
            </Button>
          </p>
        </Show>
      </Tabs>
      <Show when={open()}>
        {(a) => (
          <Panel title={t(`admin.approvals.kind.${a().kind}`)} open onClose={() => setOpen(undefined)} data-testid="approval-panel">
            <Review approval={a()} mine={isMine(a())} mayApprove={mayApprove(a())} canCancel={can("admin.approval.decide")} guardDisabled={guard.disabled()} onDone={done} />
          </Panel>
        )}
      </Show>
    </>
  );
}

function Countdown(props: { until: string }): JSX.Element {
  const { t } = useI18n();
  const r = () => remainingText(props.until);
  const left = () => (r().h > 0 ? t("admin.approvals.remaining.hm", { h: r().h, m: r().min }) : t("admin.approvals.remaining.m", { m: r().min }));
  return (
    <span class="hy-num" data-testid="approval-countdown">
      {r().expired ? t("admin.approvals.expired") : t("admin.approvals.expires", { t: left() })}
    </span>
  );
}

/** The review panel: what the request is, then approve (fresh code) / reject, or retry / cancel. */
function Review(props: {
  approval: Approval;
  mine: boolean;
  mayApprove: boolean;
  canCancel: boolean;
  guardDisabled: boolean;
  onDone: (msg: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const a = () => props.approval;
  const [code, setCode] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [rejecting, setRejecting] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [notExecuted, setNotExecuted] = createSignal<string | undefined>();
  const [half, setHalf] = createSignal<string | undefined>();
  const key = newIntentKey();
  const young = () => {
    const from = state.session()?.canApproveFrom;
    return from !== undefined && Date.parse(from) > Date.now();
  };
  const pending = () => a().state === "pending" && !remainingText(a().expires_at).expired;
  const canApprove = () => pending() && !props.mine && props.mayApprove && !young();
  // The approver who just saw a guard refuse (or whose earlier approval waits) may repeat the named operation.
  const canRetry = () => notExecuted() !== undefined || (awaitsExecution(a()) && a().approved_by === state.session()?.userId);
  const validCode = () => /^[0-9]{6}$/.test(code());
  const disabled = () => busy() || props.guardDisabled;
  const reasonOk = () => reason().trim().length >= MIN_REASON;

  const approve = async (e: SubmitEvent) => {
    e.preventDefault();
    if (disabled() || !validCode()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(api.PUT("/v1/approvals/{approval_id}/decision", { params: { path: { approval_id: a().id }, header: mut(key) }, body: { totp_code: code() } }));
    setBusy(false);
    if (!r.ok) {
      setCode("");
      const f = r.failure;
      setError(f.network || f.status === 503 ? writeError(f) : f.code === "second_approver_unavailable" ? "admin.approvals.error.unavailable" : "admin.approvals.error.refused");
      return;
    }
    if (r.data.code_half) {
      setHalf(r.data.code_half.half);
      return;
    }
    if (r.data.execution?.state === "refused") {
      setNotExecuted(notExecutedKey({}, r.data.execution.code));
      return;
    }
    props.onDone(a().kind === "device_revoke_over_quota" ? "admin.approvals.approved" : isExecuting(a()) ? "admin.approvals.done" : "admin.approvals.approved.plain");
  };

  const retry = async () => {
    if (disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await retryExecution(api, a(), key);
    setBusy(false);
    if (!r.ok) {
      setNotExecuted(notExecutedKey(r.failure));
      return;
    }
    props.onDone("admin.approvals.done");
  };

  const reject = async () => {
    if (disabled() || !reasonOk()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(api.PUT("/v1/approvals/{approval_id}/cancellation", { params: { path: { approval_id: a().id }, header: mut(key) }, body: { reason: reason().trim() } }));
    setBusy(false);
    if (!r.ok) {
      setError(writeError(r.failure));
      return;
    }
    props.onDone(props.mine ? "admin.approvals.cancelled" : "admin.approvals.rejected");
  };

  return (
    <div class="hy-stack" data-testid="approval-review">
      <dl class="hy-dl">
        <dt>{t("admin.approvals.summary")}</dt>
        <dd data-testid="approval-summary">{a().subject ?? t("admin.approvals.nosummary")}</dd>
        <Show when={a().reason}>
          <dt>{t("admin.approvals.reason")}</dt>
          <dd data-testid="approval-reason">{a().reason}</dd>
        </Show>
        <dt>{t("admin.approvals.col.ticket")}</dt>
        <dd data-testid="approval-ticket">{a().ticket_reference}</dd>
        <dt>{t("admin.approvals.col.method")}</dt>
        <dd>{t(`admin.revoke.method.${a().verification_method}`)}</dd>
        <dt>{t("admin.approvals.col.requester")}</dt>
        <dd>{props.mine ? t("admin.audit.you") : shortId(a().requested_by)}</dd>
        <dt>{t("admin.approvals.requested")}</dt>
        <dd class="hy-num">{ist(a().created_at)}</dd>
        <Show when={a().state === "pending"}>
          <dt>{t("admin.approvals.col.expires")}</dt>
          <dd>
            <Countdown until={a().expires_at} />
          </dd>
        </Show>
      </dl>
      <Show when={a().state !== "pending" && !awaitsExecution(a())}>
        <p data-testid="approval-final">{t(`admin.approvals.final.${a().state}`)}</p>
      </Show>
      <Show when={notExecuted() || awaitsExecution(a())}>
        <InlineAlert kind="warning" data-testid="approval-notexecuted">
          {t("admin.approvals.notexecuted", { reason: t(notExecuted() ?? "admin.approvals.reason.unknown") })}
        </InlineAlert>
      </Show>
      <Show when={pending() && props.mine}>
        <p class="hy-hint" data-testid="approval-own">
          {t("admin.approvals.own")}
        </p>
      </Show>
      <Show when={pending() && !props.mine && props.mayApprove && young()}>
        <p class="hy-hint" data-testid="approval-tooyoung">
          {t("admin.approvals.tooyoung")}
        </p>
      </Show>
      <Show when={half()}>
        <OneTimeReveal label={t("admin.signin.half.b")} secret={half() ?? ""} onDone={() => props.onDone("admin.approvals.approved.plain")} data-testid="approval-half" />
      </Show>
      <Show when={canApprove() && !half()}>
        <form class="hy-stack" method="post" onSubmit={approve} onKeyDown={formKeys} novalidate data-testid="approval-form">
          <OtpField
            name="code"
            required
            label={t("admin.approvals.totp")}
            value={code()}
            onInput={(e: InputEvent) => setCode((e.currentTarget as HTMLInputElement).value)}
            data-autofocus
            data-testid="approval-totp"
          />
          <Show when={rejecting()}>
            <TextArea
              name="reason"
              label={`${t("admin.revoke.reason")} *`}
              value={reason()}
              counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
              onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
              data-testid="approval-reject-reason"
            />
          </Show>
          <div class="hy-actions">
            <Show
              when={rejecting()}
              fallback={
                <Button data-testid="approval-reject" onClick={() => setRejecting(true)}>
                  {t("admin.approvals.reject")}
                </Button>
              }
            >
              <Button variant="danger" disabled={disabled() || !reasonOk()} data-testid="approval-reject-confirm" onClick={() => void reject()}>
                {t("admin.approvals.reject")}
              </Button>
            </Show>
            <Button type="submit" variant="primary" disabled={!validCode() || disabled()} data-testid="approval-approve">
              {t("admin.approvals.approve")}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={canRetry()}>
        <Button variant="primary" disabled={disabled()} data-testid="approval-retry" onClick={() => void retry()}>
          {t("admin.approvals.retry")}
        </Button>
      </Show>
      <Show when={pending() && props.mine && props.canCancel}>
        <Show
          when={rejecting()}
          fallback={
            <Button data-testid="approval-cancel" onClick={() => setRejecting(true)}>
              {t("admin.approvals.cancel")}
            </Button>
          }
        >
          <TextArea
            name="reason"
            label={`${t("admin.revoke.reason")} *`}
            value={reason()}
            counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
            onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
            data-testid="approval-cancel-reason"
          />
          <Button variant="danger" disabled={disabled() || !reasonOk()} data-testid="approval-cancel-confirm" onClick={() => void reject()}>
            {t("admin.approvals.cancel")}
          </Button>
        </Show>
      </Show>
      <Show when={error()}>
        <InlineAlert kind={error() === "admin.write.unknown" ? "warning" : "danger"} data-testid="approval-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
    </div>
  );
}
