import { createSignal, Match, onSettled, Show, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useNavigate } from "@solidjs/router";
import { Button, Card, InlineAlert, OtpField, PasswordField, useI18n } from "@hostry/ui-kit";
import { useApi } from "../api/context";
import { idem } from "../api/headers";
import { outcome } from "../api/outcome";
import { ROUTES } from "../routes";
import { useConnectivity } from "../shell/connectivity";

export const MIN_PASSWORD_LENGTH = 12;

/** The base32 secret inside an `otpauth://` URI, for "Cannot scan? Enter this key". */
export function secretFromUri(uri: string): string | undefined {
  const m = /[?&]secret=([A-Za-z2-7]+)/.exec(uri);
  const raw = m?.[1];
  return raw ? (raw.toUpperCase().match(/.{1,4}/g) ?? []).join(" ") : undefined;
}

type Stage = { kind: "checking" } | { kind: "invalid" } | { kind: "form"; email: string; key: string | undefined };

/**
 * Screen 2. The setup link carries its token in the URL fragment (`/setup#<token>`), which the
 * browser never sends to a server or puts in a referrer. The token is read once, removed from the
 * address bar, and held in memory only. A used, expired or unknown link shows one generic page that
 * reveals no reason (AC 5, 6).
 *
 * No QR image yet: the QR component is a ui-kit item not built; staff enter the key by hand.
 */
export function SetupAccount(): JSX.Element {
  const { t } = useI18n();
  const api = useApi();
  const navigate = useNavigate();
  const conn = useConnectivity();

  const [stage, setStage] = createSignal<Stage>({ kind: "checking" });
  const [password, setPassword] = createSignal("");
  const [repeat, setRepeat] = createSignal("");
  const [code, setCode] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let token = "";

  onSettled(() => {
    token = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    // The token must not stay in the address bar, history or a copied URL.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (!token) {
      setStage({ kind: "invalid" });
      return;
    }
    void outcome(api.POST("/v1/account-setups", { params: { header: idem() }, body: { setup_token: token } })).then((r) => {
      if (!r.ok) {
        setStage({ kind: "invalid" });
        return;
      }
      setStage({ kind: "form", email: r.data.email, key: secretFromUri(r.data.totp_provisioning_uri) });
    });
  });

  const email = () => {
    const s = stage();
    return s.kind === "form" ? s.email : "";
  };
  const manualKey = () => {
    const s = stage();
    return s.kind === "form" ? s.key : undefined;
  };
  const errors = () => {
    const out: { password?: string; repeat?: string } = {};
    if (password() !== "" && password().length < MIN_PASSWORD_LENGTH) out.password = t("admin.setup.password.rule");
    else if (password() !== "" && password().toLowerCase() === email().toLowerCase()) out.password = t("admin.setup.password.email");
    if (repeat() !== "" && repeat() !== password()) out.repeat = t("admin.setup.mismatch");
    return out;
  };
  const valid = () =>
    password().length >= MIN_PASSWORD_LENGTH &&
    password().toLowerCase() !== email().toLowerCase() &&
    repeat() === password() &&
    /^[0-9]{6}$/.test(code());

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy() || !valid() || conn.writesDisabled()) return;
    setBusy(true);
    setFailed(false);
    const r = await outcome(
      api.POST("/v1/account-setup-completions", { params: { header: idem() }, body: { setup_token: token, password: password(), totp_code: code() } }),
    );
    setBusy(false);
    if (r.ok) {
      token = "";
      navigate(`${ROUTES.signin.path}?setup=done`, { replace: true });
      return;
    }
    if (r.failure.code === "setup_link_invalid" || r.failure.status === 404) {
      setStage({ kind: "invalid" });
      return;
    }
    setCode("");
    setFailed(true);
  };

  const title = () => (
    <h1 class="hy-card__title" tabindex="-1" data-testid="page-title">
      {t("admin.setup.title")}
    </h1>
  );

  return (
    <Switch>
      <Match when={stage().kind === "checking"}>
        <Card data-testid="setup-checking">
          {title()}
          <p aria-busy="true">{t("admin.common.loading")}</p>
        </Card>
      </Match>
      <Match when={stage().kind === "invalid"}>
        <Card data-testid="setup-invalid">
          {title()}
          <InlineAlert kind="danger">{t("admin.setup.link.invalid")}</InlineAlert>
        </Card>
      </Match>
      <Match when={stage().kind === "form"}>
        <Card data-testid="setup-card">
          <form method="post" class="hy-stack" onSubmit={submit} novalidate>
            {title()}
            <p class="hy-hint">{t("admin.setup.step1")}</p>
            <PasswordField
              name="new-password"
              autocomplete="new-password"
              required
              label={t("admin.setup.password")}
              error={errors().password}
              value={password()}
              onInput={(e: InputEvent) => setPassword((e.currentTarget as HTMLInputElement).value)}
              data-testid="setup-password"
            />
            <p class="hy-hint hy-num" data-testid="setup-length">
              {t("admin.setup.length", { n: password().length, min: MIN_PASSWORD_LENGTH })}
            </p>
            <PasswordField
              name="repeat-password"
              autocomplete="new-password"
              required
              label={t("admin.setup.repeat")}
              error={errors().repeat}
              value={repeat()}
              onInput={(e: InputEvent) => setRepeat((e.currentTarget as HTMLInputElement).value)}
              data-testid="setup-repeat"
            />
            <p class="hy-hint">{t("admin.setup.step2")}</p>
            <Show when={manualKey()}>
              <p data-testid="setup-key-block">
                {t("admin.setup.key.manual")}{" "}
                <code class="hy-num" data-testid="setup-key">
                  {manualKey()}
                </code>
              </p>
            </Show>
            <OtpField
              name="code"
              required
              label={t("admin.signin.code")}
              value={code()}
              onInput={(e: InputEvent) => setCode((e.currentTarget as HTMLInputElement).value)}
              data-testid="setup-code"
            />
            <Show when={failed()}>
              <InlineAlert kind="danger" data-testid="setup-error">
                {t("admin.setup.error")}
              </InlineAlert>
            </Show>
            <Button type="submit" variant="primary" disabled={!valid() || busy() || conn.writesDisabled()} data-testid="setup-submit">
              {t("admin.setup.submit")}
            </Button>
          </form>
        </Card>
      </Match>
    </Switch>
  );
}
