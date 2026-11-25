import { createSignal, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { I18nProvider, toasts, type Translator } from "@hostry/ui-kit";
import { createAdminApi } from "./api/client";
import { ApiContext, toSession } from "./api/context";
import { outcome } from "./api/outcome";
import type { AdminRouter } from "./router";
import { SessionContext, type SessionState } from "./session/session";
import { AdminLayout } from "./shell/AdminLayout";
import { ConnectivityContext, createConnectivity } from "./shell/connectivity";

/** A 401 on these is a normal answer (bad credentials, not signed in yet), not "the session ended". */
const PUBLIC_PATHS = new Set(["/v1/sessions", "/v1/sessions/current", "/v1/account-setups", "/v1/account-setup-completions"]);

/**
 * Providers plus the router. The API client is built here so it can feed connectivity (banner),
 * send the CSRF token from the session, and treat a 401 on a signed-in call as "session ended".
 * Everything else is injected so tests can use a memory history, a mock `fetch` and a fake session.
 * On start it asks the server whether the session cookie is still good before showing any page.
 */
export function App(props: {
  router: AdminRouter;
  session: SessionState;
  translator: Translator;
  /** Replaces `fetch` (tests, recorded mock). */
  fetch?: typeof fetch;
  baseUrl?: string;
}): JSX.Element {
  const connectivity = createConnectivity({ onBackOnline: () => toasts.show(props.translator.t("admin.offline.back")) });
  const api = createAdminApi({
    ...(props.fetch ? { fetch: props.fetch } : {}),
    ...(props.baseUrl ? { baseUrl: props.baseUrl } : {}),
    onReachable: connectivity.markReachable,
    onUnreachable: connectivity.markUnreachable,
    getCsrfToken: () => props.session.session()?.csrfToken,
    onUnauthorized: (path) => {
      if (!PUBLIC_PATHS.has(path)) props.session.expire("generic");
    },
  });

  const [restoring, setRestoring] = createSignal(props.session.session() === undefined);
  onSettled(() => {
    if (!restoring()) return;
    void outcome(api.GET("/v1/sessions/current")).then((r) => {
      if (r.ok) props.session.setSession(toSession(r.data));
      setRestoring(false);
    });
  });

  return (
    <I18nProvider value={props.translator}>
      <SessionContext value={props.session}>
        <ConnectivityContext value={connectivity}>
          <ApiContext value={api}>
            <Show when={!restoring()}>
              <props.router>{(p) => <AdminLayout>{p.children}</AdminLayout>}</props.router>
            </Show>
          </ApiContext>
        </ConnectivityContext>
      </SessionContext>
    </I18nProvider>
  );
}
