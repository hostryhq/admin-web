import { Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, DataTable, PageHeader, useI18n, type Column } from "@hostry/ui-kit";
import { useNavigate } from "@solidjs/router";
import { useApi } from "../../api/context";
import { outcome } from "../../api/outcome";
import { createPaged } from "../../api/query";
import { OwnerStatusBadge } from "../../components/badges";
import { Empty, ErrorState, ist, StaleTag } from "../../components/common";
import { daysBetween, todayIst } from "../../components/dates";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type Summary = components["schemas"]["OrganisationSummary"];

/**
 * AS04: organisations with an unverified registration, oldest first (A1-S04, BR-A1-100). The act of
 * verifying or rejecting is the wizard's GSTIN step, so the control here is a link that is present
 * only for `admin.registration.verify`; support and billing read the list without it.
 */
export function UnverifiedQueue(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canVerify = () => hasPermission(state.session(), "admin.registration.verify");
  const paged = createPaged(
    () => "unverified",
    (_k, cursor) => outcome(api.GET("/v1/organisations", { params: { query: { has_unverified_registration: true, limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const today = todayIst();
  const rows = () => paged.rows().sort((a, b) => a.created_at.localeCompare(b.created_at));

  const columns = (): Column<Summary>[] => [
    { id: "org", header: t("admin.board.col.org"), cell: (o) => o.name },
    { id: "age", header: t("admin.queue.col.age"), numeric: true, cell: (o) => t("admin.board.days", { n: daysBetween(o.created_at.slice(0, 10), today) }) },
    { id: "created", header: t("admin.board.col.created"), cell: (o) => <span class="hy-num">{ist(o.created_at, false)}</span> },
    { id: "owner", header: t("admin.queue.col.owner"), cell: (o) => <OwnerStatusBadge status={o.owner_status} /> },
    ...(canVerify()
      ? [
          {
            id: "actions",
            header: t("admin.devices.col.actions"),
            cell: (o: Summary) => (
              <a class="hy-btn hy-linkbutton" href={orgPath(ROUTES.stepGstin, o.id)} data-testid={`queue-review-${o.id}`}>
                {t("admin.queue.review")}
              </a>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t("admin.queue.title")} />
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="queue-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.queue.title")}
          columns={columns()}
          rows={rows()}
          rowKey={(o) => o.id}
          loading={paged.first.loading() && !paged.first.data()}
          onOpen={(o) => navigate(orgPath(ROUTES.checklist, o.id))}
          empty={<Empty title={t("admin.queue.empty")} data-testid="queue-empty" />}
          data-testid="queue-table"
        />
      </Show>
      <Show when={paged.hasMore()}>
        <p>
          <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="queue-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
    </>
  );
}
