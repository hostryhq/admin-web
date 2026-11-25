import { createEffect, createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, DataTable, InlineAlert, Input, PageHeader, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createQuery } from "../api/query";
import { Empty, ErrorState, ist, shortId, StaleTag } from "../components/common";
import { OrgStatusBadge, OwnerStatusBadge } from "../components/badges";
import { Select } from "../components/fields";
import { ROUTES } from "../routes";
import { hasPermission, SessionContext } from "../session/session";

type Summary = components["schemas"]["OrganisationSummary"];
export const PAGE_SIZE = 25;

const STATUSES = ["trial", "active", "suspended", "closed"] as const;

/**
 * Screen 5. Newest first, 25 per page with a "Load more" cursor (AC 14). Search submits on Enter and
 * replaces the list; the server matches name fragments, ids, and exact GSTIN or mobile only (AC 15,
 * 16). No full mobile number is ever on the page (AC 18). When identity is down the rows still load
 * and the owner column says "Unknown" with a notice (AC 19).
 */
export function OrganisationList(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canCreate = () => hasPermission(state.session(), "admin.org.create");

  const [text, setText] = createSignal("");
  const [applied, setApplied] = createSignal({ q: "", status: "" });
  const [more, setMore] = createSignal<Summary[]>([]);
  const [moreCursor, setMoreCursor] = createSignal<string | undefined>();
  const [moreBusy, setMoreBusy] = createSignal(false);
  const [moreFailed, setMoreFailed] = createSignal(false);

  const fetchPage = (q: string, status: string, cursor?: string) =>
    outcome(
      api.GET("/v1/organisations", {
        params: {
          query: {
            limit: PAGE_SIZE,
            ...(q ? { q } : {}),
            ...(status ? { status: status as (typeof STATUSES)[number] } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    );

  const first = createQuery(applied, (a) => fetchPage(a.q, a.status));

  // A new query or a reload starts again from the first page.
  createEffect(
    () => first.data(),
    (d) => {
      setMore([]);
      setMoreCursor(d?.next_cursor);
      setMoreFailed(false);
    },
  );

  const rows = () => [...(first.data()?.items ?? []), ...more()];
  const search = (e: SubmitEvent) => {
    e.preventDefault();
    setApplied({ q: text().trim(), status: applied().status });
  };
  const loadMore = async () => {
    const cursor = moreCursor();
    if (!cursor || moreBusy()) return;
    setMoreBusy(true);
    setMoreFailed(false);
    const r = await fetchPage(applied().q, applied().status, cursor);
    setMoreBusy(false);
    if (!r.ok) {
      setMoreFailed(true);
      return;
    }
    setMore((m) => [...m, ...r.data.items]);
    setMoreCursor(r.data.next_cursor);
  };

  const columns: Column<Summary>[] = [
    { id: "name", header: t("admin.orgs.col.name"), cell: (o) => <span data-testid="org-name">{o.name}</span> },
    { id: "id", header: t("admin.orgs.col.id"), cell: (o) => <code class="hy-num" title={o.id}>{shortId(o.id)}</code> },
    { id: "status", header: t("admin.orgs.col.status"), cell: (o) => <OrgStatusBadge status={o.status} /> },
    { id: "outlets", header: t("admin.orgs.col.outlets"), numeric: true, cell: (o) => o.outlet_count },
    {
      id: "owner",
      header: t("admin.orgs.col.owner"),
      cell: (o) => <OwnerStatusBadge status={first.data()?.owner_status_available === false ? "unknown" : o.owner_status} />,
    },
    { id: "created", header: t("admin.orgs.col.created"), cell: (o) => <span class="hy-num">{ist(o.created_at)}</span> },
  ];

  const newButton = () => (
    <Show when={canCreate()}>
      <a class="hy-btn hy-btn--primary hy-linkbutton" href={ROUTES.organisationNew.path} data-testid="orgs-new">
        {t("admin.orgs.new")}
      </a>
    </Show>
  );

  return (
    <>
      <PageHeader title={t("admin.orgs.title")} actions={newButton()} />
      <form class="hy-filterbar" role="search" onSubmit={search} data-testid="orgs-search-form">
        <Input
          name="q"
          type="search"
          label={t("admin.orgs.search.label")}
          placeholder={t("admin.orgs.search.placeholder")}
          value={text()}
          onInput={(e: InputEvent) => setText((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape") {
              setText("");
              setApplied({ q: "", status: applied().status });
            }
          }}
          data-shortcut="search"
          data-testid="orgs-search"
        />
        <Select
          name="status"
          label={t("admin.orgs.col.status")}
          options={[{ value: "", label: t("admin.common.all") }, ...STATUSES.map((s) => ({ value: s, label: t(`admin.orgs.status.${s}`) }))]}
          value={applied().status}
          onChange={(e: Event) => setApplied({ q: applied().q, status: (e.currentTarget as HTMLSelectElement).value })}
          data-testid="orgs-status"
        />
        <Button type="submit" data-testid="orgs-search-submit">
          {t("admin.orgs.search.submit")}
        </Button>
      </form>
      <p class="hy-hint">{t("admin.orgs.search.hint")}</p>
      <StaleTag at={first.loadedAt()} />

      <Show when={first.failure() && !first.data()}>
        <ErrorState failure={first.failure()} onRetry={first.reload} data-testid="orgs-error" />
      </Show>
      <Show when={first.data() && first.data()?.owner_status_available === false}>
        <InlineAlert kind="warning" data-testid="orgs-identity-down">
          {t("admin.orgs.identity.down")}
        </InlineAlert>
      </Show>
      <Show when={!first.failure() || first.data()}>
        <DataTable
          caption={t("admin.orgs.title")}
          columns={columns}
          rows={rows()}
          rowKey={(o) => o.id}
          loading={first.loading() && !first.data()}
          onOpen={(o) => navigate(ROUTES.organisationDetail.path.replace(":orgId", o.id))}
          empty={
            applied().q || applied().status ? (
              <Empty title={t("admin.orgs.nomatch")} data-testid="orgs-nomatch" />
            ) : (
              <Empty title={t("admin.orgs.empty")} data-testid="orgs-empty">
                {newButton()}
              </Empty>
            )
          }
          data-testid="orgs-table"
        />
      </Show>
      <Show when={moreFailed()}>
        <InlineAlert kind="danger" data-testid="orgs-more-error">
          {t("admin.error.generic")}
        </InlineAlert>
      </Show>
      <Show when={moreCursor()}>
        <p>
          <Button disabled={moreBusy()} onClick={loadMore} data-testid="orgs-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
      <Show when={rows().length > 0}>
        <p class="hy-hint hy-num" data-testid="orgs-count">
          {t("admin.orgs.showing", { n: rows().length })}
        </p>
      </Show>
    </>
  );
}
