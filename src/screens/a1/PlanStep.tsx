import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate, useParams } from "@solidjs/router";
import { Button, InlineAlert, MoneyField, DateField, formatMoney, toasts, useI18n } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { Empty, ErrorState, SkeletonBlock, useWriteGuard } from "../../components/common";
import { addDays, fmtDate, todayIst } from "../../components/dates";
import { RadioGroup, Select, TextArea } from "../../components/fields";
import { formKeys, newIntentKey } from "../../components/formkeys";
import type { components } from "../../generated";
import { orgPath, ROUTES } from "../../routes";
import { hasPermission, SessionContext } from "../../session/session";
import { MIN_REASON } from "../StartSupportDialog";
import { currentSubscription } from "./onboarding";
import { planName } from "../../components/plans";
import { WizardFrame } from "./WizardFrame";

type S = components["schemas"];
type Cycle = "monthly" | "annual";
export const PILOT_PLAN_KEY = "pilot";
export const PILOT_DAYS = 90;

export type Sellable = { key: string; version: number; label: string; prices: S["PlanPrice"][] };

/** Only `active` versions can be assigned (AC 20); the pilot plan is offered as the Pilot choice, not in the list. */
export function sellable(plans: S["Plan"][], t: (k: string) => string): { pilot: Sellable | undefined; paid: Sellable[] } {
  const out: Sellable[] = [];
  for (const p of plans) {
    for (const v of p.versions) {
      if (v.state === "active") out.push({ key: p.key, version: v.version, label: `${planName(t, p)} v${v.version}`, prices: v.prices });
    }
  }
  const pilot = out.filter((s) => s.key === PILOT_PLAN_KEY).sort((a, b) => b.version - a.version)[0];
  return { pilot, paid: out.filter((s) => s.key !== PILOT_PLAN_KEY) };
}

export function listPrice(s: Sellable | undefined, cycle: Cycle): number | undefined {
  return s?.prices.find((p) => p.cycle === cycle)?.list_price.amount_paise;
}

/**
 * AS05, wizard step 3: pilot or paid terms (A1-S01, S07, S08). No charge is created here. The agreed
 * price control exists only with `admin.subscription.manage`; below list needs `admin.subscription.adjust`
 * and a reason, otherwise the server refuses it and the field says so. Add-ons are not offered here:
 * the contract does not say how an add-on is priced (reported as a gap).
 */
export function PlanStep(): JSX.Element {
  return <WizardFrame current="plan">{(facts, reload) => <Body current={() => currentSubscription(facts())} reload={reload} />}</WizardFrame>;
}

function Body(props: { current: () => S["Subscription"] | undefined; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const navigate = useNavigate();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const key = newIntentKey();

  const plans = createQuery(
    () => "plans",
    () => outcome(api.GET("/v1/plans", { params: { query: { limit: 100 } } })),
  );
  const choices = () => sellable(plans.data()?.items ?? [], t);

  const [type, setType] = createSignal<"pilot" | "paid">("pilot");
  const [versionId, setVersionId] = createSignal("");
  const [cycle, setCycle] = createSignal<Cycle>("monthly");
  const [start, setStart] = createSignal(todayIst());
  const [review, setReview] = createSignal(addDays(todayIst(), PILOT_DAYS));
  const [agreed, setAgreed] = createSignal<number | undefined>();
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  const [saved, setSaved] = createSignal<"pilot" | "paid" | undefined>();

  const chosen = () => choices().paid.find((s) => `${s.key}:${s.version}` === (versionId() || (choices().paid[0] ? `${choices().paid[0]?.key}:${choices().paid[0]?.version}` : "")));
  const list = () => listPrice(chosen(), cycle());
  const price = () => agreed() ?? list();
  const below = () => type() === "paid" && price() !== undefined && list() !== undefined && (price() ?? 0) < (list() ?? 0);
  const canStart = () => can("admin.subscription.start") || can("admin.subscription.manage");
  const valid = () => {
    if (!canStart()) return false;
    if (type() === "pilot") return choices().pilot !== undefined && review() > todayIst();
    return chosen() !== undefined && list() !== undefined && start() !== "" && price() !== undefined && (!below() || reason().trim().length >= MIN_REASON);
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || (guard.disabled() && error() !== "admin.write.unknown")) return;
    setBusy(true);
    setError(undefined);
    const pilot = choices().pilot;
    const sel = chosen();
    const body: S["StartSubscription"] =
      type() === "pilot"
        ? { plan_key: pilot?.key ?? PILOT_PLAN_KEY, plan_version: pilot?.version ?? 1, cycle: "none", start_date: todayIst(), review_date: review() }
        : {
            plan_key: sel?.key ?? "",
            plan_version: sel?.version ?? 0,
            cycle: cycle(),
            start_date: start(),
            ...(can("admin.subscription.manage") && agreed() !== undefined ? { agreed_price: { amount_paise: agreed() ?? 0, currency: "INR" as const } } : {}),
            ...(below() ? { reason: reason().trim() } : {}),
          };
    const r = await outcome(api.POST("/v1/organisations/{organisation_id}/subscription", { params: { path: { organisation_id: params.orgId }, header: mut(key) }, body }));
    setBusy(false);
    if (!r.ok) {
      setError(writeError(r.failure, { below_list: "admin.plan.step.error.belowlist", forbidden_below_list: "admin.plan.step.error.belowlist", subscription_exists: "admin.plan.step.error.exists" }));
      return;
    }
    setSaved(type());
    toasts.show(t(type() === "pilot" ? "admin.plan.step.saved.pilot" : "admin.plan.step.saved.paid", { date: fmtDate(review()) }));
    props.reload();
  };

  const next = () => navigate(orgPath(ROUTES.checklist, params.orgId));

  return (
    <>
      <h2 data-testid="step-title">{t("admin.plan.step.title")}</h2>
      <Show when={!can("admin.subscription.start") && !can("admin.subscription.manage")}>
        <InlineAlert kind="info" data-testid="plan-forrole">
          {t("admin.plan.step.forrole")}
        </InlineAlert>
      </Show>
      <Show when={saved()}>
        <InlineAlert kind="success" data-testid="plan-saved">
          {t(saved() === "pilot" ? "admin.plan.step.saved.pilot" : "admin.plan.step.saved.paid", { date: fmtDate(review()) })}
        </InlineAlert>
      </Show>
      <Show when={saved() ? undefined : props.current()}>
        {(sub) => (
          <InlineAlert kind="info" data-testid="plan-exists">
            {t("admin.plan.step.exists", { plan: sub().plan_key, version: sub().plan_version })}{" "}
            <a href={orgPath(ROUTES.subscription, params.orgId)}>{t("admin.sub.title")}</a>
          </InlineAlert>
        )}
      </Show>
      <Show when={plans.failure() && !plans.data()}>
        <ErrorState failure={plans.failure()} onRetry={plans.reload} data-testid="plan-error" />
      </Show>
      <Show when={plans.loading() && !plans.data()}>
        <SkeletonBlock rows={3} data-testid="plan-loading" />
      </Show>
      <Show when={canStart() && plans.data() && !props.current() && !saved()}>
        <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate data-testid="plan-form">
          <RadioGroup
            legend={t("admin.plan.step.type")}
            name="type"
            value={type()}
            onChange={(v) => setType(v as "pilot" | "paid")}
            options={[
              { value: "pilot", label: t("admin.plan.step.type.pilot") },
              { value: "paid", label: t("admin.plan.step.type.paid") },
            ]}
            data-testid="plan-type"
          />
          <Show when={type() === "pilot"}>
            <Show when={choices().pilot} fallback={<Empty title={t("admin.plan.step.nonesellable")} data-testid="plan-none" />}>
              <DateField label={t("admin.plan.step.review")} value={review()} min={addDays(todayIst(), 1)} onChange={setReview} data-testid="plan-review" />
              <p class="hy-hint">{t("admin.plan.step.review.hint")}</p>
            </Show>
          </Show>
          <Show when={type() === "paid"}>
            <Show when={choices().paid.length > 0} fallback={<Empty title={t("admin.plan.step.nonesellable")} data-testid="plan-none" description={t("admin.plan.step.draftnote")} />}>
              <Select
                name="version"
                label={t("admin.plan.step.version")}
                value={versionId() || `${choices().paid[0]?.key}:${choices().paid[0]?.version}`}
                options={choices().paid.map((s) => ({ value: `${s.key}:${s.version}`, label: s.label }))}
                onChange={(e: Event) => {
                  setVersionId((e.currentTarget as HTMLSelectElement).value);
                  setAgreed(undefined);
                }}
                data-testid="plan-version"
              />
              <RadioGroup
                legend={t("admin.plan.step.cycle")}
                name="cycle"
                value={cycle()}
                onChange={(v) => {
                  setCycle(v as Cycle);
                  setAgreed(undefined);
                }}
                options={(["monthly", "annual"] as const).filter((c) => listPrice(chosen(), c) !== undefined).map((c) => ({ value: c, label: t(`admin.plan.step.cycle.${c}`) }))}
                data-testid="plan-cycle"
              />
              <DateField label={t("admin.plan.step.start")} value={start()} onChange={setStart} data-testid="plan-start" />
              <p data-testid="plan-list">
                {t("admin.plan.step.list")}: <span class="hy-num">{list() === undefined ? "" : formatMoney(list() ?? 0)}</span>
              </p>
              <Show when={can("admin.subscription.manage")}>
                <MoneyField label={t("admin.plan.step.agreed")} valuePaise={price()} onChange={setAgreed} data-testid="plan-agreed" />
              </Show>
              <Show when={below()}>
                <Show
                  when={can("admin.subscription.adjust")}
                  fallback={
                    <InlineAlert kind="warning" data-testid="plan-belowlist">
                      {t("admin.plan.step.belowlist")}
                    </InlineAlert>
                  }
                >
                  <TextArea
                    name="reason"
                    label={`${t("admin.plan.step.reason")} *`}
                    value={reason()}
                    counter={t("admin.common.min.chars", { n: reason().trim().length, min: MIN_REASON })}
                    onInput={(e: InputEvent) => setReason((e.currentTarget as HTMLTextAreaElement).value)}
                    data-testid="plan-reason"
                  />
                </Show>
              </Show>
            </Show>
          </Show>
          <Show when={error()}>
            <InlineAlert kind={error() === "admin.write.unknown" ? "warning" : "danger"} data-testid="plan-submit-error">
              {t(error() ?? "")}
            </InlineAlert>
          </Show>
          <div class="hy-actions">
            <a class="hy-btn hy-linkbutton" href={orgPath(ROUTES.stepGstin, params.orgId)} data-testid="plan-back">
              {t("admin.common.back")}
            </a>
            <Button data-testid="plan-skip" onClick={next}>
              {t("admin.plan.step.skip")}
            </Button>
            <Button type="submit" variant="primary" disabled={!valid() || busy() || (guard.disabled() && error() !== "admin.write.unknown")} title={guard.title()} data-testid="plan-save">
              {t("admin.plan.step.save")}
            </Button>
          </div>
        </form>
      </Show>
      <Show when={props.current() || saved() || !canStart()}>
        <div class="hy-actions">
          <Button variant="primary" data-testid="plan-continue" onClick={next}>
            {t("admin.plan.step.continue")}
          </Button>
        </div>
      </Show>
    </>
  );
}
