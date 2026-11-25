import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Card, Dialog, InlineAlert, Input, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { InvitationBadge } from "../components/badges";
import { ist, useWriteGuard } from "../components/common";
import { formKeys, newIntentKey } from "../components/formkeys";
import { isIndianMobile, PhoneField } from "../components/phone";
import { hasPermission, SessionContext } from "../session/session";
import type { OrganisationView } from "./OrganisationFrame";

type Invitation = components["schemas"]["OwnerInvitation"];
export const EXTEND_DAYS = 14;

/** The invitation the card is about: the newest by creation time. */
export function currentInvitation(invitations: readonly Invitation[]): Invitation | undefined {
  return [...invitations].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

type Action = "extend" | "cancel" | "issue";

/**
 * Owner invitation card (screens 6 and 9). By status: pending offers Resend/extend and Cancel;
 * expired or cancelled with no owner offers Re-issue; accepted shows the date and no actions (AC 33);
 * an `incomplete` creation shows the warning and "Retry invitation" (AC 28). Reissuing asks for the
 * mobile number again: it is never kept or shown in full. No message is sent automatically (BR).
 */
export function InvitationCard(props: { view: () => OrganisationView; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const canManage = () => hasPermission(state.session(), "admin.owner_invite.manage");
  const [action, setAction] = createSignal<Action | undefined>();

  const inv = () => currentInvitation(props.view().owner_invitations);
  const ownerAccepted = () => props.view().owner_status === "accepted" || inv()?.status === "accepted";
  const incomplete = () => props.view().onboarding_state === "incomplete";
  const canIssue = () => canManage() && !ownerAccepted() && inv()?.status !== "pending";
  const issueLabel = () => (!inv() && incomplete() ? t("admin.invite.retry") : inv() ? t("admin.invite.reissue") : t("admin.invite.create"));
  const done = (msgKey: string) => {
    setAction(undefined);
    toasts.show(t(msgKey));
    props.reload();
  };

  return (
    <Card title={t("admin.invite.title")} data-testid="invite-card">
      <Show when={incomplete() && !inv()}>
        <InlineAlert kind="warning" data-testid="invite-incomplete">
          {t("admin.orgs.detail.incomplete")}
        </InlineAlert>
      </Show>
      <Show when={props.view().owner_status === "unknown"}>
        <InlineAlert kind="warning" data-testid="invite-unavailable">
          {t("admin.invite.unavailable")}
        </InlineAlert>
      </Show>
      <Show when={inv()}>
        {(i) => (
          <div class="hy-stack" data-testid="invite-details">
            <p>
              <InvitationBadge status={i().status} />{" "}
              <span class="hy-num" data-testid="invite-mobile">
                {i().mobile_masked}
              </span>
              <Show when={i().owner_name}> ({i().owner_name})</Show>
            </p>
            <Show when={i().status === "accepted"}>
              <p data-testid="invite-accepted">{t("admin.invite.accepted", { date: ist(i().accepted_at, false) })}</p>
            </Show>
            <Show when={i().status === "pending"}>
              <p class="hy-hint">{t("admin.invite.expires", { time: ist(i().expires_at) })}</p>
            </Show>
          </div>
        )}
      </Show>
      <Show when={!inv() && !incomplete()}>
        <p class="hy-hint" data-testid="invite-none">
          {t("admin.invite.none")}
        </p>
      </Show>

      <div class="hy-actions">
        <Show when={canManage() && inv()?.status === "pending"}>
          <Button disabled={guard.disabled()} title={guard.title()} data-testid="invite-extend" onClick={() => setAction("extend")}>
            {t("admin.invite.resend")}
          </Button>
          <Button disabled={guard.disabled()} title={guard.title()} data-testid="invite-cancel" onClick={() => setAction("cancel")}>
            {t("admin.invite.cancel")}
          </Button>
        </Show>
        <Show when={canIssue()}>
          <Button variant="primary" disabled={guard.disabled()} title={guard.title()} data-testid="invite-issue" onClick={() => setAction("issue")}>
            {issueLabel()}
          </Button>
        </Show>
      </div>

      <Dialog open={action() === "extend"} title={t("admin.invite.extend.title")} onClose={() => setAction(undefined)} data-testid="invite-extend-dialog">
        <ExtendForm organisationId={props.view().organisation.id} invitation={inv()} onClose={() => setAction(undefined)} onDone={() => done("admin.invite.extended")} />
      </Dialog>
      <Dialog open={action() === "cancel"} title={t("admin.invite.cancel.title")} onClose={() => setAction(undefined)} data-testid="invite-cancel-dialog">
        <CancelForm organisationId={props.view().organisation.id} invitation={inv()} onClose={() => setAction(undefined)} onDone={() => done("admin.invite.cancelled")} />
      </Dialog>
      <Dialog open={action() === "issue"} title={issueLabel()} onClose={() => setAction(undefined)} data-testid="invite-issue-dialog">
        <IssueForm
          organisationId={props.view().organisation.id}
          ownerName={inv()?.owner_name ?? ""}
          onClose={() => setAction(undefined)}
          onDone={() => done("admin.invite.issued")}
        />
      </Dialog>
    </Card>
  );
}

function ExtendForm(props: { organisationId: string; invitation: Invitation | undefined; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const key = newIntentKey();
  const newExpiry = () => ist(new Date(Date.now() + EXTEND_DAYS * 86_400_000).toISOString());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const inv = props.invitation;
    if (!inv || busy() || guard.disabled()) return;
    setBusy(true);
    const r = await outcome(
      api.POST("/v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/renewals", {
        params: { path: { organisation_id: props.organisationId, invitation_id: inv.id }, header: mut(key) },
      }),
    );
    setBusy(false);
    if (r.ok) props.onDone();
    else setError(r.failure.code === "invitation_not_pending" ? "admin.invite.notpending" : "admin.error.generic");
  };
  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys}>
      <p>{t("admin.invite.extend.body", { time: newExpiry() })}</p>
      <p class="hy-hint">{t("admin.invite.nosms")}</p>
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="invite-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-testid="invite-extend-close">
          {t("admin.common.close")}
        </Button>
        <Button type="submit" variant="primary" disabled={busy() || guard.disabled()} data-autofocus data-testid="invite-extend-submit">
          {t("admin.invite.extend.submit", { n: EXTEND_DAYS })}
        </Button>
      </div>
    </form>
  );
}

function CancelForm(props: { organisationId: string; invitation: Invitation | undefined; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const key = newIntentKey();

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const inv = props.invitation;
    if (!inv || busy() || guard.disabled()) return;
    setBusy(true);
    const r = await outcome(
      api.PUT("/v1/organisations/{organisation_id}/owner-invitations/{invitation_id}/cancellation", {
        params: { path: { organisation_id: props.organisationId, invitation_id: inv.id }, header: mut(key) },
      }),
    );
    setBusy(false);
    if (r.ok) props.onDone();
    else setError(r.failure.code === "invitation_not_pending" ? "admin.invite.notpending" : "admin.error.generic");
  };
  // Initial focus is the safe button (Keep), not the destructive one.
  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys}>
      <p>{t("admin.invite.cancel.body")}</p>
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="invite-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-autofocus data-testid="invite-cancel-keep">
          {t("admin.invite.cancel.keep")}
        </Button>
        <Button type="submit" variant="danger" disabled={busy() || guard.disabled()} data-testid="invite-cancel-submit">
          {t("admin.invite.cancel.submit")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Create, re-issue or retry the owner invitation. The mobile number is asked for again because the
 * system keeps and shows it masked only (AC 28, 80). The same idempotency key is kept for retries.
 */
export function IssueForm(props: { organisationId: string; ownerName: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [name, setName] = createSignal(props.ownerName);
  const [mobile, setMobile] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const key = newIntentKey();
  const valid = () => name().trim().length > 0 && isIndianMobile(mobile());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.POST("/v1/organisations/{organisation_id}/owner-invitations", {
        params: { path: { organisation_id: props.organisationId }, header: mut(key) },
        body: { name: name().trim(), mobile_e164: `+91${mobile()}` },
      }),
    );
    setBusy(false);
    if (r.ok) {
      props.onDone();
      return;
    }
    const c = r.failure.code;
    setError(c === "owner_exists" ? "admin.invite.owner_exists" : r.failure.status === 422 ? "admin.create.mobile.invalid" : "admin.error.generic");
  };
  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
      <Input
        name="owner-name"
        required
        label={`${t("admin.create.owner.name")} *`}
        value={name()}
        onInput={(e: InputEvent) => setName((e.currentTarget as HTMLInputElement).value)}
        data-autofocus
        data-testid="invite-name"
      />
      <PhoneField
        name="owner-mobile"
        required
        label={`${t("admin.create.owner.mobile")} *`}
        prefix="+91"
        value={mobile()}
        onValue={setMobile}
        data-testid="invite-mobile-input"
      />
      <p class="hy-hint">{t("admin.invite.nosms")}</p>
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="invite-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-testid="invite-issue-cancel">
          {t("admin.common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid() || busy() || guard.disabled()} data-testid="invite-issue-submit">
          {t("admin.invite.issue.submit")}
        </Button>
      </div>
    </form>
  );
}
