import { Card, PageHeader, useI18n } from "@hostry/ui-kit";
import type { JSX } from "@solidjs/web";
import type { RouteMeta } from "../routes";

/** Stand-in for a screen that is wired to its API in the next wave. Shows the screen number from the flows doc. */
export function Placeholder(props: { route: RouteMeta }): JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t(props.route.titleKey)} />
      <Card data-testid={`screen-${props.route.id}`}>
        <p>{t("admin.placeholder")}</p>
        <p class="hy-num">{t("admin.placeholder.screen", { n: props.route.screen })}</p>
      </Card>
    </>
  );
}
