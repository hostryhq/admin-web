import { createSignal, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Input, InlineAlert, PageHeader, StatusBadge, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createPaged, createQuery } from "../api/query";
import { Empty, ErrorState, ist, shortId, SkeletonBlock, StaleTag } from "../components/common";
import { hasPermission, SessionContext } from "../session/session";

type Entry = components["schemas"]["VendorAuditEntry"];
export const AUDIT_PAGE = 25;

/** Today's date in IST as `YYYY-MM-DD`, the default of both date filters (flows screen 12). */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** IST calendar day boundaries as UTC instants for the API. */
export function istDayStart(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}
export function istDayEnd(day: string): string {
  return new Date(`${day}T23:59:59.999+05:30`).toISOString();
}

/** A support session is one row; its reads are listed under it, not as separate rows (AC 50). */
const isSessionStart = (e: Entry) => e.support_session_id !== undefined && /session\.start/.test(e.action);
const isSessionRead = (e: Entry) => e.support_session_id !== undefined && !/session\.(start|end)/.test(e.action);

function istSeconds(utc: string): string {
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(utc))}`;
}

/**
 * Screen 12. Newest first; filters for IST date range, actor, organisation and action (AC 43, 44).
 * A platform admin sees everyone; every other role sees only their own entries, with no actor
 * filter and the title "Your activity" (AC 45). There is no edit, delete or export control (AC 46).
 */
export function AuditLog(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const canAll = () => hasPermission(state.session(), "admin.audit.read");
  const canStaff = () => hasPermission(state.session(), "admin.user.manage");

  const today = todayIst();
  const [draft, setDraft] = createSignal({ from: today, to: today, actor: "", org: "", action: "" });
  const [applied, setApplied] = createSignal(draft());
  const [open, setOpen] = createSignal<string | undefined>();

  const list = createPaged(applied, (f, cursor) =>
    outcome(
      api.GET("/v1/audit-entries", {
        params: {
          query: {
            limit: AUDIT_PAGE,
            ...(f.from ? { from: istDayStart(f.from) } : {}),
            ...(f.to ? { to: istDayEnd(f.to) } : {}),
            ...(f.actor ? { actor_vendor_user_id: f.actor } : {}),
            ...(f.org ? { organisation_id: f.org } : {}),
            ...(f.action ? { action: f.action } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );

  // Names for the Actor column and filter: only a user who can manage staff may list them.
  const users = createQuery(
    () => (canAll() && canStaff() ? "users" : undefined),
    () => outcome(api.GET("/v1/vendor-users", { params: { query: { limit: 100 } } })),
  );
  const actorName = (id: string) => {
    if (id === state.session()?.userId) return t("admin.audit.you");
    return users.data()?.items.find((u) => u.id === id)?.display_name ?? shortId(id);
  };

  const rows = () => list.rows().filter((e) => !isSessionRead(e));
  const set = (k: keyof ReturnType<typeof draft>, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = (e: SubmitEvent) => {
    e.preventDefault();
    setApplied({ ...draft() });
  };
  const actionLabel = (action: string) => {
    const key = `admin.audit.action.${action}`;
    const v = t(key);
    return v === key ? action : v;
  };

  return (
    <>
      <PageHeader title={t(canAll() ? "admin.audit.title" : "admin.audit.title.own")} />
      <form class="hy-filterbar" onSubmit={apply} data-testid="audit-filters">
        <Input type="date" name="from" label={`${t("admin.audit.filter.from")} (IST)`} value={draft().from} onInput={(e: InputEvent) => set("from", (e.currentTarget as HTMLInputElement).value)} data-testid="audit-from" />
        <Input type="date" name="to" label={`${t("admin.audit.filter.to")} (IST)`} value={draft().to} onInput={(e: InputEvent) => set("to", (e.currentTarget as HTMLInputElement).value)} data-testid="audit-to" />
        <Show when={canAll()}>
          <label class="hy-field">
            <span>{t("admin.audit.filter.actor")}</span>
            <select class="hy-input" value={draft().actor} onChange={(e: Event) => set("actor", (e.currentTarget as HTMLSelectElement).value)} data-testid="audit-actor">
              <option value="">{t("admin.audit.filter.all")}</option>
              <For each={users.data()?.items ?? []}>{(u) => <option value={u.id}>{u.display_name}</option>}</For>
            </select>
          </label>
          <Input name="org" label={t("admin.audit.filter.org")} autocomplete="off" value={draft().org} onInput={(e: InputEvent) => set("org", (e.currentTarget as HTMLInputElement).value.trim())} data-testid="audit-org" />
        </Show>
        <Input name="action" label={t("admin.audit.filter.action")} autocomplete="off" value={draft().action} onInput={(e: InputEvent) => set("action", (e.currentTarget as HTMLInputElement).value.trim())} data-testid="audit-action" />
        <Button type="submit" data-testid="audit-apply">
          {t("admin.audit.filter.apply")}
        </Button>
      </form>
      <StaleTag at={list.first.loadedAt()} />

      <Show when={list.first.failure() && !list.first.data()}>
        <ErrorState failure={list.first.failure()} onRetry={list.first.reload} data-testid="audit-error" />
      </Show>
      <Show when={list.first.loading() && !list.first.data()}>
        <SkeletonBlock rows={5} data-testid="audit-loading" />
      </Show>
      <Show when={list.first.data()}>
        <Show when={rows().length > 0} fallback={<Empty title={t("admin.audit.empty")} data-testid="audit-empty" />}>
          <div class="hy-table-wrap">
            <table class="hy-table" data-testid="audit-table">
              <caption class="hy-visually-hidden">{t("admin.audit.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.audit.col.time")}</th>
                  <th scope="col">{t("admin.audit.col.actor")}</th>
                  <th scope="col">{t("admin.audit.col.action")}</th>
                  <th scope="col">{t("admin.audit.col.org")}</th>
                  <th scope="col">{t("admin.audit.col.ticket")}</th>
                  <th scope="col">{t("admin.audit.col.result")}</th>
                  <th scope="col">
                    <span class="hy-visually-hidden">{t("admin.audit.col.details")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(e) => (
                    <>
                      <tr class="hy-table__row" data-testid="audit-row">
                        <td class="hy-num">{istSeconds(e.occurred_at)}</td>
                        <td>{actorName(e.actor_vendor_user_id)}</td>
                        <td>{actionLabel(e.action)}</td>
                        <td class="hy-num">{e.organisation_id ? shortId(e.organisation_id) : "--"}</td>
                        <td>{e.ticket_reference ?? "--"}</td>
                        <td>
                          <StatusBadge kind={e.result === "succeeded" ? "success" : e.result === "refused" ? "warning" : "danger"} label={t(`admin.audit.result.${e.result}`)} />
                        </td>
                        <td>
                          <Button aria-expanded={open() === e.id ? "true" : "false"} data-testid="audit-expand" onClick={() => setOpen(open() === e.id ? undefined : e.id)}>
                            {open() === e.id ? t("admin.audit.hide") : t("admin.audit.show")}
                          </Button>
                        </td>
                      </tr>
                      <Show when={open() === e.id}>
                        <tr data-testid="audit-detail">
                          <td colspan="7">
                            <EntryDetail entry={e} actor={actorName(e.actor_vendor_user_id)} />
                          </td>
                        </tr>
                      </Show>
                    </>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
        <p class="hy-hint" data-testid="audit-immutable">
          {t("admin.audit.immutable")}
        </p>
      </Show>
      <Show when={list.moreFailed()}>
        <InlineAlert kind="danger">{t("admin.error.generic")}</InlineAlert>
      </Show>
      <Show when={list.hasMore()}>
        <p>
          <Button disabled={list.moreBusy()} onClick={list.more} data-testid="audit-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
    </>
  );
}

/** Row detail (BR-62): ids, UTC and IST time, request id and source. Never a password, code or full number (AC 49). */
function EntryDetail(props: { entry: Entry; actor: string }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const e = () => props.entry;
  const reads = createQuery(
    () => (isSessionStart(e()) ? e().support_session_id : undefined),
    (id) => outcome(api.GET("/v1/audit-entries", { params: { query: { support_session_id: id, limit: 100 } } })),
  );
  return (
    <div class="hy-stack">
      <dl class="hy-dl" data-testid="audit-detail-list">
        <dt>{t("admin.audit.detail.id")}</dt>
        <dd class="hy-num">{e().id}</dd>
        <dt>{t("admin.audit.detail.utc")}</dt>
        <dd class="hy-num">{e().occurred_at}</dd>
        <dt>{t("admin.audit.detail.ist")}</dt>
        <dd class="hy-num">{ist(e().occurred_at)}</dd>
        <dt>{t("admin.audit.col.actor")}</dt>
        <dd>{props.actor}</dd>
        <dt>{t("admin.audit.detail.actionkey")}</dt>
        <dd>{e().action}</dd>
        <Show when={e().organisation_id}>
          <dt>{t("admin.audit.col.org")}</dt>
          <dd class="hy-num">{e().organisation_id}</dd>
        </Show>
        <Show when={e().target_id}>
          <dt>{t("admin.audit.detail.target")}</dt>
          <dd class="hy-num">{e().target_id}</dd>
        </Show>
        <dt>{t("admin.audit.detail.requestid")}</dt>
        <dd class="hy-num">{e().request_id}</dd>
        <Show when={e().source_address}>
          <dt>{t("admin.audit.detail.source")}</dt>
          <dd class="hy-num">{e().source_address}</dd>
        </Show>
      </dl>
      <Show when={isSessionStart(e())}>
        <div data-testid="audit-reads">
          <Show when={reads.loading() && !reads.data()}>
            <SkeletonBlock rows={2} />
          </Show>
          <Show when={reads.failure()}>
            <ErrorState failure={reads.failure()} onRetry={reads.reload} />
          </Show>
          <Show when={reads.data()}>
            {(d) => {
              const items = () => d().items.filter(isSessionRead);
              return (
                <>
                  <p>{t("admin.audit.session.reads", { n: items().length })}</p>
                  <ul class="hy-list">
                    <For each={items()}>
                      {(r) => (
                        <li data-testid="audit-read">
                          <span class="hy-num">{istSeconds(r.occurred_at)}</span> {r.read_summary ?? r.action}
                        </li>
                      )}
                    </For>
                  </ul>
                </>
              );
            }}
          </Show>
        </div>
      </Show>
    </div>
  );
}
