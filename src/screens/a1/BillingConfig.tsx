import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Card, DataTable, DateField, BasisPointField, InlineAlert, Input, MoneyField, PageHeader, formatBasisPoints, formatMoney, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createPaged } from "../../api/query";
import { Empty, ErrorState, SkeletonBlock, StaleTag, useWriteGuard } from "../../components/common";
import { addDays, fmtDate, todayIst } from "../../components/dates";
import { RadioGroup, Select } from "../../components/fields";
import { formKeys, newIntentKey } from "../../components/formkeys";
import { STATES } from "../../data/states";
import type { components } from "../../generated";
import { hasPermission, SessionContext } from "../../session/session";

type Config = components["schemas"]["BillingConfiguration"];

/** The version in force today: the latest `effective_from` that is not in the future. */
export function inForce(items: Config[], today: string): Config | undefined {
  return [...items].filter((c) => c.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}

/**
 * AS09: Hostry's own GST configuration (A1-S05, S09; AC 29, 30, 106). Each save is a new
 * effective-dated version, never an edit; past charges keep the rate they were raised with. Read-only
 * for everyone without `admin.plan.manage` (the form is absent). The rate is typed in basis points
 * and shown as a percent next to it.
 */
export function BillingConfig(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const canManage = () => hasPermission(state.session(), "admin.plan.manage");
  const paged = createPaged(
    () => "cfg",
    (_k, cursor) => outcome(api.GET("/v1/billing-configurations", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const today = todayIst();
  const rows = () => [...paged.rows()].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const current = () => inForce(paged.rows(), today);

  const columns: Column<Config>[] = [
    { id: "from", header: t("admin.billcfg.effective"), cell: (c) => fmtDate(c.effective_from) },
    { id: "reg", header: t("admin.billcfg.registered"), cell: (c) => t(c.gst_registered ? "admin.common.yes" : "admin.common.no") },
    { id: "rate", header: t("admin.billcfg.rate"), numeric: true, cell: (c) => `${formatBasisPoints(c.gst_rate_bp)}%` },
    { id: "sac", header: t("admin.billcfg.sac"), cell: (c) => c.sac },
    { id: "terms", header: t("admin.billcfg.terms"), numeric: true, cell: (c) => c.payment_terms_days },
    { id: "tol", header: t("admin.billcfg.tolerance"), numeric: true, cell: (c) => formatMoney(c.payment_tolerance_paise) },
  ];

  return (
    <>
      <PageHeader title={t("admin.billcfg.title")} />
      <StaleTag at={paged.first.loadedAt()} />
      <Show when={paged.first.loading() && !paged.first.data()}>
        <SkeletonBlock rows={4} data-testid="billcfg-loading" />
      </Show>
      <Show when={paged.first.failure() && !paged.first.data()}>
        <ErrorState failure={paged.first.failure()} onRetry={paged.first.reload} data-testid="billcfg-error" />
      </Show>
      <Show when={paged.first.data()}>
        <Show when={canManage()}>
          <ConfigForm base={current()} onSaved={paged.first.reload} />
        </Show>
        <Card title={t("admin.billcfg.history")}>
          <DataTable
            caption={t("admin.billcfg.history")}
            columns={columns}
            rows={rows()}
            rowKey={(c) => c.id}
            empty={<Empty title={t("admin.billcfg.empty")} data-testid="billcfg-empty" />}
            data-testid="billcfg-table"
          />
        </Card>
        <Show when={paged.hasMore()}>
          <p>
            <Button disabled={paged.moreBusy()} onClick={paged.more} data-testid="billcfg-more">
              {t("admin.common.more")}
            </Button>
          </p>
        </Show>
      </Show>
    </>
  );
}

function ConfigForm(props: { base: Config | undefined; onSaved: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const key = newIntentKey();
  const b = props.base;
  const [effective, setEffective] = createSignal(addDays(todayIst(), 1));
  const [registered, setRegistered] = createSignal<"yes" | "no">(b?.gst_registered === false ? "no" : "yes");
  const [state, setState] = createSignal(b?.hostry_state_code ?? "33");
  const [rate, setRate] = createSignal<number | undefined>(b?.gst_rate_bp ?? 1800);
  const [sac, setSac] = createSignal(b?.sac ?? "997331");
  const [terms, setTerms] = createSignal(String(b?.payment_terms_days ?? 7));
  const [tolerance, setTolerance] = createSignal<number | undefined>(b?.payment_tolerance_paise ?? 99);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const termsN = () => (/^\d{1,3}$/.test(terms()) ? Number(terms()) : undefined);
  const valid = () => effective() > todayIst() && rate() !== undefined && /^\d{4,8}$/.test(sac()) && termsN() !== undefined && tolerance() !== undefined;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || (guard.disabled() && error() !== "admin.write.unknown")) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.POST("/v1/billing-configurations", {
        params: { header: mut(key) },
        body: {
          effective_from: effective(),
          hostry_state_code: state(),
          sac: sac(),
          gst_rate_bp: registered() === "yes" ? (rate() ?? 0) : 0,
          gst_registered: registered() === "yes",
          payment_tolerance_paise: tolerance() ?? 0,
          payment_terms_days: termsN() ?? 0,
        },
      }),
    );
    setBusy(false);
    if (!r.ok) return setError(writeError(r.failure, { conflict: "admin.billcfg.error.exists" }));
    toasts.show(t("admin.billcfg.saved"));
    props.onSaved();
  };

  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate data-testid="billcfg-form">
      <DateField label={t("admin.billcfg.effective")} value={effective()} min={addDays(todayIst(), 1)} onChange={setEffective} data-testid="billcfg-effective" />
      <p class="hy-hint">{t("admin.billcfg.effective.hint")}</p>
      <RadioGroup
        legend={t("admin.billcfg.registered")}
        name="registered"
        value={registered()}
        onChange={(v) => setRegistered(v as "yes" | "no")}
        options={[
          { value: "yes", label: t("admin.common.yes") },
          { value: "no", label: t("admin.common.no") },
        ]}
        data-testid="billcfg-registered"
      />
      <Select
        name="state"
        label={t("admin.billcfg.state")}
        value={state()}
        options={STATES.map(([code]) => ({ value: code, label: t(`admin.state.${code}`) }))}
        onChange={(e: Event) => setState((e.currentTarget as HTMLSelectElement).value)}
        data-testid="billcfg-state"
      />
      <Show when={registered() === "yes"}>
        <BasisPointField label={t("admin.billcfg.rate")} valueBp={rate()} onChange={setRate} data-testid="billcfg-rate" />
      </Show>
      <Input name="sac" label={t("admin.billcfg.sac")} value={sac()} onInput={(e: InputEvent) => setSac((e.currentTarget as HTMLInputElement).value.trim())} data-testid="billcfg-sac" />
      <p class="hy-hint">{t("admin.billcfg.sac.note")}</p>
      <Input
        name="terms"
        inputmode="numeric"
        label={t("admin.billcfg.terms")}
        value={terms()}
        onInput={(e: InputEvent) => setTerms((e.currentTarget as HTMLInputElement).value.trim())}
        data-testid="billcfg-terms"
      />
      <MoneyField label={t("admin.billcfg.tolerance")} valuePaise={tolerance()} onChange={setTolerance} data-testid="billcfg-tolerance" />
      <Show when={error()}>
        <InlineAlert kind={error() === "admin.write.unknown" ? "warning" : "danger"} data-testid="billcfg-submit-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button type="submit" variant="primary" disabled={!valid() || busy() || (guard.disabled() && error() !== "admin.write.unknown")} title={guard.title()} data-testid="billcfg-save">
          {t("admin.billcfg.save")}
        </Button>
      </div>
    </form>
  );
}
