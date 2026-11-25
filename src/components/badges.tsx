import type { JSX } from "@solidjs/web";
import { StatusBadge, useI18n, type BadgeKind } from "@hostry/ui-kit";
import type { components } from "../generated";

type S = components["schemas"];

const ORG: Record<S["OrganisationStatus"], BadgeKind> = { trial: "info", active: "success", suspended: "warning", closed: "neutral" };
export function OrgStatusBadge(props: { status: S["OrganisationStatus"] }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind={ORG[props.status]} label={t(`admin.orgs.status.${props.status}`)} data-testid={`badge-org-${props.status}`} />;
}

const OWNER: Record<S["OwnerStatus"], BadgeKind> = {
  none: "neutral",
  pending: "info",
  accepted: "success",
  expired: "warning",
  cancelled: "neutral",
  unknown: "neutral",
};
export function OwnerStatusBadge(props: { status: S["OwnerStatus"] }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind={OWNER[props.status]} label={t(`admin.orgs.owner.${props.status}`)} data-testid={`badge-owner-${props.status}`} />;
}

const VERIFY: Record<S["DirectoryRegistration"]["verification_state"] | "not_required", BadgeKind> = {
  unverified: "warning",
  verified: "success",
  rejected: "danger",
  not_required: "neutral",
};
/** `unregistered` registrations have nothing to verify: "not required" (AC 73). */
export function VerificationBadge(props: { state: S["DirectoryRegistration"]["verification_state"]; regime: S["TaxRegime"] }): JSX.Element {
  const { t } = useI18n();
  const key = () => (props.regime === "unregistered" ? "not_required" : props.state);
  return <StatusBadge kind={VERIFY[key()]} label={t(`admin.registration.state.${key()}`)} data-testid={`badge-verification-${key()}`} />;
}

const DEVICE: Record<S["DeviceState"], BadgeKind> = { active: "success", revoked: "danger", drained: "warning", wiped: "neutral", lost: "warning" };
/** Distinct icon, colour and plain text for each state (AC 36). */
export function DeviceStateBadge(props: { state: S["DeviceState"] }): JSX.Element {
  const { t } = useI18n();
  return (
    <span class="hy-devicestate">
      <StatusBadge kind={DEVICE[props.state]} label={t(`admin.devices.state.${props.state}`)} data-testid={`badge-device-${props.state}`} />
      <span class="hy-hint">{t(`admin.devices.state.${props.state}.help`)}</span>
    </span>
  );
}

const INVITE: Record<S["InvitationStatus"], BadgeKind> = { pending: "info", accepted: "success", expired: "warning", cancelled: "neutral" };
export function InvitationBadge(props: { status: S["InvitationStatus"] }): JSX.Element {
  const { t } = useI18n();
  return <StatusBadge kind={INVITE[props.status]} label={t(`admin.invite.status.${props.status}`)} data-testid={`badge-invite-${props.status}`} />;
}
