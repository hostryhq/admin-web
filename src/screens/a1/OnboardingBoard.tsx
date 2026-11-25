import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, DataTable, InlineAlert, PageHeader, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { outcome } from "../../api/outcome";
import { createPaged, createQuery } from "../../api/query";
import { Empty, ErrorState, ist, StaleTag } from "../../components/common";
import { daysBetween, todayIst } from "../../components/dates";
import { Select } from "../../components/fields";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type Summary = components["schemas"]["OrganisationSummary"];
type Item = "C2" | "C3" | "C4" | "unknown";

/**
 * AS01: organisations that are not live yet, oldest first (A1-S03, BR-A1-7). "Not live" is a trial
 * organisation: the first plan moves it to active (BR-A1-74). The first unmet item comes from what
 * the list and the unverified-registration filter already say, so no row costs an extra call; the
 * full checklist loads when the row is opened. Nothing is assigned to a person (BR-A1-8).
 */
export function OnboardingBoard(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canCreate = () => hasPermission(state.session(), "admin.org.create");
  const [filter, setFilter] = createSignal("");

  const paged = createPaged(
    () => "trial",
    (_k, cursor) => outcome(api.GET("/v1/organisations", { params: { query: { status: "trial", limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const unverified = createQuery(
    () => "unverified",
    () => outcome(api.GET("/v1/organisations", { params: { query: { has_unverified_registration: true, limit: 100 } } })),
  );
  const unverifiedIds = () => new Set((unverified.data()?.items ?? []).map((o) => o.id));
  const identityDown = () => paged.first.data()?.owner_status_available === false;

  const itemOf = (o: Summary): Item => {
    if (unverifiedIds().has(o.id)) return "C2";
    if (identityDown() || o.owner_status === "unknown") return "unknown";
    if (o.owner_status !== "accepted") return "C3";
    return "C4";
  };
  const today = todayIst();
  const rows = () =>
    paged
      .rows()
      .filter((o) => !filter() || itemOf(o) === filter())
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const columns: Column<Summary>[] = [
    { id: "org", header: t("admin.board.col.org"), cell: (o) => <span data-testid="board-org">{o.name}</span> },
    { id: "created", header: t("admin.board.col.created"), cell: (o) => <span class="hy-num">{ist(o.created_at, false)}</span> },
    { id: "age", header: t("admin.board.col.age"), numeric: true, cell: (o) => t("admin.board.days", { n: daysBetween(o.created_at.slice(0, 10), today) }) },
    {
      id: "item",
      header: t("admin.board.col.item"),
      cell: (o) => {
        const i = itemOf(o);
        return <span data-testid={`board-item-${i}`}>{i === "unknown" ? t("admin.board.unknown") : `${i} ${t(`admin.board.item.${i}`)}`}</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={t("admin.board.title")}
        actions={
          <>
            <a class="hy-btn hy-linkbutton" href={ROUTES.unverified.path} data-testid="board-unverified-link">
              {t("admin.queue.title")}
            </a>
            <Show when={canCreate()}>
              <a class="hy-btn hy-btn--primary hy-linkbutton" href={ROUTES.organisationNew.path} data-testid="board-new">
                {t("admin.orgs.new")}
              </a>
            </Show>
          </>
        }
      />
      <p class="hy-hint">{t("admin.board.sub")}</p>
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={identityDown()}>
        <InlineAlert kind="warning" data-testid="board-identity-down">
          {t("admin.orgs.identity.down")}
        </InlineAlert>
      </Show>
      <form class="hy-filterbar" onSubmit={(e: SubmitEvent) => e.preventDefault()}>
        <Select
          name="item"
          label={t("admin.board.col.item")}
          value={filter()}
          options={[{ value: "", label: t("admin.common.all") }, ...(["C2", "C3", "C4"] as const).map((i) => ({ value: i, label: `${i} ${t(`admin.board.item.${i}`)}` }))]}
          onChange={(e: Event) => setFilter((e.currentTarget as HTMLSelectElement).value)}
          data-testid="board-filter"
        />
      </form>
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="board-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.board.title")}
          columns={columns}
          rows={rows()}
          rowKey={(o) => o.id}
          loading={paged.first.loading() && !paged.first.data()}
          onOpen={(o) => navigate(orgPath(ROUTES.checklist, o.id))}
          empty={<Empty title={t("admin.board.empty")} data-testid="board-empty" />}
          data-testid="board-table"
        />
      </Show>
      <p class="hy-hint">{t("admin.board.noassign")}</p>
      <Show when={paged.hasMore()}>
        <p>
          <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="board-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
    </>
  );
}
