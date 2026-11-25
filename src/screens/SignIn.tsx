import { createSignal, Show, useContext } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { Button, Card, InlineAlert, Input, OtpField, PasswordField, useI18n } from "@hostry/ui-kit";
import { toSession, useApi } from "../api/context";
import { idem } from "../api/headers";
import { outcome } from "../api/outcome";
import { HOME_PATH } from "../routes";
import { SessionContext } from "../session/session";
import { useConnectivity } from "../shell/connectivity";

export type Credentials = { email: string; password: string; code: string };

/**
 * Presentational sign-in form (screen 1). It never says which factor failed or whether the email
 * exists (BR-3): one generic error for every failure. On failure the email stays, password and
 * code are cleared, and focus returns to the email field with the alert announced (AC 4).
 * `onSubmit` resolves true on success.
 */
export function SignInForm(props: {
  onSubmit: (credentials: Credentials) => Promise<boolean>;
  /** Offline or unreachable: the button is disabled (the shell banner explains why). */
  disabled?: boolean;
  /** Account setup just finished: say so above the form. */
  setupDone?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [failed, setFailed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let form!: HTMLFormElement;

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || props.disabled) return;
    const data = new FormData(form);
    const credentials: Credentials = {
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      code: String(data.get("code") ?? ""),
    };
    setBusy(true);
    setFailed(false);
    let ok: boolean;
    try {
      ok = await props.onSubmit(credentials);
    } catch {
      ok = false;
    }
    setBusy(false);
    if (!ok) {
      setFailed(true);
      (form.elements.namedItem("password") as HTMLInputElement).value = "";
      (form.elements.namedItem("code") as HTMLInputElement).value = "";
      (form.elements.namedItem("email") as HTMLInputElement).focus();
    }
  };

  return (
    <Card data-testid="signin-card">
      <form ref={form} method="post" onSubmit={submit} class="hy-stack" novalidate>
        <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
          {t("admin.signin.title")}
        </h1>
        <Input
          name="email"
          type="email"
          autocomplete="username"
          required
          label={t("admin.signin.email")}
          data-testid="signin-email"
        />
        <PasswordField
          name="password"
          required
          label={t("admin.signin.password")}
          data-testid="signin-password"
        />
        <OtpField name="code" required label={t("admin.signin.code")} data-testid="signin-code" />
        <p class="hy-hint">{t("admin.signin.code.hint")}</p>
        <Show when={props.setupDone}>
          <InlineAlert kind="success" data-testid="signin-setup-done">
            {t("admin.signin.setup.done")}
          </InlineAlert>
        </Show>
        <Show when={failed()}>
          <InlineAlert kind="danger" data-testid="signin-error">
            {t("admin.signin.error")}
          </InlineAlert>
        </Show>
        <Button
          type="submit"
          variant="primary"
          disabled={busy() || props.disabled}
          data-testid="signin-submit"
        >
          {busy() ? t("admin.signin.submitting") : t("admin.signin.submit")}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Route component for screen 1. Posts email, password and code to the admin backend, which sets
 * the session cookie; the browser keeps only the session facts (name, permissions, CSRF token).
 * Every failure (wrong password, unknown email, wrong code, lock, server trouble) gives the one
 * generic error (AC 2, 3).
 */
export function SignIn(): JSX.Element {
  const api = useApi();
  const state = useContext(SessionContext);
  const navigate = useNavigate();
  const location = useLocation();
  const conn = useConnectivity();

  const onSubmit = async (c: Credentials): Promise<boolean> => {
    const r = await outcome(api.POST("/v1/sessions", { params: { header: idem() }, body: { email: c.email, password: c.password, totp_code: c.code } }));
    if (!r.ok) return false;
    state.setSession(toSession(r.data));
    state.clearEndReason();
    navigate(HOME_PATH, { replace: true });
    return true;
  };
  return <SignInForm onSubmit={onSubmit} disabled={conn.writesDisabled()} setupDone={new URLSearchParams(location.search).get("setup") === "done"} />;
}
