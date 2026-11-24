import { createSignal, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, Card, InlineAlert, Input, OtpField, PasswordField, useI18n } from "@hostry/ui-kit";

export type Credentials = { email: string; password: string; code: string };

/**
 * Presentational sign-in form (screen 1). It never says which factor failed or whether the email
 * exists (BR-3): one generic error for every failure. On failure the email stays, password and
 * code are cleared, and focus returns to the email field with the alert announced (AC 4).
 * `onSubmit` resolves true on success. The real call is wired in the next wave.
 */
export function SignInForm(props: {
  onSubmit: (credentials: Credentials) => Promise<boolean>;
  /** Offline or unreachable: the button is disabled (the shell banner explains why). */
  disabled?: boolean;
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
      <form ref={form} onSubmit={submit} class="hy-stack" novalidate>
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
 * Route component for screen 1. No real authentication yet: the submit handler reports a failure,
 * so the generic error path is exercised until the session API exists (next wave).
 */
export function SignIn(): JSX.Element {
  return <SignInForm onSubmit={async () => false} />;
}
