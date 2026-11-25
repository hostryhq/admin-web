import { createSignal, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, Card, InlineAlert, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { VerificationBadge } from "../../components/badges";
import { DescriptionList } from "../../components/common";
import { FormDialog } from "../../components/FormDialog";
import { TextArea } from "../../components/fields";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";
import { MIN_REASON } from "../StartSupportDialog";
import { VerifyDialog } from "../VerifyDialog";
import { registrationsVerified } from "./onboarding";
import { WizardFrame } from "./WizardFrame";
import type { components } from "../../generated";

type Registration = components["schemas"]["DirectoryRegistration"];

/**
 * AS03, wizard step 2: verify or reject the GSTIN, or do it later (A1-S01, A1-S04; P2D-12). Users
 * without `admin.registration.verify` see the step as "for a registration verifier" and no buttons
 * (AC 11); the next step is still reachable. An unregistered organisation has nothing to verify.
 */
export function GstinStep(): JSX.Element {
  return <WizardFrame current="gstin">{(facts, reload) => <Body org={() => facts().org} reload={reload} />}</WizardFrame>;
}

function Body(props: { org: () => components["schemas"]["OrganisationDetailView"]; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const can = () => hasPermission(state.session(), "admin.registration.verify");
  const [verifying, setVerifying] = createSignal<Registration | undefined>();
  const [rejecting, setRejecting] = createSignal<Registration | undefined>();
  const toPlan = () => navigate(orgPath(ROUTES.stepPlan, params.orgId));

  return (
    <>
      <h2 data-testid="step-title">{t("admin.verify.title")}</h2>
      <p class="hy-hint">{t("admin.verify.hint")}</p>
      <Show when={!can()}>
        <InlineAlert kind="info" data-testid="verify-forrole">
          {t("admin.verify.forrole")}
        </InlineAlert>
      </Show>
      <For each={props.org().registrations}>
        {(r) => (
          <Card title={r.legal_name}>
            <DescriptionList
              rows={[
                { label: t("admin.verify.regime"), value: t(`admin.create.regime.${r.regime}`) },
                ...(r.gstin ? [{ label: t("admin.verify.gstin"), value: <span class="hy-num">{r.gstin}</span>, testid: "verify-gstin" }] : []),
                { label: t("admin.verify.state"), value: <VerificationBadge state={r.verification_state} regime={r.regime} /> },
              ]}
            />
            <Show when={r.verification_state === "unverified" && r.regime !== "unregistered"}>
              <p class="hy-hint" data-testid="verify-unverified">
                {t("admin.verify.unverified")}
              </p>
              <Show when={can()}>
                <div class="hy-actions">
                  <Button variant="primary" data-testid={`verify-open-${r.id}`} onClick={() => setVerifying(r)}>
                    {t("admin.verify.verify")}
                  </Button>
                  <Button data-testid={`reject-open-${r.id}`} onClick={() => setRejecting(r)}>
                    {t("admin.verify.reject")}
                  </Button>
                </div>
              </Show>
            </Show>
          </Card>
        )}
      </For>
      <Show when={registrationsVerified(props.org())}>
        <InlineAlert kind="success" data-testid="verify-done">
          {t("admin.verify.done")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Show when={!registrationsVerified(props.org())}>
          <Button data-testid="verify-later" onClick={toPlan}>
            {t("admin.verify.later")}
          </Button>
        </Show>
        <Button variant="primary" data-testid="verify-continue" onClick={toPlan}>
          {t("admin.verify.continue")}
        </Button>
      </div>

      <Show when={verifying()}>
        {(reg) => (
          <VerifyDialog
            open
            organisationId={params.orgId}
            registration={reg()}
            onClose={() => setVerifying(undefined)}
            onDone={() => {
              setVerifying(undefined);
              props.reload();
            }}
          />
        )}
      </Show>
      <Show when={rejecting()}>
        {(reg) => (
          <RejectDialog
            organisationId={params.orgId}
            registration={reg()}
            onClose={() => setRejecting(undefined)}
            onDone={() => {
              setRejecting(undefined);
              props.reload();
            }}
          />
        )}
      </Show>
    </>
  );
}

function RejectDialog(props: { organisationId: string; registration: Registration; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [reason, setReason] = createSignal("");
  return (
    <FormDialog
      open
      title={t("admin.verify.reject")}
      submitLabel={t("admin.verify.reject")}
      danger
      valid={reason().trim().length >= MIN_REASON}
      onClose={props.onClose}
      data-testid="reject-registration"
      onSubmit={async (key) => {
        const r = await outcome(
          api.PUT("/v1/organisations/{organisation_id}/tax-registrations/{registration_id}/rejection", {
            params: { path: { organisation_id: props.organisationId, registration_id: props.registration.id }, header: mut(key) },
            body: { reason: reason().trim() },
          }),
        );
        if (!r.ok) return writeError(r.failure);
        toasts.show(t("admin.verify.rejected"));
        props.onDone();
        return undefined;
      }}
    >
      <p>{props.registration.legal_name}</p>
      <TextArea
        name="reason"
        label={`${t("admin.verify.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-autofocus
        data-testid="reject-registration-reason"
      />
    </FormDialog>
  );
}
