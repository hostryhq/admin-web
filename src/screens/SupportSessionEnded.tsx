import type { JSX } from "@solidjs/web";
import { useLocation } from "@solidjs/router";
import { Card, InlineAlert, useI18n } from "@hostry/ui-kit";
import { istTime } from "../components/common";
import { ROUTES } from "../routes";

/**
 * Screen 15. Shown after the user ends a session, it runs out, or a read is refused after expiry.
 * Nothing from the session is on the page: only the organisation name, how it ended and when (AC 56, 57).
 */
export function SupportSessionEnded(): JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const q = () => new URLSearchParams(location.search);
  const text = () => {
    const org = q().get("org") ?? "";
    const at = q().get("at");
    const time = at && !Number.isNaN(Date.parse(at)) ? istTime(at) : "";
    return q().get("how") === "user" ? t("admin.support.ended.byuser", { org, time }) : t("admin.support.ended.expired", { org, time });
  };
  return (
    <div class="hy-stack" data-testid="support-ended">
      <h1 tabindex="-1" data-testid="page-title">
        {t("admin.support.ended.title")}
      </h1>
      <Card>
        <InlineAlert kind="info" data-testid="support-ended-text">
          {text()}
        </InlineAlert>
        <p>
          <a class="hy-btn hy-btn--primary hy-linkbutton" href={ROUTES.organisations.path} data-autofocus data-testid="support-ended-back">
            {t("admin.support.ended.back")}
          </a>
        </p>
      </Card>
    </div>
  );
}
