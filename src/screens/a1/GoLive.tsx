import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { Button, StatusBadge, useI18n, type BadgeKind } from "@hostry/ui-kit";
import { fmtDate } from "../../components/dates";
import { ist } from "../../components/common";
import { orgPath, ROUTES } from "../../routes";
import { checklist, isLive, type CheckItem, type Facts, type ItemState } from "./onboarding";
import { WizardFrame } from "./WizardFrame";

const KIND: Record<ItemState, BadgeKind> = { done: "success", notyet: "warning", blocked: "danger", unknown: "neutral" };

/**
 * AS06: wizard step 4 and the organisation's Onboarding view. Read-only: facts and first-time dates
 * only, no amounts, names or trading counts (AC 8). Recomputed on every load and on Reload (AC 7);
 * the panel stores nothing. Trading is never blocked by this list.
 */
export function GoLive(): JSX.Element {
  return (
    <WizardFrame current="golive" withDevices>
      {(facts, reload) => <Body facts={facts} reload={reload} />}
    </WizardFrame>
  );
}

function when(i: CheckItem): string {
  if (!i.at) return "";
  return i.at.length > 10 ? ist(i.at, false) : fmtDate(i.at);
}

function Body(props: { facts: () => Facts; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const params = useParams<{ orgId: string }>();
  const items = () => checklist(props.facts());
  const live = () => isLive(items());
  return (
    <>
      <h2 data-testid="step-title">
        {t("admin.checklist.title")}{" "}
        <StatusBadge kind={live() ? "success" : "neutral"} label={t(live() ? "admin.checklist.live" : "admin.checklist.notlive")} data-testid="checklist-live" />
      </h2>
      <ul class="hy-list hy-checklist-list" data-testid="golive-list">
        <For each={items()}>
          {(i) => (
            <li class="hy-registration" data-testid={`golive-${i.id}`} data-state={i.state}>
              <StatusBadge kind={KIND[i.state]} label={t(`admin.checklist.state.${i.state}`)} data-testid={`golive-${i.id}-state`} />
              <span>
                {i.id} {t(`admin.board.item.${i.id}`)}
              </span>
              <Show when={i.informational}>
                <span class="hy-hint">{t("admin.checklist.info")}</span>
              </Show>
              <Show when={i.state === "done" && i.at}>
                <span class="hy-num">{when(i)}</span>
              </Show>
              <Show when={i.state === "blocked" && i.reason}>
                <span class="hy-hint" data-testid={`golive-${i.id}-reason`}>
                  {t(i.reason ?? "")}
                </span>
              </Show>
              <Show when={i.state === "unknown"}>
                <span class="hy-hint">{t("admin.checklist.unavailable")}</span>
              </Show>
              <Show when={i.id === "C3" && i.state === "notyet"}>
                <a href={orgPath(ROUTES.organisationDetail, params.orgId)} data-testid="golive-invite-link">
                  {t("admin.checklist.invite")}
                </a>
              </Show>
            </li>
          )}
        </For>
      </ul>
      <p class="hy-hint">{t("admin.checklist.footer")}</p>
      <div class="hy-actions">
        <a class="hy-btn hy-linkbutton" href={orgPath(ROUTES.organisationDetail, params.orgId)} data-testid="golive-org">
          {t("admin.orgs.detail.title")}
        </a>
        <Button data-testid="golive-reload" onClick={props.reload}>
          {t("admin.checklist.reload")}
        </Button>
      </div>
    </>
  );
}
