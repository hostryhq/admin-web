import { createSignal, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, CheckRow, InlineAlert, Input, MoneyField, PageHeader, formatMoney, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { ErrorState, SkeletonBlock, StaleTag, useWriteGuard } from "../../components/common";
import { FormDialog } from "../../components/FormDialog";
import { formKeys, newIntentKey } from "../../components/formkeys";
import { PlanStateBadge } from "../../components/ledgerBadges";
import { planName } from "../../components/plans";
import type { components } from "../../generated";
import { ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";

type S = components["schemas"];
export const KNOWN_FEATURES = ["restaurant.core", "restaurant.kds", "restaurant.captain", "restaurant.reports.core", "whatsapp.ordering", "analytics"] as const;
const PLAN_KEY = /^[a-z][a-z0-9_]{1,40}$/;

type Mode = "new" | "newversion" | "view";

/**
 * AS08: plan version editor (A1-S05, S06). A new plan or a new version is saved as a draft; the
 * contract has no edit call, so a draft is activated as saved or replaced by a newer draft. An active
 * version is read-only: "New version from this" starts a draft, "Retire" keeps it on existing
 * subscriptions. Money is integer paise; negative and non-INR cannot be typed (AC 17).
 */
export function PlanEditor(props: { mode: Mode }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ planKey: string; version: string }>();
  const q = createQuery(
    () => (props.mode === "new" ? undefined : params.planKey),
    (k) => outcome(api.GET("/v1/plans/{plan_key}", { params: { path: { plan_key: k } } })),
  );
  const plan = () => q.data();
  const version = (): S["PlanVersion"] | undefined => {
    const p = plan();
    if (!p) return undefined;
    if (props.mode === "view") return p.versions.find((v) => String(v.version) === params.version);
    return [...p.versions].sort((a, b) => b.version - a.version)[0];
  };

  return (
    <>
      <Show when={props.mode !== "new" && q.loading() && !q.data()}>
        <h1 tabindex="-1" data-testid="page-title" class="hy-visually-hidden">
          {t("admin.plans.title")}
        </h1>
        <SkeletonBlock rows={4} data-testid="version-loading" />
      </Show>
      <Show when={props.mode !== "new" && q.failure() && !q.data()}>
        <ErrorState failure={q.failure()} onRetry={q.reload} data-testid="version-error" />
      </Show>
      <Show when={props.mode === "new"}>
        <Form mode="new" />
      </Show>
      <Show when={props.mode === "newversion" && plan()}>{(p) => <Form mode="newversion" plan={p()} base={version()} />}</Show>
      <Show when={props.mode === "view" && plan()}>
        {(p) => (
          <Show when={version()} fallback={<InlineAlert kind="danger" data-testid="version-notfound">{t("admin.error.notfound.item")}</InlineAlert>}>
            {(v) => <View plan={p()} version={v()} reload={q.reload} loadedAt={q.loadedAt()} />}
          </Show>
        )}
      </Show>
    </>
  );
}

function View(props: { plan: S["Plan"]; version: S["PlanVersion"]; reload: () => void; loadedAt: number | undefined }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const state = useContext(SessionContext);
  const canManage = () => hasPermission(state.session(), "admin.plan.manage");
  const [activating, setActivating] = createSignal(false);
  const [retiring, setRetiring] = createSignal(false);
  const price = (c: "monthly" | "annual") => props.version.prices.find((p) => p.cycle === c)?.list_price.amount_paise;
  const act = async (kind: "activation" | "retirement", key: string) => {
    const call =
      kind === "activation"
        ? api.POST("/v1/plans/{plan_key}/versions/{version}/activation", { params: { path: { plan_key: props.plan.key, version: props.version.version }, header: mut(key) } })
        : api.POST("/v1/plans/{plan_key}/versions/{version}/retirement", { params: { path: { plan_key: props.plan.key, version: props.version.version }, header: mut(key) } });
    const r = await outcome(call);
    if (!r.ok) return writeError(r.failure);
    toasts.show(t(kind === "activation" ? "admin.version.activated" : "admin.version.retired"));
    setActivating(false);
    setRetiring(false);
    props.reload();
    return undefined;
  };
  return (
    <>
      <PageHeader
        title={t("admin.version.title", { plan: planName(t, props.plan), n: props.version.version })}
        actions={
          <>
            <PlanStateBadge state={props.version.state} />
            <Show when={canManage()}>
              <Show when={props.version.state === "draft"}>
                <Button variant="primary" data-testid="version-activate" onClick={() => setActivating(true)}>
                  {t("admin.version.activate")}
                </Button>
              </Show>
              <Show when={props.version.state === "active"}>
                <Button data-testid="version-retire" onClick={() => setRetiring(true)}>
                  {t("admin.version.retire")}
                </Button>
              </Show>
              <Button data-testid="version-newfrom" onClick={() => navigate(ROUTES.planNewVersion.path.replace(":planKey", props.plan.key))}>
                {t("admin.version.newfrom")}
              </Button>
            </Show>
          </>
        }
      />
      <StaleTag at={props.loadedAt} />
      <dl class="hy-dl" data-testid="version-readonly">
        <dt>{t("admin.version.key")}</dt>
        <dd>{props.plan.key}</dd>
        <dt>{t("admin.version.outlets")}</dt>
        <dd>{props.version.included_outlets}</dd>
        <dt>{t("admin.version.price.monthly")}</dt>
        <dd class="hy-num" data-testid="version-monthly">{price("monthly") === undefined ? "-" : formatMoney(price("monthly") ?? 0)}</dd>
        <dt>{t("admin.version.price.annual")}</dt>
        <dd class="hy-num" data-testid="version-annual">{price("annual") === undefined ? "-" : formatMoney(price("annual") ?? 0)}</dd>
        <dt>{t("admin.version.features")}</dt>
        <dd data-testid="version-features">{props.version.feature_keys.join(", ")}</dd>
      </dl>
      <p class="hy-hint">{t("admin.version.features.note")}</p>
      <Show when={props.version.state === "active"}>
        <p class="hy-hint" data-testid="version-immutable">
          {t("admin.version.activate.body")}
        </p>
      </Show>
      <FormDialog
        open={activating()}
        title={t("admin.version.activate")}
        submitLabel={t("admin.version.activate")}
        onClose={() => setActivating(false)}
        onSubmit={(key) => act("activation", key)}
        data-testid="activate-dialog"
      >
        <p>{t("admin.version.activate.body")}</p>
      </FormDialog>
      <FormDialog
        open={retiring()}
        title={t("admin.version.retire")}
        submitLabel={t("admin.version.retire")}
        onClose={() => setRetiring(false)}
        onSubmit={(key) => act("retirement", key)}
        data-testid="retire-dialog"
      >
        <p>{t("admin.version.retire.body")}</p>
      </FormDialog>
    </>
  );
}

function Form(props: { mode: "new" | "newversion"; plan?: S["Plan"]; base?: S["PlanVersion"] | undefined }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const navigate = useNavigate();
  const key = newIntentKey();
  const [planKey, setPlanKey] = createSignal("");
  const [outlets, setOutlets] = createSignal(String(props.base?.included_outlets ?? 1));
  const [monthly, setMonthly] = createSignal<number | undefined>(props.base?.prices.find((p) => p.cycle === "monthly")?.list_price.amount_paise);
  const [annual, setAnnual] = createSignal<number | undefined>(props.base?.prices.find((p) => p.cycle === "annual")?.list_price.amount_paise);
  const [features, setFeatures] = createSignal<string[]>(props.base?.feature_keys ?? ["restaurant.core"]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const featureList = () => [...new Set([...KNOWN_FEATURES, ...features()])];

  const outletsN = () => (/^\d{1,4}$/.test(outlets()) && Number(outlets()) >= 1 ? Number(outlets()) : undefined);
  const prices = (): S["PlanPrice"][] => [
    ...(monthly() !== undefined ? [{ cycle: "monthly" as const, list_price: { amount_paise: monthly() ?? 0, currency: "INR" as const } }] : []),
    ...(annual() !== undefined ? [{ cycle: "annual" as const, list_price: { amount_paise: annual() ?? 0, currency: "INR" as const } }] : []),
  ];
  const valid = () => outletsN() !== undefined && prices().length > 0 && (props.mode === "newversion" || PLAN_KEY.test(planKey()));

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || (guard.disabled() && error() !== "admin.write.unknown")) return;
    setBusy(true);
    setError(undefined);
    const draft: S["PlanVersionDraft"] = { feature_keys: features(), included_outlets: outletsN() ?? 1, prices: prices() };
    const done = (k: string, v?: number) => {
      toasts.show(t("admin.version.saved"));
      navigate(ROUTES.planVersion.path.replace(":planKey", k).replace(":version", String(v ?? 1)));
    };
    if (props.mode === "new") {
      const r = await outcome(api.POST("/v1/plans", { params: { header: mut(key) }, body: { key: planKey(), name_key: `plan.${planKey()}`, version: draft } }));
      setBusy(false);
      if (!r.ok) return setError(writeError(r.failure, { conflict: "admin.version.error.exists" }));
      done(r.data.key, r.data.versions[0]?.version);
      return;
    }
    const r = await outcome(api.POST("/v1/plans/{plan_key}/versions", { params: { path: { plan_key: props.plan?.key ?? "" }, header: mut(key) }, body: draft }));
    setBusy(false);
    if (!r.ok) return setError(writeError(r.failure));
    done(props.plan?.key ?? "", r.data.version);
  };

  const toggle = (f: string, on: boolean) => setFeatures((l) => (on ? [...l.filter((x) => x !== f), f] : l.filter((x) => x !== f)));

  return (
    <>
      <PageHeader title={props.mode === "new" ? t("admin.plans.new") : t("admin.plans.newversion")} />
      <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate data-testid="version-form">
        <Show when={props.mode === "new"} fallback={<p data-testid="version-planname">{props.plan ? planName(t, props.plan) : ""}</p>}>
          <Input
            name="key"
            label={`${t("admin.version.key")} *`}
            value={planKey()}
            autocomplete="off"
            error={planKey() !== "" && !PLAN_KEY.test(planKey()) ? t("admin.version.key.invalid") : undefined}
            onInput={(e: InputEvent) => setPlanKey((e.currentTarget as HTMLInputElement).value.trim())}
            data-autofocus
            data-testid="version-key"
          />
        </Show>
        <Input
          name="outlets"
          inputmode="numeric"
          label={`${t("admin.version.outlets")} *`}
          value={outlets()}
          error={outletsN() === undefined ? t("admin.version.outlets.invalid") : undefined}
          onInput={(e: InputEvent) => setOutlets((e.currentTarget as HTMLInputElement).value.trim())}
          data-testid="version-outlets"
        />
        <MoneyField label={t("admin.version.price.monthly")} valuePaise={monthly()} onChange={setMonthly} data-testid="version-monthly-input" />
        <MoneyField label={t("admin.version.price.annual")} valuePaise={annual()} onChange={setAnnual} data-testid="version-annual-input" />
        <Show when={prices().length === 0}>
          <p class="hy-hint">{t("admin.version.price.one")}</p>
        </Show>
        <fieldset class="hy-fieldset">
          <legend>{t("admin.version.features")}</legend>
          <For each={featureList()}>
            {(f) => <CheckRow label={f} checked={features().includes(f)} onChange={(on) => toggle(f, on)} data-testid={`version-feature-${f}`} />}
          </For>
        </fieldset>
        <p class="hy-hint">{t("admin.version.features.note")}</p>
        <p class="hy-hint">{t("admin.version.draft.note")}</p>
        <Show when={error()}>
          <InlineAlert kind={error() === "admin.write.unknown" ? "warning" : "danger"} data-testid="version-submit-error">
            {t(error() ?? "")}
          </InlineAlert>
        </Show>
        <div class="hy-actions">
          <a class="hy-btn hy-linkbutton" href={ROUTES.plans.path} data-testid="version-cancel">
            {t("admin.common.cancel")}
          </a>
          <Button type="submit" variant="primary" disabled={!valid() || busy() || (guard.disabled() && error() !== "admin.write.unknown")} title={guard.title()} data-testid="version-save">
            {t("admin.version.save")}
          </Button>
        </div>
      </form>
    </>
  );
}
