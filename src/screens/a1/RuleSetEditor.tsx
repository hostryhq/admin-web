import { createEffect, createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, ChecklistPanel, DateField, DiffList, InlineAlert, Input, PageHeader, RuleGrid, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { ErrorState, ist, SkeletonBlock, StaleTag, useWriteGuard } from "../../components/common";
import { fmtDate, todayIst } from "../../components/dates";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, TextArea } from "../../components/fields";
import { RuleSetStateBadge } from "../../components/ledgerBadges";
import { remainingLabel } from "../../components/remaining";
import type { components } from "../../generated";
import { ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";
import { MIN_REASON, TICKET_PATTERN } from "../StartSupportDialog";
import { formKeys } from "../../components/formkeys";
import { applyEdit, checkItems, diffRows, earliestEffective, gridValues, leadTimeOk, previousGrid, RATE_COLUMNS, rowId, ruleLabel, unequalHalves, type TaxRule } from "./ruleset";
import { inForceRuleSet, usePendingPublications } from "./TaxRules";

type S = components["schemas"];
const MIN_NOTE = 10;
const METHODS: S["RequesterVerification"][] = ["callback_to_registered_number", "owner_request_in_app", "other"];

/**
 * AS18 to AS20: one rule set. A draft is edited in the grid (rates are whole basis points, with a
 * "changed from" mark against the version in force), saved with its revision (If-Match), validated by
 * the service, then signed off by the CA record (AS19) and published by request (AS20). Signed and
 * published versions are read-only. Controls are absent without `admin.taxrules.manage`, and the
 * publication request without `admin.taxrules.publish` (AC 73 to 76, 79). Publishing never happens
 * here: a request goes to a second platform admin and approving it executes it (ADR-0014 A1.3).
 */
export function RuleSetEditor(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ ruleSetId: string }>();
  const q = createQuery(
    () => params.ruleSetId,
    (id) => outcome(api.GET("/v1/tax-rule-sets/{rule_set_id}", { params: { path: { rule_set_id: id } } })),
  );
  const all = createQuery(
    () => "all",
    () => outcome(api.GET("/v1/tax-rule-sets", { params: { query: { limit: 100 } } })),
  );
  return (
    <>
      <p>
        <a href={ROUTES.taxRules.path} data-testid="ruleset-back">
          {t("admin.tax.title")}
        </a>
      </p>
      <Show when={q.loading() && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.tax.title")}
        </h1>
        <SkeletonBlock rows={5} data-testid="ruleset-loading" />
      </Show>
      <Show when={q.failure() && !q.data()}>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="ruleset-error" />
      </Show>
      <Show when={q.data()}>
        {(m) => <Editor master={m()} previous={inForceRuleSet((all.data()?.items ?? []).filter((x) => x.id !== m().id), todayIst())} reload={q.reload} loadedAt={q.loadedAt()} />}
      </Show>
    </>
  );
}

function Editor(props: { master: S["TaxRuleSetMaster"]; previous: S["TaxRuleSetMaster"] | undefined; reload: () => void; loadedAt: number | undefined }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const pending = usePendingPublications();
  const draft = () => props.master.state === "draft";
  const editable = () => draft() && can("admin.taxrules.manage");

  const [rules, setRules] = createSignal<TaxRule[]>(props.master.rules);
  const [name, setName] = createSignal(props.master.name);
  const [effective, setEffective] = createSignal(props.master.effective_date);
  const [validation, setValidation] = createSignal<S["TaxRuleSetValidation"] | undefined>();
  const [busy, setBusy] = createSignal<"save" | "validate" | undefined>();
  const [error, setError] = createSignal<string | undefined>();
  // Cells holding text that is not whole basis points: the draft cannot be saved, validated or signed until they are fixed.
  const [invalid, setInvalid] = createSignal<ReadonlySet<string>>(new Set());
  const [signing, setSigning] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  // A reload (after save or sign-off) replaces the local copy with the server's.
  createEffect(
    () => props.master,
    (m) => {
      setRules(m.rules);
      setName(m.name);
      setEffective(m.effective_date);
    },
  );

  const dirty = () => JSON.stringify(rules()) !== JSON.stringify(props.master.rules) || name() !== props.master.name || effective() !== props.master.effective_date;
  const rows = () => rules().map((r, i) => ({ id: rowId(i), label: ruleLabel(r, t) }));
  const columns = () => RATE_COLUMNS.map((c) => ({ id: c, label: t(`admin.ruleset.col.${c}`) }));
  const waiting = () => pending.ids().has(props.master.id);
  const unequal = () => unequalHalves(rules());

  const save = async (): Promise<boolean> => {
    setBusy("save");
    setError(undefined);
    const r = await outcome(
      api.PATCH("/v1/tax-rule-sets/{rule_set_id}", {
        params: { path: { rule_set_id: props.master.id }, header: { ...mut(), "If-Match": `"${props.master.revision}"` } },
        body: { name: name().trim(), effective_date: effective(), calc_v: props.master.calc_v, rules: rules() },
      }),
    );
    setBusy(undefined);
    if (!r.ok) {
      setError(writeError(r.failure, { precondition_failed: "admin.error.changed" }));
      return false;
    }
    toasts.show(t("admin.ruleset.saved"));
    setValidation(undefined);
    props.reload();
    return true;
  };

  const validate = async () => {
    if (dirty() && !(await save())) return;
    setBusy("validate");
    setError(undefined);
    const r = await outcome(api.POST("/v1/tax-rule-sets/{rule_set_id}/validation", { params: { path: { rule_set_id: props.master.id }, header: mut() } }));
    setBusy(undefined);
    if (!r.ok) {
      setError(writeError(r.failure));
      return;
    }
    setValidation(r.data);
  };

  const canSign = () => editable() && !dirty() && invalid().size === 0 && validation()?.valid === true;

  return (
    <>
      <PageHeader
        title={t("admin.ruleset.title", { version: `v${props.master.version}` })}
        actions={
          <>
            <RuleSetStateBadge state={props.master.state} reviewed={props.master.review_status === "reviewed"} pending={waiting()} />
            <Show when={editable()}>
              <Button disabled={!dirty() || invalid().size > 0 || busy() !== undefined || guard.disabled()} title={guard.title()} data-testid="ruleset-save" onClick={() => void save()}>
                {t("admin.ruleset.save")}
              </Button>
              <Button variant="primary" disabled={invalid().size > 0 || busy() !== undefined || guard.disabled()} title={guard.title()} data-testid="ruleset-validate" onClick={() => void validate()}>
                {t("admin.ruleset.validate")}
              </Button>
              <Button variant="danger" data-testid="ruleset-delete" onClick={() => setDeleting(true)}>
                {t("admin.ruleset.delete")}
              </Button>
            </Show>
          </>
        }
      />
      <StaleTag at={props.loadedAt} />
      <Show when={!draft()}>
        <InlineAlert kind="info" data-testid="ruleset-readonly">
          {t(props.master.state === "signed" ? "admin.ruleset.signed.note" : "admin.ruleset.published.note")}
        </InlineAlert>
      </Show>
      <Show when={waiting()}>
        <InlineAlert kind="warning" data-testid="ruleset-waiting">
          {t("admin.publish.waiting")} <a href={ROUTES.approvals.path}>{t("admin.approvals.title")}</a>
        </InlineAlert>
      </Show>
      <form class="hy-filterbar" onSubmit={(e: SubmitEvent) => e.preventDefault()} onKeyDown={formKeys}>
        <Show
          when={editable()}
          fallback={
            <p data-testid="ruleset-effective-ro">
              {t("admin.ruleset.effective")}: <span class="hy-num">{fmtDate(props.master.effective_date)}</span> - {props.master.name}
            </p>
          }
        >
          <Input name="name" label={t("admin.tax.draft.name")} value={name()} onInput={(e: InputEvent) => setName((e.currentTarget as HTMLInputElement).value)} data-testid="ruleset-name" />
          <DateField label={t("admin.ruleset.effective")} value={effective()} min={todayIst()} onChange={setEffective} data-testid="ruleset-effective" />
        </Show>
      </form>
      <p class="hy-hint">{t("admin.ruleset.bp.hint")}</p>
      <RuleGrid
        label={t("admin.ruleset.title", { version: `v${props.master.version}` })}
        rows={rows()}
        columns={columns()}
        values={gridValues(rules())}
        {...(props.previous && draft() ? { previous: previousGrid(rules(), props.previous.rules) ?? {} } : {})}
        readOnly={!editable()}
        onChange={(r, c, bp) => {
          setInvalid((s) => {
            const next = new Set(s);
            if (bp === undefined) next.add(`${r}:${c}`);
            else next.delete(`${r}:${c}`);
            return next;
          });
          setRules((l) => applyEdit(l, r, c, bp));
          setValidation(undefined);
        }}
        data-testid="ruleset-grid"
      />
      <Show when={invalid().size > 0}>
        <InlineAlert kind="danger" data-testid="ruleset-invalid">
          {t("admin.ruleset.invalid")}
        </InlineAlert>
      </Show>
      <Show when={unequal().length > 0 && editable()}>
        <p class="hy-hint" data-testid="ruleset-halves-hint">
          {t("admin.ruleset.halves.rows", { rows: unequal().map((i) => i + 1).join(", ") })}
        </p>
      </Show>
      <Show when={error()}>
        <InlineAlert kind={error() === "admin.write.unknown" ? "warning" : "danger"} data-testid="ruleset-op-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <Show when={validation()}>
        {(v) => (
          <>
            <h2>{t("admin.ruleset.check.title")}</h2>
            <ChecklistPanel label={t("admin.ruleset.check.title")} items={checkItems(v(), t)} />
          </>
        )}
      </Show>
      <Show when={props.master.signoff}>
        {(s) => (
          <p data-testid="ruleset-signoff">
            {t("admin.publish.signoff")}: {s().reviewer_name}, {fmtDate(s().signed_on)}, {s().reference_note}
          </p>
        )}
      </Show>
      <div class="hy-actions">
        <Show when={editable()}>
          <Button variant="primary" disabled={!canSign() || guard.disabled()} title={canSign() ? guard.title() : t("admin.ruleset.sign.disabled")} data-testid="ruleset-sign" onClick={() => setSigning(true)}>
            {t("admin.ruleset.sign")}
          </Button>
        </Show>
        <Show when={props.master.state === "signed" && can("admin.taxrules.publish") && !waiting()}>
          <Button variant="primary" data-testid="ruleset-publish" onClick={() => setPublishing(true)}>
            {t("admin.publish.submit")}
          </Button>
        </Show>
      </div>

      <Show when={signing()}>
        <SignOffDialog
          ruleSetId={props.master.id}
          onClose={() => setSigning(false)}
          onDone={() => {
            setSigning(false);
            props.reload();
          }}
        />
      </Show>
      <Show when={publishing()}>
        <PublishDialog
          master={props.master}
          previous={props.previous}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            pending.reload();
          }}
        />
      </Show>
      <Show when={deleting()}>
        <FormDialog
          open
          title={t("admin.ruleset.delete")}
          submitLabel={t("admin.ruleset.delete")}
          danger
          onClose={() => setDeleting(false)}
          data-testid="ruleset-delete-dialog"
          onSubmit={async (key) => {
            const r = await outcome(api.DELETE("/v1/tax-rule-sets/{rule_set_id}", { params: { path: { rule_set_id: props.master.id }, header: mut(key) } }));
            if (!r.ok) return writeError(r.failure);
            toasts.show(t("admin.ruleset.deleted"));
            navigate(ROUTES.taxRules.path);
            return undefined;
          }}
        >
          <p>{t("admin.ruleset.delete.body")}</p>
        </FormDialog>
      </Show>
    </>
  );
}

/** AS19: reviewer name, date and a reference note of 10+ characters. Free text only; nothing is attached (P2D-10). */
function SignOffDialog(props: { ruleSetId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [name, setName] = createSignal("");
  const [date, setDate] = createSignal(todayIst());
  const [note, setNote] = createSignal("");
  const valid = () => name().trim().length > 0 && date() !== "" && date() <= todayIst() && note().trim().length >= MIN_NOTE;
  return (
    <FormDialog
      open
      title={t("admin.signoff.title")}
      submitLabel={t("admin.signoff.submit")}
      valid={valid()}
      onClose={props.onClose}
      data-testid="signoff-dialog"
      onSubmit={async (key) => {
        const r = await outcome(
          api.POST("/v1/tax-rule-sets/{rule_set_id}/signature", {
            params: { path: { rule_set_id: props.ruleSetId }, header: mut(key) },
            body: { signoff: { reviewer_name: name().trim(), signed_on: date(), reference_note: note().trim() } },
          }),
        );
        if (!r.ok) return writeError(r.failure);
        toasts.show(t("admin.signoff.done"));
        props.onDone();
        return undefined;
      }}
    >
      <Input name="reviewer" label={`${t("admin.signoff.name")} *`} value={name()} onInput={(e: InputEvent) => setName((e.currentTarget as HTMLInputElement).value)} data-autofocus data-testid="signoff-name" />
      <DateField label={`${t("admin.signoff.date")} *`} value={date()} max={todayIst()} onChange={setDate} data-testid="signoff-date" />
      <TextArea
        name="note"
        label={`${t("admin.signoff.note")} *`}
        value={note()}
        counter={t("admin.common.min.chars", { n: note().trim().length, min: MIN_NOTE })}
        onInput={(e: InputEvent) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="signoff-note"
      />
      <p class="hy-hint">{t("admin.signoff.warn")}</p>
    </FormDialog>
  );
}

/**
 * AS20: request publication. The rule set's effective date is fixed at signing, so the lead time is
 * a check, not a field: under 24 hours ahead the dialog says the earliest allowed moment and offers no
 * submit (the request would also be refused when approval executes, on billing's clock). The 24 hours is
 * deployment configuration, shown as text, never a panel setting. The approver must be a different
 * platform admin; with only one the request is refused `second_approver_unavailable`.
 */
function PublishDialog(props: { master: S["TaxRuleSetMaster"]; previous: S["TaxRuleSetMaster"] | undefined; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const [ticket, setTicket] = createSignal("");
  const [reason, setReason] = createSignal("");
  const [method, setMethod] = createSignal<S["RequesterVerification"]>("other");
  const now = new Date();
  const earliest = earliestEffective(now).toISOString();
  const okLead = () => leadTimeOk(props.master.effective_date, now);
  const valid = () => okLead() && TICKET_PATTERN.test(ticket()) && reason().trim().length >= MIN_REASON && props.master.content_hash !== undefined;
  const lapse = () => {
    const eff = Date.parse(`${props.master.effective_date}T00:00:00+05:30`) - 24 * 3_600_000;
    return new Date(Math.min(now.getTime() + 24 * 3_600_000, eff)).toISOString();
  };

  return (
    <FormDialog
      open
      title={t("admin.publish.title", { version: `v${props.master.version}` })}
      submitLabel={t("admin.publish.submit")}
      valid={valid()}
      onClose={props.onClose}
      data-testid="publish-dialog"
      onSubmit={async (key) => {
        const r = await outcome(
          api.POST("/v1/approvals", {
            params: { header: mut(key) },
            body: {
              kind: "tax_rule_set_publish",
              rule_set_id: props.master.id,
              ...(props.master.content_hash ? { rule_set_content_hash: props.master.content_hash } : {}),
              effective_date: props.master.effective_date,
              ticket_reference: ticket(),
              reason: reason().trim(),
              verification_method: method(),
            },
          }),
        );
        if (!r.ok) return writeError(r.failure, { second_approver_unavailable: "admin.publish.noapprover", approval_conflict: "admin.publish.exists" });
        toasts.show(t("admin.publish.waiting"));
        props.onDone();
        return undefined;
      }}
    >
      <p data-testid="publish-effective">
        {t("admin.publish.effective")}: <span class="hy-num">{fmtDate(props.master.effective_date)}</span> 00:00 IST
      </p>
      <Show when={!okLead()}>
        <InlineAlert kind="danger" data-testid="publish-toosoon">
          {t("admin.publish.earliest", { time: ist(earliest) })}
        </InlineAlert>
      </Show>
      <Show when={props.master.review_status === "unreviewed"}>
        <InlineAlert kind="warning" data-testid="publish-unreviewed">
          {t("admin.publish.unreviewed")}
        </InlineAlert>
      </Show>
      <p class="hy-hint" data-testid="publish-lead">
        {t("admin.publish.lead", { h: 24 })}
      </p>
      <Show when={props.master.signoff}>
        {(s) => (
          <p data-testid="publish-signoff">
            {t("admin.publish.signoff")}: {s().reviewer_name}, {fmtDate(s().signed_on)}, {s().reference_note}
          </p>
        )}
      </Show>
      <Show when={props.previous}>
        {(p) => (
          <>
            <h3>{t("admin.publish.diff", { version: `v${p().version}` })}</h3>
            <Show when={diffRows(props.master.rules, p().rules, t).length > 0} fallback={<p class="hy-hint">{t("admin.publish.diff.none")}</p>}>
              <DiffList label={t("admin.publish.diff", { version: `v${p().version}` })} rows={diffRows(props.master.rules, p().rules, t)} />
            </Show>
          </>
        )}
      </Show>
      <Input
        name="ticket"
        label={`${t("admin.lifecycle.ticket")} *`}
        value={ticket()}
        autocomplete="off"
        onInput={(e: InputEvent) => setTicket((e.currentTarget as HTMLInputElement).value.trim())}
        data-autofocus
        data-testid="publish-ticket"
      />
      <RadioGroup
        legend={`${t("admin.revoke.method")} *`}
        name="method"
        value={method()}
        onChange={(v) => setMethod(v as S["RequesterVerification"])}
        options={METHODS.map((m) => ({ value: m, label: t(`admin.revoke.method.${m}`) }))}
        data-testid="publish-method"
      />
      <TextArea
        name="reason"
        label={`${t("admin.lifecycle.reason")} *`}
        value={reason()}
        counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
        onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
        data-testid="publish-reason"
      />
      <p class="hy-hint">{t("admin.publish.approver")}</p>
      <p class="hy-hint" data-testid="publish-lapse">
        {t("admin.publish.lapse", { time: ist(lapse()), left: remainingLabel(t, lapse(), now.getTime()) })}
      </p>
    </FormDialog>
  );
}
