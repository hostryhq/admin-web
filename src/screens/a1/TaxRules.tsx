import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, DataTable, DateField, Input, PageHeader, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createPaged, createQuery } from "../../api/query";
import { Empty, ErrorState, StaleTag } from "../../components/common";
import { addDays, fmtDate, todayIst } from "../../components/dates";
import { FormDialog } from "../../components/FormDialog";
import { RuleSetStateBadge } from "../../components/ledgerBadges";
import type { components } from "../../generated";
import { ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type S = components["schemas"];
type Master = S["TaxRuleSetMaster"];

/** The version in force today: the published one with the latest effective date that has begun. */
export function inForceRuleSet(items: readonly Master[], today: string): Master | undefined {
  return [...items].filter((m) => m.state === "published" && m.effective_date <= today).sort((a, b) => b.version - a.version)[0];
}

/** Rule sets that wait for a second approver, by id (from the pending `tax_rule_set_publish` approvals). */
export function usePendingPublications() {
  const api = useApi();
  const state = useContext(SessionContext);
  const q = createQuery(
    () => (hasPermission(state.session(), "admin.approval.read") ? "pending" : undefined),
    () => outcome(api.GET("/v1/approvals", { params: { query: { state: "pending", limit: 100 } } })),
  );
  return {
    ids: () => new Set((q.data()?.items ?? []).filter((a) => a.kind === "tax_rule_set_publish").map((a) => a.subject_id ?? "")),
    reload: q.reload,
  };
}

/**
 * AS17: rule-set versions (A1-S18; AC 76 to 78, 80, 82). The one in force is marked with text.
 * "Received by" counts acknowledged emits, not trading data (BR-A1-84). A published row has no edit
 * control and owners never edit rates. "New draft" starts from the latest version's rules.
 */
export function TaxRules(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canManage = () => hasPermission(state.session(), "admin.taxrules.manage");
  const [drafting, setDrafting] = createSignal(false);
  const pending = usePendingPublications();
  const paged = createPaged(
    () => "sets",
    (_k, cursor) => outcome(api.GET("/v1/tax-rule-sets", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const today = todayIst();
  const rows = () => [...paged.rows()].sort((a, b) => b.version - a.version);
  const current = () => inForceRuleSet(paged.rows(), today);
  const open = (m: Master) => navigate(ROUTES.taxRuleSet.path.replace(":ruleSetId", m.id));

  const columns: Column<Master>[] = [
    {
      id: "version",
      header: t("admin.tax.col.version"),
      cell: (m) => (
        <span>
          v{m.version}
          <Show when={current()?.id === m.id}>
            {" "}
            <strong data-testid="tax-inforce-mark">{t("admin.tax.inforce.mark")}</strong>
          </Show>
        </span>
      ),
    },
    { id: "effective", header: t("admin.tax.col.effective"), cell: (m) => fmtDate(m.effective_date) },
    { id: "state", header: t("admin.tax.col.state"), cell: (m) => <RuleSetStateBadge state={m.state} reviewed={m.review_status === "reviewed"} pending={m.state === "signed" && pending.ids().has(m.id)} /> },
    {
      id: "signoff",
      header: t("admin.tax.col.signoff"),
      cell: (m) => (m.signoff ? `${m.signoff.reviewer_name}, ${fmtDate(m.signoff.signed_on)}, ${m.signoff.reference_note}` : t("admin.tax.unreviewed.note")),
    },
    {
      id: "received",
      header: t("admin.tax.col.received"),
      cell: (m) =>
        m.state === "published" && m.organisations_total !== undefined
          ? t("admin.tax.received", { n: m.organisations_acknowledged ?? 0, m: m.organisations_total })
          : m.state === "signed" && pending.ids().has(m.id)
            ? t("admin.tax.state.pending")
            : "",
    },
  ];

  return (
    <>
      <PageHeader
        title={t("admin.tax.title")}
        actions={
          <Show when={canManage()}>
            <Button variant="primary" data-testid="tax-new" onClick={() => setDrafting(true)}>
              {t("admin.tax.new")}
            </Button>
          </Show>
        }
      />
      <Show when={current()}>
        {(c) => (
          <p data-testid="tax-inforce">
            {t("admin.tax.inforce")}: v{c().version} - {t("admin.tax.col.effective")} {fmtDate(c().effective_date)}
          </p>
        )}
      </Show>
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="tax-error" />
      </Show>
      <Show when={!paged.first.failure() || paged.first.data()}>
        <DataTable
          caption={t("admin.tax.title")}
          columns={columns}
          rows={rows()}
          rowKey={(m) => m.id}
          loading={paged.first.loading() && !paged.first.data()}
          onOpen={open}
          empty={<Empty title={t("admin.tax.empty")} data-testid="tax-empty" />}
          data-testid="tax-table"
        />
      </Show>
      <p class="hy-hint">{t("admin.tax.note")}</p>
      <Show when={paged.hasMore()}>
        <p>
          <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="tax-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
      <Show when={drafting()}>
        <NewDraftDialog
          base={rows()[0]}
          onClose={() => setDrafting(false)}
          onDone={(id) => {
            setDrafting(false);
            navigate(ROUTES.taxRuleSet.path.replace(":ruleSetId", id));
          }}
        />
      </Show>
    </>
  );
}

function NewDraftDialog(props: { base: Master | undefined; onClose: () => void; onDone: (id: string) => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [name, setName] = createSignal(props.base?.name ?? "");
  const [date, setDate] = createSignal(addDays(todayIst(), 30));
  return (
    <FormDialog
      open
      title={t("admin.tax.new")}
      submitLabel={t("admin.tax.new")}
      valid={name().trim().length > 0 && date() > todayIst()}
      onClose={props.onClose}
      data-testid="newdraft-dialog"
      onSubmit={async (key) => {
        const r = await outcome(
          api.POST("/v1/tax-rule-sets", {
            params: { header: mut(key) },
            body: { name: name().trim(), effective_date: date(), calc_v: props.base?.calc_v ?? 1, rules: props.base?.rules ?? [] },
          }),
        );
        if (!r.ok) return writeError(r.failure);
        props.onDone(r.data.id);
        return undefined;
      }}
    >
      <Input name="name" label={`${t("admin.tax.draft.name")} *`} value={name()} onInput={(e: InputEvent) => setName((e.currentTarget as HTMLInputElement).value)} data-autofocus data-testid="newdraft-name" />
      <DateField label={t("admin.ruleset.effective")} value={date()} min={addDays(todayIst(), 1)} onChange={setDate} data-testid="newdraft-date" />
      <Show when={props.base}>
        <p class="hy-hint">{t("admin.tax.draft.copy", { version: props.base?.version ?? 0 })}</p>
      </Show>
    </FormDialog>
  );
}
