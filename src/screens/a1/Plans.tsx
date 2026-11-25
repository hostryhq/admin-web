import { Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, DataTable, PageHeader, formatMoney, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { outcome } from "../../api/outcome";
import { createPaged } from "../../api/query";
import { Empty, ErrorState, StaleTag } from "../../components/common";
import { PlanStateBadge } from "../../components/ledgerBadges";
import { planName } from "../../components/plans";
import type { components } from "../../generated";
import { ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type S = components["schemas"];
type Row = { plan: S["Plan"]; version: S["PlanVersion"] };

const price = (v: S["PlanVersion"], cycle: "monthly" | "annual"): string => {
  const p = v.prices.find((x) => x.cycle === cycle);
  return p ? formatMoney(p.list_price.amount_paise) : "-";
};

/**
 * AS07: every plan version with its state and list prices (A1-S05, S06; AC 15, 16, 18, 19, 20, 106).
 * Without `admin.plan.manage` the table has no buttons. Seeded versions are drafts and the page says
 * a draft cannot be assigned until a platform admin activates it. The contract has no subscription
 * count per version, so that column is not shown (the "on retired versions" work list covers it).
 */
export function Plans(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canManage = () => hasPermission(state.session(), "admin.plan.manage");
  const paged = createPaged(
    () => "plans",
    (_k, cursor) => outcome(api.GET("/v1/plans", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const rows = (): Row[] => paged.rows().flatMap((plan) => [...plan.versions].sort((a, b) => b.version - a.version).map((version) => ({ plan, version })));

  const columns: Column<Row>[] = [
    { id: "plan", header: t("admin.plans.col.plan"), cell: (r) => planName(t, r.plan) },
    { id: "version", header: t("admin.plans.col.version"), numeric: true, cell: (r) => `v${r.version.version}` },
    { id: "state", header: t("admin.plans.col.state"), cell: (r) => <PlanStateBadge state={r.version.state} /> },
    { id: "monthly", header: t("admin.plans.col.monthly"), numeric: true, cell: (r) => price(r.version, "monthly") },
    { id: "annual", header: t("admin.plans.col.annual"), numeric: true, cell: (r) => price(r.version, "annual") },
  ];

  return (
    <>
      <PageHeader
        title={t("admin.plans.title")}
        actions={
          <>
            <a class="hy-btn hy-linkbutton" href={ROUTES.billingConfig.path} data-testid="plans-billcfg">
              {t("admin.billcfg.title")}
            </a>
            <Show when={canManage()}>
              <a class="hy-btn hy-btn--primary hy-linkbutton" href={ROUTES.planNew.path} data-testid="plans-new">
                {t("admin.plans.new")}
              </a>
            </Show>
          </>
        }
      />
      <p class="hy-hint">{t("admin.plans.exgst")}</p>
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="plans-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.plans.title")}
          columns={columns}
          rows={rows()}
          rowKey={(r) => `${r.plan.key}:${r.version.version}`}
          loading={paged.first.loading() && !paged.first.data()}
          onOpen={(r) => navigate(ROUTES.planVersion.path.replace(":planKey", r.plan.key).replace(":version", String(r.version.version)))}
          empty={<Empty title={t("admin.plans.empty")} data-testid="plans-empty" />}
          data-testid="plans-table"
        />
      </Show>
      <Show when={rows().some((r) => r.version.state === "draft")}>
        <p class="hy-hint" data-testid="plans-draftnote">
          {t("admin.plans.draftnote")}
        </p>
      </Show>
      <Show when={paged.hasMore()}>
        <p>
          <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="plans-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
    </>
  );
}
