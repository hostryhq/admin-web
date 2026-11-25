import { createEffect, createSignal, onSettled, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Icon, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { outcome } from "../api/outcome";
import { ROUTES } from "../routes";
import { SessionContext } from "../session/session";
import { ENDS_SOON_MS, formatRemaining, useSupportActions } from "./support";

/**
 * Fixed banner on every screen while this user has a support session (screen 14, BR-47): the
 * organisation, "Read-only", a live countdown to the server's end time, "Ends soon" in the last
 * five minutes, a link back to the session and an End session button. At zero the session is over
 * and the user goes to screen 15. Uses the support warning colours (`.hy-supportbanner`).
 */
export function SupportBanner(props: { now?: () => number }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const actions = useSupportActions();
  const clock = props.now ?? Date.now;
  const [now, setNow] = createSignal(clock());
  const [busy, setBusy] = createSignal(false);

  const support = () => state.session()?.support;
  const remaining = () => {
    const s = support();
    return s ? Date.parse(s.endsAt) - now() : 0;
  };

  onSettled(() => {
    const id = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(id);
  });

  // The countdown reaching zero ends the session on screen.
  createEffect(
    () => (support() !== undefined && remaining() <= 0 ? support()?.id : undefined),
    (id) => {
      if (id) actions.expired();
    },
  );

  // After a page reload the organisation name is unknown: read it from the directory (not an audited read).
  createEffect(
    () => {
      const s = support();
      return s && !s.organisationName ? s.organisationId : undefined;
    },
    (orgId) => {
      if (!orgId) return;
      void outcome(api.GET("/v1/organisations/{organisation_id}", { params: { path: { organisation_id: orgId } } })).then((r) => {
        const s = support();
        if (r.ok && s && s.organisationId === orgId) state.setSupport({ ...s, organisationName: r.data.organisation.name });
      });
    },
  );

  const end = async () => {
    if (busy()) return;
    setBusy(true);
    await actions.end();
    setBusy(false);
  };

  return (
    <Show when={support()}>
      {(s) => (
        <div class="hy-supportbanner" role="region" aria-label={t("admin.support.banner.label")} data-testid="support-banner">
          <Icon name="info" />
          <strong>{t("admin.support.banner.label")}</strong>
          <span data-testid="support-banner-org">{s().organisationName ?? ""}</span>
          <span data-testid="support-banner-readonly">{t("admin.support.banner.readonly")}</span>
          <span class="hy-num" data-testid="support-banner-remaining">
            {t("admin.support.banner.remaining", { time: formatRemaining(remaining()) })}
          </span>
          <Show when={remaining() <= ENDS_SOON_MS}>
            <strong data-testid="support-banner-soon">{t("admin.support.banner.soon")}</strong>
          </Show>
          <a href={ROUTES.supportSession.path.replace(":orgId", s().organisationId).replace("/:tab?", "")} data-testid="support-banner-back">
            {t("admin.support.back")}
          </a>
          <Button disabled={busy()} data-testid="support-banner-end" onClick={end}>
            {t("admin.support.banner.end")}
          </Button>
        </div>
      )}
    </Show>
  );
}
