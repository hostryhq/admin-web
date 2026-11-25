import { createSignal, For, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useParams } from "@solidjs/router";
import { Button, Card, DataTable, DateField, InlineAlert, MoneyField, formatMoney, toasts, useI18n, type Column } from "@hostry/ui-kit";
import { useApi } from "../../api/context";
import { writeError } from "../../api/errors";
import { mut } from "../../api/headers";
import { outcome } from "../../api/outcome";
import { createQuery } from "../../api/query";
import { DescriptionList, Empty, ErrorState, SkeletonBlock, StaleTag } from "../../components/common";
import { addDays, daysBetween, fmtDate, todayIst } from "../../components/dates";
import { FormDialog } from "../../components/FormDialog";
import { RadioGroup, Select, TextArea } from "../../components/fields";
import { OverdueChip, SubscriptionStateBadge } from "../../components/ledgerBadges";
import { planName } from "../../components/plans";
import type { components } from "../../generated";
import { hasPermission, SessionContext } from "../../session/session";
import { MIN_REASON } from "../StartSupportDialog";
import { OrganisationFrame, type OrganisationView } from "../OrganisationFrame";
import { listPrice, sellable, type Sellable } from "./PlanStep";
import { overdueDays } from "./chargeView";
import { RaiseChargeDialog } from "./RaiseChargeDialog";
import { onShortcutEvent } from "./shortcutEvents";

type S = components["schemas"];
type Cycle = "monthly" | "annual";

/**
 * AS10: subscription tab (A1-S07, S08, S15, S16; AC 23 to 26, 36, 37, 54, 59). Buttons follow the
 * permissions: support sees none (AC 54, 59). The overdue label is information for staff and nothing
 * here suspends or lapses anything (AC 57). A pilot shows "no charges".
 */
export function OrgSubscription(): JSX.Element {
  return <OrganisationFrame tab="subscription">{(view, reload) => <Tab view={view} reload={reload} />}</OrganisationFrame>;
}

function Tab(props: { view: () => OrganisationView; reload: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const params = useParams<{ orgId: string }>();
  const state = useContext(SessionContext);
  const can = (p: string) => hasPermission(state.session(), p);
  const [raising, setRaising] = createSignal(false);
  const [changing, setChanging] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);

  const sub = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}/subscription", { params: { path: { organisation_id: id } } })),
  );
  const plans = createQuery(
    () => "plans",
    () => outcome(api.GET("/v1/plans", { params: { query: { limit: 100 } } })),
  );
  const open = createQuery(
    () => params.orgId,
    (id) => outcome(api.GET("/v1/organisations/{organisation_id}/charges", { params: { path: { organisation_id: id }, query: { status: "open", limit: 100 } } })),
  );
  const current = () => sub.data()?.current;
  const today = todayIst();
  const oldestOverdue = () =>
    Math.max(0, ...(open.data()?.items ?? []).map((c) => overdueDays(c, today, daysBetween)));
  const versionOf = (s: S["Subscription"]) => plans.data()?.items.find((p) => p.key === s.plan_key)?.versions.find((v) => v.version === s.plan_version);
  const planOf = (s: S["Subscription"]) => plans.data()?.items.find((p) => p.key === s.plan_key);
  const included = (s: S["Subscription"]) => versionOf(s)?.included_outlets;
  const newer = (s: S["Subscription"]) => {
    const p = planOf(s);
    return p?.versions.some((v) => v.state === "active" && v.version > s.plan_version) || versionOf(s)?.state === "retired";
  };
  const canManage = () => can("admin.subscription.manage");
  const canChange = () => canManage() || (can("admin.subscription.start") && current()?.state === "pilot");

  onShortcutEvent("raise-charge", () => {
    if (canManage() && current() && current()?.cycle !== "none") setRaising(true);
  });

  const nextDue = () => {
    const s = current();
    return s?.paid_through ? fmtDate(addDays(s.paid_through, -7)) : undefined;
  };

  const history: Column<S["Subscription"]>[] = [
    { id: "plan", header: t("admin.sub.plan"), cell: (s) => `${s.plan_key} v${s.plan_version}` },
    { id: "cycle", header: t("admin.sub.cycle"), cell: (s) => t(`admin.sub.cycle.${s.cycle}`) },
    { id: "agreed", header: t("admin.sub.agreed"), numeric: true, cell: (s) => formatMoney(s.agreed_price.amount_paise) },
    { id: "started", header: t("admin.sub.started"), cell: (s) => fmtDate(s.start_date) },
    { id: "state", header: t("admin.sub.history.state"), cell: (s) => <SubscriptionStateBadge state={s.state} /> },
  ];

  return (
    <div class="hy-stack" data-testid="org-subscription">
      <StaleTag at={sub.loadedAt()} />
      <Show when={sub.loading() && !sub.data()}>
        <SkeletonBlock rows={4} data-testid="sub-loading" />
      </Show>
      <Show when={sub.failure() && !sub.data()}>
        <ErrorState failure={sub.failure()} onRetry={sub.reload} data-testid="sub-error" />
      </Show>
      <Show when={sub.data()}>
        <Show
          when={current()}
          fallback={
            <Empty title={t("admin.sub.none")} data-testid="sub-empty">
              <Show when={can("admin.subscription.start")}>
                <a class="hy-btn hy-btn--primary hy-linkbutton" href={`/organisations/${params.orgId}/onboarding/plan`} data-testid="sub-assign">
                  {t("admin.sub.assign")}
                </a>
              </Show>
            </Empty>
          }
        >
          {(s) => (
            <Card title={t("admin.sub.title")}>
              <div class="hy-actions" data-testid="sub-badges">
                <SubscriptionStateBadge state={s().state} />
                <Show when={oldestOverdue() > 0}>
                  <OverdueChip days={oldestOverdue()} />
                </Show>
              </div>
              <DescriptionList
                rows={[
                  { label: t("admin.sub.plan"), value: `${planName(t, planOf(s()) ?? { key: s().plan_key, name_key: `plan.${s().plan_key}` })} v${s().plan_version}`, testid: "sub-plan" },
                  { label: t("admin.sub.cycle"), value: t(`admin.sub.cycle.${s().cycle}`), testid: "sub-cycle" },
                  ...(s().cycle === "none"
                    ? []
                    : [
                        {
                          label: t("admin.sub.agreed"),
                          value: <span class="hy-num">{formatMoney(s().agreed_price.amount_paise)}</span>,
                          testid: "sub-agreed",
                        },
                        { label: t("admin.sub.paidthrough"), value: s().paid_through ? fmtDate(s().paid_through) : "-", testid: "sub-paidthrough" },
                      ]),
                  { label: t("admin.sub.started"), value: fmtDate(s().start_date) },
                  ...(s().addons.length > 0
                    ? [
                        {
                          label: t("admin.sub.addons"),
                          testid: "sub-addons",
                          value: (
                            <ul class="hy-list">
                              <For each={s().addons}>{(a) => <li>{`${a.name} x${a.quantity} ${formatMoney(a.agreed_price.amount_paise)}`}</li>}</For>
                            </ul>
                          ),
                        },
                      ]
                    : []),
                  ...(included(s()) !== undefined
                    ? [{ label: t("admin.sub.outlets", { n: props.view().outlets.length, limit: included(s()) ?? 0 }), value: "", testid: "sub-outlets" }]
                    : []),
                ]}
              />
              <Show when={s().outlets_over_limit}>
                <InlineAlert kind="warning" data-testid="sub-overlimit">
                  {t("admin.sub.overlimit")}
                </InlineAlert>
              </Show>
              <Show when={s().cycle === "none"}>
                <p class="hy-hint" data-testid="sub-pilot">
                  {t("admin.sub.nocharge")}
                </p>
              </Show>
              <Show when={nextDue() && s().state === "active"}>
                <p class="hy-hint" data-testid="sub-nextcharge">
                  {t("admin.sub.nextcharge", { date: nextDue() ?? "" })}
                </p>
              </Show>
              <Show when={s().cancel_at_period_end}>
                <InlineAlert kind="info" data-testid="sub-cancelpending">
                  {t("admin.sub.cancel.pending", { date: fmtDate(s().paid_through) })}
                </InlineAlert>
              </Show>
              <Show when={oldestOverdue() > 0}>
                <p class="hy-hint" data-testid="sub-overdue-note">
                  {t("admin.sub.overdue.note")}
                </p>
              </Show>
              <div class="hy-actions">
                <Show when={canManage() && s().cycle !== "none" && s().state !== "cancelled"}>
                  <Button variant="primary" data-testid="sub-raise" onClick={() => setRaising(true)}>
                    {t("admin.sub.raise")}
                  </Button>
                </Show>
                <Show when={canChange() && s().state !== "cancelled"}>
                  <Button data-testid="sub-change" onClick={() => setChanging(true)}>
                    {t(s().state === "pilot" ? "admin.sub.assignpaid" : "admin.sub.change")}
                  </Button>
                </Show>
                <Show when={canManage() && s().state === "active" && !s().cancel_at_period_end}>
                  <Button data-testid="sub-cancel" onClick={() => setCancelling(true)}>
                    {t("admin.sub.cancel")}
                  </Button>
                </Show>
                <Show when={canChange() && newer(s())}>
                  <Button data-testid="sub-moveversion" onClick={() => setChanging(true)}>
                    {t("admin.sub.moveversion")}
                  </Button>
                </Show>
              </div>
            </Card>
          )}
        </Show>
        <Show when={(sub.data()?.history ?? []).length > 0}>
          <Card title={t("admin.sub.history")}>
            <DataTable caption={t("admin.sub.history")} columns={history} rows={sub.data()?.history ?? []} rowKey={(s) => s.id} data-testid="sub-history" />
          </Card>
        </Show>
        <p class="hy-hint">{t("admin.sub.nosuspend")}</p>
      </Show>

      <Show when={raising()}>
        <RaiseChargeDialog
          open
          organisationId={params.orgId}
          subscription={current()}
          onClose={() => setRaising(false)}
          onDone={() => {
            open.reload();
            sub.reload();
          }}
        />
      </Show>
      <Show when={changing() && plans.data()}>
        <ChangeDialog
          organisationId={params.orgId}
          current={current()}
          choices={sellable(plans.data()?.items ?? [], t).paid}
          canAdjust={can("admin.subscription.adjust")}
          canManage={canManage()}
          onClose={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            sub.reload();
          }}
        />
      </Show>
      <Show when={cancelling()}>
        <CancelDialog
          organisationId={params.orgId}
          paidThrough={current()?.paid_through}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            sub.reload();
          }}
        />
      </Show>
    </div>
  );
}

function ChangeDialog(props: {
  organisationId: string;
  current: S["Subscription"] | undefined;
  choices: Sellable[];
  canAdjust: boolean;
  canManage: boolean;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const first = props.choices.find((c) => c.key === props.current?.plan_key) ?? props.choices[0];
  const [pick, setPick] = createSignal(first ? `${first.key}:${first.version}` : "");
  const [cycle, setCycle] = createSignal<Cycle>(props.current?.cycle === "annual" ? "annual" : "monthly");
  const [from, setFrom] = createSignal(props.current?.paid_through ? addDays(props.current.paid_through, 1) : todayIst());
  const [agreed, setAgreed] = createSignal<number | undefined>();
  const [reason, setReason] = createSignal("");
  const chosen = () => props.choices.find((c) => `${c.key}:${c.version}` === pick());
  const list = () => listPrice(chosen(), cycle());
  const price = () => agreed() ?? list();
  const below = () => price() !== undefined && list() !== undefined && (price() ?? 0) < (list() ?? 0);
  const valid = () => chosen() !== undefined && list() !== undefined && from() !== "" && (!below() || (props.canAdjust && reason().trim().length >= MIN_REASON));

  return (
    <FormDialog
      open
      title={t("admin.sub.change")}
      submitLabel={t("admin.sub.change.submit")}
      valid={valid()}
      onClose={props.onClose}
      data-testid="change-dialog"
      onSubmit={async (key) => {
        const sel = chosen();
        const r = await outcome(
          api.PUT("/v1/organisations/{organisation_id}/subscription", {
            params: { path: { organisation_id: props.organisationId }, header: mut(key) },
            body: {
              plan_key: sel?.key ?? "",
              plan_version: sel?.version ?? 0,
              cycle: cycle(),
              effective_from: from(),
              ...(props.canManage && agreed() !== undefined ? { agreed_price: { amount_paise: agreed() ?? 0, currency: "INR" as const } } : {}),
              ...(below() ? { reason: reason().trim() } : {}),
            },
          }),
        );
        if (!r.ok) return writeError(r.failure, { below_list: "admin.plan.step.error.belowlist" });
        toasts.show(t("admin.sub.changed"));
        props.onDone();
        return undefined;
      }}
    >
      <Show when={props.choices.length > 0} fallback={<Empty title={t("admin.plan.step.nonesellable")} data-testid="change-none" />}>
        <Select
          name="version"
          label={t("admin.plan.step.version")}
          value={pick()}
          options={props.choices.map((c) => ({ value: `${c.key}:${c.version}`, label: c.label }))}
          onChange={(e: Event) => {
            setPick((e.currentTarget as HTMLSelectElement).value);
            setAgreed(undefined);
          }}
          data-autofocus
          data-testid="change-version"
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
          data-testid="change-cycle"
        />
        <DateField label={t("admin.sub.change.from")} value={from()} onChange={setFrom} data-testid="change-from" />
        <Show when={props.canManage}>
          <MoneyField label={t("admin.plan.step.agreed")} valuePaise={price()} onChange={setAgreed} data-testid="change-agreed" />
        </Show>
        <Show when={below()}>
          <Show
            when={props.canAdjust}
            fallback={
              <InlineAlert kind="warning" data-testid="change-belowlist">
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
              data-testid="change-reason"
            />
          </Show>
        </Show>
        <p class="hy-hint">{t("admin.sub.change.note")}</p>
      </Show>
    </FormDialog>
  );
}

function CancelDialog(props: { organisationId: string; paidThrough: string | undefined; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  return (
    <FormDialog
      open
      title={t("admin.sub.cancel")}
      submitLabel={t("admin.sub.cancel")}
      onClose={props.onClose}
      data-testid="cancelsub-dialog"
      onSubmit={async (key) => {
        const r = await outcome(api.POST("/v1/organisations/{organisation_id}/subscription/cancellation", { params: { path: { organisation_id: props.organisationId }, header: mut(key) }, body: {} }));
        if (!r.ok) return writeError(r.failure);
        toasts.show(t("admin.sub.cancelled"));
        props.onDone();
        return undefined;
      }}
    >
      <p data-testid="cancelsub-body">{t("admin.sub.cancel.body", { date: fmtDate(props.paidThrough) })}</p>
    </FormDialog>
  );
}
