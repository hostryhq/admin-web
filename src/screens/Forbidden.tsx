import type { JSX } from "@solidjs/web";
import { Card, useI18n } from "@hostry/ui-kit";
import { HOME_PATH } from "../routes";

/** Shown for a direct URL the user has no permission for; says nothing about what exists there (flows section 6). */
export function Forbidden(): JSX.Element {
  const { t } = useI18n();
  return (
    <Card data-testid="forbidden">
      <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
        {t("admin.error.forbidden")}
      </h1>
      <a href={HOME_PATH} data-testid="forbidden-home">
        {t("admin.error.forbidden.back")}
      </a>
    </Card>
  );
}

export function NotFound(): JSX.Element {
  const { t } = useI18n();
  return (
    <Card data-testid="not-found">
      <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
        {t("admin.error.notfound")}
      </h1>
      <a href={HOME_PATH}>{t("admin.error.forbidden.back")}</a>
    </Card>
  );
}
