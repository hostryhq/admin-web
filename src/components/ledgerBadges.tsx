import type { JSX } from "@solidjs/web";
import { StatusBadge, useI18n, type BadgeKind } from "@hostry/ui-kit";
import type { components } from "../generated";

type S = components["schemas"];

const CHARGE: Record<S["ChargeStatus"], BadgeKind> = { open: "info", paid: "success", waived: "neutral", cancelled: "neutral" };
/** Status as icon plus text (never colour alone). "Part paid" is an open charge with something paid. */
export function ChargeStatusBadge(props: { status: S["ChargeStatus"]; partPaid?: boolean }): JSX.Element {
  const { t } = useI18n();
  const key = () => (props.status === "open" && props.partPaid ? "part" : props.status);
  return <StatusBadge kind={key() === "part" ? "warning" : CHARGE[props.status]} label={t(`admin.charges.status.${key()}`)} data-testid={`badge-charge-${key()}`} />;
}

export function OverdueChip(props: { days: number }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind="warning" label={t("admin.charges.overdue", { n: props.days })} data-testid="badge-overdue" />;
}

const PLAN: Record<S["PlanVersionState"], BadgeKind> = { draft: "neutral", active: "success", retired: "warning" };
export function PlanStateBadge(props: { state: S["PlanVersionState"] }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind={PLAN[props.state]} label={t(`admin.plans.state.${props.state}`)} data-testid={`badge-plan-${props.state}`} />;
}

const SUB: Record<S["SubscriptionState"], BadgeKind> = { pilot: "info", active: "success", cancelled: "neutral" };
export function SubscriptionStateBadge(props: { state: S["SubscriptionState"] }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind={SUB[props.state]} label={t(`admin.sub.state.${props.state}`)} data-testid={`badge-sub-${props.state}`} />;
}

const APPROVAL: Record<S["VendorApproval"]["state"], BadgeKind> = {
  pending: "info",
  approved: "warning",
  completed: "success",
  rejected: "danger",
  expired: "neutral",
  cancelled: "neutral",
};
export function ApprovalStateBadge(props: { state: S["VendorApproval"]["state"]; executable: boolean }): JSX.Element {
  const { t } = useI18n();
  const key = () => (props.state === "approved" && props.executable ? "approved_waiting" : props.state);
  return <StatusBadge kind={APPROVAL[props.state]} label={t(`admin.approvals.state.${key()}`)} data-testid={`badge-approval-${props.state}`} />;
}

export function RuleSetStateBadge(props: { state: S["TaxRuleSetMaster"]["state"]; reviewed: boolean; pending?: boolean }): JSX.Element {
  const { t } = useI18n();
  const key = () => (props.pending ? "pending" : props.state === "published" && !props.reviewed ? "unreviewed" : props.state);
  const kind: BadgeKind = key() === "published" ? "success" : key() === "signed" ? "info" : key() === "pending" ? "warning" : key() === "unreviewed" ? "warning" : "neutral";
  return <StatusBadge kind={kind} label={t(`admin.tax.state.${key()}`)} data-testid={`badge-ruleset-${key()}`} />;
}
