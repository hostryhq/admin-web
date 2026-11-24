import type { JSX } from "@solidjs/web";
import { I18nProvider, type Translator } from "@hostry/ui-kit";
import type { AdminRouter } from "./router";
import { SessionContext, type SessionState } from "./session/session";
import { AdminLayout } from "./shell/AdminLayout";

/** Providers plus the router. Everything is injected so tests can use a memory history and a fake session. */
export function App(props: { router: AdminRouter; session: SessionState; translator: Translator }): JSX.Element {
  return (
    <I18nProvider value={props.translator}>
      <SessionContext value={props.session}>
        <props.router>{(p) => <AdminLayout>{p.children}</AdminLayout>}</props.router>
      </SessionContext>
    </I18nProvider>
  );
}
