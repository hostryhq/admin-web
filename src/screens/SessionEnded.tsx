import type { JSX } from "@solidjs/web";
import { useLocation } from "@solidjs/router";
import { Card, InlineAlert, useI18n } from "@hostry/ui-kit";
import { DEFAULT_IDLE_EXPIRE_MS } from "../shell/idle";
import { ROUTES } from "../routes";

/** Screen 3. The reason text is generic for anything that is not idle or the 12-hour limit (flows section 3). */
export function SessionEnded(): JSX.Element {
  const { t } = useI18n();
  const location = useLocation();
  const text = () => {
    const reason = new URLSearchParams(location.search).get("reason");
    if (reason === "idle") return t("admin.session.ended.idle", { n: DEFAULT_IDLE_EXPIRE_MS / 60_000 });
    if (reason === "limit") return t("admin.session.ended.limit", { n: 12 });
    return t("admin.session.ended.generic");
  };
  return (
    <Card data-testid="session-ended-card">
      <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
        {t("admin.session.title")}
      </h1>
      <InlineAlert kind="info" data-testid="session-ended-reason">
        {text()}
      </InlineAlert>
      <p>
        <a class="hy-btn hy-btn--primary hy-linkbutton" href={ROUTES.signin.path} data-autofocus data-testid="session-ended-signin">
          {t("admin.signin.again")}
        </a>
      </p>
    </Card>
  );
}
