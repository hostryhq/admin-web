import { createSignal, Match, onSettled, Show, Switch, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, Card, Dialog, InlineAlert, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { CopyId, ErrorState, ist, SkeletonBlock, useWriteGuard } from "../components/common";
import { OrgStatusBadge } from "../components/badges";
import { ROUTES } from "../routes";
import { hasPermission, SessionContext } from "../session/session";
import { currentInvitation, IssueForm } from "./InvitationCard";
import { forgetCreation, recallCreation } from "./creationStore";

type Invitation = components["schemas"]["OwnerInvitation"];
type Shown = {
  id: string;
  name: string;
  status: components["schemas"]["OrganisationStatus"];
  state: "complete" | "incomplete";
  invitation: Invitation | undefined;
};

/**
 * Screen 8. Success is shown only when the organisation AND the owner invitation both exist
 * (AC 21, 79); an `incomplete` creation shows a warning and "Retry invitation", which asks for the
 * mobile number again and completes the same organisation (AC 28). The reminder that no message is
 * sent in A0 and that the owner must be phoned is always on the success panel (AC 82).
 */
export function CreationResult(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const canInvite = () => hasPermission(state.session(), "admin.owner_invite.manage");

  const [shown, setShown] = createSignal<Shown | undefined>();
  const [failed, setFailed] = createSignal(false);
  const [retryOpen, setRetryOpen] = createSignal(false);

  const fromServer = async () => {
    setFailed(false);
    const r = await outcome(api.GET("/v1/organisations/{organisation_id}", { params: { path: { organisation_id: params.orgId } } }));
    if (!r.ok) {
      setFailed(true);
      return;
    }
    const v = r.data;
    setShown({
      id: v.organisation.id,
      name: v.organisation.name,
      status: v.organisation.status,
      state: v.onboarding_state === "complete" ? "complete" : "incomplete",
      invitation: currentInvitation(v.owner_invitations),
    });
  };

  onSettled(() => {
    const seed = recallCreation(params.orgId);
    if (seed) {
      setShown({
        id: seed.created.organisation.id,
        name: seed.created.organisation.name,
        status: seed.created.organisation.status,
        state: seed.state,
        invitation: seed.owner_invitation,
      });
      return;
    }
    void fromServer();
  });

  const open = () => navigate(ROUTES.organisationDetail.path.replace(":orgId", params.orgId));
  const another = () => {
    forgetCreation(params.orgId);
    navigate(ROUTES.organisationNew.path);
  };

  return (
    <>
      <Show when={failed() && !shown()}>
        <h1 class="hy-visually-hidden" tabindex="-1" data-testid="page-title">
          {t("admin.orgs.created.title")}
        </h1>
        <ErrorState failure={undefined} onRetry={fromServer} data-testid="result-error" />
      </Show>
      <Show when={!shown() && !failed()}>
        <h1 class="hy-visually-hidden" tabindex="-1" data-testid="page-title">
          {t("admin.orgs.created.title")}
        </h1>
        <SkeletonBlock rows={3} />
      </Show>
      <Show when={shown()}>
        {(s) => (
          <Switch>
            <Match when={s().state === "complete"}>
              <Card data-testid="result-success">
                <div role="status" class="hy-stack">
                  <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
                    {t("admin.create.done.title")}
                  </h1>
                  <p>
                    <strong data-testid="result-name">{s().name}</strong> <CopyId id={s().id} data-testid="result-id" />
                  </p>
                  <p>
                    {t("admin.create.status")} <OrgStatusBadge status={s().status} />
                  </p>
                  <Show when={s().invitation}>
                    {(i) => (
                      <p data-testid="result-invite">
                        {t("admin.create.done.invite", { mobile: i().mobile_masked, time: ist(i().expires_at) })}
                      </p>
                    )}
                  </Show>
                  <p data-testid="result-tell">{t("admin.create.done.tell")}</p>
                  <p class="hy-hint" data-testid="result-nosms">
                    {t("admin.invite.nosms")}
                  </p>
                  <div class="hy-actions">
                    <Button variant="primary" data-autofocus data-testid="result-open" onClick={open}>
                      {t("admin.create.open")}
                    </Button>
                    <Button data-testid="result-another" onClick={another}>
                      {t("admin.create.another")}
                    </Button>
                  </div>
                </div>
              </Card>
            </Match>
            <Match when={s().state === "incomplete"}>
              <Card data-testid="result-incomplete">
                <div role="alert" class="hy-stack">
                  <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
                    {t("admin.create.partial.title")}
                  </h1>
                  <InlineAlert kind="warning">{t("admin.create.partial.body")}</InlineAlert>
                  <p>
                    <strong data-testid="result-name">{s().name}</strong> <CopyId id={s().id} data-testid="result-id" />
                  </p>
                  <div class="hy-actions">
                    <Show when={canInvite()}>
                      <Button variant="primary" disabled={guard.disabled()} title={guard.title()} data-autofocus data-testid="result-retry" onClick={() => setRetryOpen(true)}>
                        {t("admin.create.retry")}
                      </Button>
                    </Show>
                    <Button data-testid="result-open" onClick={open}>
                      {t("admin.create.open")}
                    </Button>
                  </div>
                </div>
              </Card>
            </Match>
          </Switch>
        )}
      </Show>
      <Dialog open={retryOpen()} title={t("admin.create.retry")} onClose={() => setRetryOpen(false)} data-testid="result-retry-dialog">
        <IssueForm
          organisationId={params.orgId}
          ownerName={shown()?.invitation?.owner_name ?? ""}
          onClose={() => setRetryOpen(false)}
          onDone={() => {
            setRetryOpen(false);
            forgetCreation(params.orgId);
            toasts.show(t("admin.invite.issued"));
            void fromServer();
          }}
        />
      </Dialog>
    </>
  );
}
