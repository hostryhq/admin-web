import { createSignal, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Card, useI18n } from "@hostry/ui-kit";
import type { components } from "../generated";
import { DescriptionList, ist } from "../components/common";
import { VerificationBadge } from "../components/badges";
import { hasPermission, SessionContext } from "../session/session";
import { stateName } from "../data/states";
import { InvitationCard } from "./InvitationCard";
import { OrganisationFrame, type OrganisationView } from "./OrganisationFrame";
import { VerifyDialog } from "./VerifyDialog";

type Registration = components["schemas"]["DirectoryRegistration"];

/**
 * Screen 6, Overview tab: brands, outlets, registrations with their verification state, and the
 * owner invitation card. Members, settings and series are deliberately absent: they need a support
 * session (AC 20).
 */
export function OrganisationDetail(): JSX.Element {
  return (
    <OrganisationFrame tab="overview">{(view, reload) => <Overview view={view} reload={reload} />}</OrganisationFrame>
  );
}

function Overview(props: { view: () => OrganisationView; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const state = useContext(SessionContext);
  const canVerify = () => hasPermission(state.session(), "admin.registration.verify");
  const [verifying, setVerifying] = createSignal<Registration | undefined>();

  return (
    <div class="hy-stack" data-testid="org-overview">
      <Card title={t("admin.orgs.detail.overview")}>
        <DescriptionList
          rows={[
            { label: t("admin.orgs.detail.created"), value: ist(props.view().organisation.created_at), testid: "org-created" },
            {
              label: t("admin.orgs.detail.brands"),
              testid: "org-brands",
              value: (
                <ul class="hy-list">
                  <For each={props.view().brands}>
                    {(b) => (
                      <li>
                        {b.name}
                        {b.is_default ? ` (${t("admin.orgs.detail.default")})` : ""}
                      </li>
                    )}
                  </For>
                </ul>
              ),
            },
            {
              label: t("admin.orgs.detail.outlets"),
              testid: "org-outlets",
              value: (
                <ul class="hy-list">
                  <For each={props.view().outlets}>
                    {(o) => (
                      <li data-testid="org-outlet">
                        {o.name} - {t(`admin.create.kind.${o.kind}`)} - {stateName(o.state_code, t)}
                      </li>
                    )}
                  </For>
                </ul>
              ),
            },
          ]}
        />
      </Card>

      <Card title={t("admin.orgs.detail.registrations")}>
        <ul class="hy-list" data-testid="org-registrations">
          <For each={props.view().registrations}>
            {(r) => (
              <li class="hy-registration" data-testid="org-registration">
                <span>{r.legal_name}</span>
                <span>{t(`admin.create.regime.${r.regime}`)}</span>
                <Show when={r.gstin}>
                  <span class="hy-num" data-testid="org-gstin">
                    {r.gstin}
                  </span>
                </Show>
                <VerificationBadge state={r.verification_state} regime={r.regime} />
                <Show when={canVerify() && r.verification_state === "unverified" && r.regime !== "unregistered"}>
                  <Button data-testid="org-verify" onClick={() => setVerifying(r)}>
                    {t("admin.registration.verify")}
                  </Button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Card>

      <InvitationCard view={props.view} reload={props.reload} />
      <p class="hy-hint">{t("admin.orgs.detail.notshown")}</p>

      <Show when={verifying()}>
        {(reg) => (
          <VerifyDialog
            open
            organisationId={props.view().organisation.id}
            registration={reg()}
            onClose={() => setVerifying(undefined)}
            onDone={() => {
              setVerifying(undefined);
              props.reload();
            }}
          />
        )}
      </Show>
    </div>
  );
}
