import { createSignal, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { uuidv7 } from "@hostry/client-core";
import { Button, DataTable, Dialog, InlineAlert, Input, PageHeader, StatusBadge, toasts, useI18n, type BadgeKind, type Column } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import type { components } from "../generated";
import { outcome } from "../api/outcome";
import { createPaged } from "../api/query";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Empty, ErrorState, StaleTag, useWriteGuard } from "../components/common";
import { Select } from "../components/fields";
import { formKeys, newIntentKey } from "../components/formkeys";
import { SessionContext } from "../session/session";

type User = components["schemas"]["VendorUser"];
type Role = components["schemas"]["VendorRole"];
const ROLES: Role[] = ["platform_admin", "onboarding", "support", "billing"];
const STATUS_KIND: Record<User["status"], BadgeKind> = { active: "success", setup_pending: "info", deactivated: "neutral" };
type Pending = { kind: "role" | "deactivate" | "totp"; user: User };

/**
 * Screen 4 (vendor staff, AM13; shown only to `admin.user.manage`). Lists name, email, role and state;
 * create, change role, deactivate and reset TOTP. A setup link is never shown here or anywhere: it
 * goes out through the email sender (AC 68, 69). The own row and the last active platform admin have
 * no deactivate or role change (AC 11); the server refuses them too.
 *
 * Gap: the contract's staff record has no last sign-in or "can approve from" date, so those two
 * columns of AC 69 are not shown until the API carries them.
 */
export function VendorStaff(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const state = useContext(SessionContext);
  const guard = useWriteGuard();
  const [pending, setPending] = createSignal<Pending | undefined>();
  const [inviteOpen, setInviteOpen] = createSignal(false);

  const list = createPaged(
    () => "staff",
    (_k, cursor) => outcome(api.GET("/v1/vendor-users", { params: { query: { limit: 100, ...(cursor ? { cursor } : {}) } } })),
  );
  const rows = () => list.rows();
  const activeAdmins = () => rows().filter((u) => u.role === "platform_admin" && u.status === "active").length;
  const isYou = (u: User) => u.id === state.session()?.userId;
  const lastAdmin = (u: User) => u.role === "platform_admin" && u.status === "active" && activeAdmins() <= 1;

  const done = (msg: string) => {
    setPending(undefined);
    toasts.show(t(msg));
    list.first.reload();
  };

  const columns: Column<User>[] = [
    { id: "name", header: t("admin.staff.col.name"), cell: (u) => (isYou(u) ? `${u.display_name} (${t("admin.staff.you")})` : u.display_name) },
    { id: "email", header: t("admin.staff.col.email"), cell: (u) => u.email },
    { id: "role", header: t("admin.staff.col.role"), cell: (u) => t(`admin.staff.role.${u.role}`) },
    { id: "status", header: t("admin.staff.col.status"), cell: (u) => <StatusBadge kind={STATUS_KIND[u.status]} label={t(`admin.staff.status.${u.status}`)} data-testid={`staff-status-${u.status}`} /> },
    {
      id: "actions",
      header: t("admin.staff.col.actions"),
      cell: (u) => (
        <span class="hy-actions">
          <Show when={u.status === "active" && !isYou(u) && !lastAdmin(u)}>
            <Button disabled={guard.disabled()} data-testid={`staff-role-${u.id}`} onClick={() => setPending({ kind: "role", user: u })}>
              {t("admin.staff.changerole")}
            </Button>
          </Show>
          <Show when={u.status === "active" && !isYou(u)}>
            <Button disabled={guard.disabled()} data-testid={`staff-totp-${u.id}`} onClick={() => setPending({ kind: "totp", user: u })}>
              {t("admin.staff.resettotp")}
            </Button>
          </Show>
          <Show when={u.status === "active" && !isYou(u) && !lastAdmin(u)}>
            <Button variant="danger" disabled={guard.disabled()} data-testid={`staff-deactivate-${u.id}`} onClick={() => setPending({ kind: "deactivate", user: u })}>
              {t("admin.staff.deactivate")}
            </Button>
          </Show>
        </span>
      ),
    },
  ];

  const errorKey = (code: string | undefined, status: number) =>
    code === "last_platform_admin" ? "admin.staff.lastadmin" : code === "cannot_deactivate_self" ? "admin.staff.self" : status === 403 ? "admin.error.forbidden" : "admin.error.generic";

  const patch = async (u: User, body: components["schemas"]["UpdateVendorUser"], msg: string) => {
    const r = await outcome(
      api.PATCH("/v1/vendor-users/{vendor_user_id}", { params: { path: { vendor_user_id: u.id }, header: mut() }, body }),
    );
    if (r.ok) {
      done(msg);
      return undefined;
    }
    return errorKey(r.failure.code, r.failure.status);
  };

  return (
    <>
      <PageHeader
        title={t("admin.staff.title")}
        actions={
          <Button variant="primary" disabled={guard.disabled()} title={guard.title()} data-testid="staff-invite" onClick={() => setInviteOpen(true)}>
            {t("admin.staff.invite")}
          </Button>
        }
      />
      <StaleTag at={list.first.loadedAt()} />
      <Show when={list.first.failure() && !list.first.data()}>
        <ErrorState failure={list.first.failure()} onRetry={list.first.reload} data-testid="staff-error" />
      </Show>
      <Show when={!list.first.failure() || list.first.data()}>
        <DataTable
          caption={t("admin.staff.title")}
          columns={columns}
          rows={rows()}
          rowKey={(u) => u.id}
          loading={list.first.loading() && !list.first.data()}
          empty={<Empty title={t("admin.staff.empty")} data-testid="staff-empty" />}
          data-testid="staff-table"
        />
      </Show>
      <Show when={list.hasMore()}>
        <p>
          <Button disabled={list.moreBusy()} onClick={list.more} data-testid="staff-more">
            {t("admin.common.more")}
          </Button>
        </p>
      </Show>
      <p class="hy-hint">{t("admin.staff.nolink")}</p>

      <Show when={pending()?.kind === "deactivate"}>
        <ConfirmDialog
          open
          title={t("admin.staff.deactivate")}
          body={t("admin.staff.deactivate.effect", { name: pending()?.user.display_name ?? "" })}
          confirmLabel={t("admin.staff.deactivate")}
          danger
          onClose={() => setPending(undefined)}
          run={() => patch(pending()!.user, { status: "deactivated" }, "admin.staff.deactivated")}
          data-testid="staff-deactivate-dialog"
        />
      </Show>
      <Show when={pending()?.kind === "totp"}>
        <ConfirmDialog
          open
          title={t("admin.staff.resettotp")}
          body={t("admin.staff.resettotp.effect", { name: pending()?.user.display_name ?? "" })}
          confirmLabel={t("admin.staff.resettotp")}
          onClose={() => setPending(undefined)}
          run={async () => {
            const u = pending()!.user;
            const r = await outcome(api.POST("/v1/vendor-users/{vendor_user_id}/totp-resets", { params: { path: { vendor_user_id: u.id }, header: mut() } }));
            if (r.ok) {
              done("admin.staff.totpreset");
              return undefined;
            }
            return errorKey(r.failure.code, r.failure.status);
          }}
          data-testid="staff-totp-dialog"
        />
      </Show>
      <Show when={pending()?.kind === "role"}>
        <RoleDialog user={pending()!.user} onClose={() => setPending(undefined)} onSave={(role) => patch(pending()!.user, { role }, "admin.staff.rolechanged")} />
      </Show>
      <Dialog open={inviteOpen()} title={t("admin.staff.invite")} onClose={() => setInviteOpen(false)} data-testid="staff-invite-dialog">
        <InviteForm
          onClose={() => setInviteOpen(false)}
          onDone={() => {
            setInviteOpen(false);
            toasts.show(t("admin.staff.invited"));
            list.first.reload();
          }}
        />
      </Dialog>
    </>
  );
}

function RoleDialog(props: { user: User; onClose: () => void; onSave: (role: Role) => Promise<string | undefined> }): JSX.Element {
  const { t } = useI18n();
  const [role, setRole] = createSignal<Role>(props.user.role);
  return (
    <ConfirmDialog
      open
      title={t("admin.staff.changerole")}
      body={t("admin.staff.role.effect", { name: props.user.display_name })}
      confirmLabel={t("admin.common.save")}
      onClose={props.onClose}
      run={() => (role() === props.user.role ? Promise.resolve("admin.staff.role.same") : props.onSave(role()))}
      data-testid="staff-role-dialog"
    >
      <Select
        name="role"
        label={t("admin.staff.col.role")}
        options={ROLES.map((r) => ({ value: r, label: t(`admin.staff.role.${r}`) }))}
        value={role()}
        onChange={(e: Event) => setRole((e.currentTarget as HTMLSelectElement).value as Role)}
        data-testid="staff-role-select"
      />
    </ConfirmDialog>
  );
}

function InviteForm(props: { onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const guard = useWriteGuard();
  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal<Role>("support");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();
  // The id is client-generated and doubles as the retry identity of this invite (same body, same key).
  const id = uuidv7();
  const key = newIntentKey();
  const valid = () => name().trim().length > 0 && /^\S+@\S+\.\S+$/.test(email().trim());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || guard.disabled()) return;
    setBusy(true);
    setError(undefined);
    const r = await outcome(
      api.POST("/v1/vendor-users", {
        params: { header: mut(key) },
        body: { id, email: email().trim(), display_name: name().trim(), role: role() },
      }),
    );
    setBusy(false);
    if (r.ok) props.onDone();
    else setError(r.failure.code === "vendor_user_conflict" || r.failure.status === 409 ? "admin.staff.email.used" : r.failure.status === 403 ? "admin.error.forbidden" : "admin.error.generic");
  };

  return (
    <form class="hy-stack" method="post" onSubmit={submit} onKeyDown={formKeys} novalidate>
      <Input name="name" required autocomplete="off" label={`${t("admin.staff.col.name")} *`} value={name()} onInput={(e: InputEvent) => setName((e.currentTarget as HTMLInputElement).value)} data-autofocus data-testid="staff-name" />
      <Input name="email" type="email" required autocomplete="off" label={`${t("admin.staff.col.email")} *`} value={email()} onInput={(e: InputEvent) => setEmail((e.currentTarget as HTMLInputElement).value)} data-testid="staff-email" />
      <Select
        name="role"
        label={t("admin.staff.col.role")}
        options={ROLES.map((r) => ({ value: r, label: t(`admin.staff.role.${r}`) }))}
        value={role()}
        onChange={(e: Event) => setRole((e.currentTarget as HTMLSelectElement).value as Role)}
        data-testid="staff-new-role"
      />
      <p class="hy-hint">{t("admin.staff.nolink")}</p>
      <Show when={error()}>
        <InlineAlert kind="danger" data-testid="staff-invite-error">
          {t(error() ?? "")}
        </InlineAlert>
      </Show>
      <div class="hy-actions">
        <Button onClick={props.onClose} data-testid="staff-invite-cancel">
          {t("admin.common.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid() || busy() || guard.disabled()} data-testid="staff-invite-submit">
          {t("admin.staff.invite.submit")}
        </Button>
      </div>
    </form>
  );
}
