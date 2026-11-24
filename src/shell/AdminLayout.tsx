import { createContext, createEffect, createMemo, createSignal, For, onSettled, Show, useContext } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useLocation, useNavigate, useRouteMatches } from "@solidjs/router";
import {
  AppShell,
  Button,
  Dialog,
  NavBar,
  OfflineBanner,
  ToastRegion,
  toasts,
  useI18n,
  type NavItem,
} from "@hostry/ui-kit";
import { NAV, ROUTES, type RouteMeta } from "../routes";
import { Forbidden } from "../screens/Forbidden";
import { hasPermission, SessionContext } from "../session/session";
import { createConnectivity, type Connectivity } from "./connectivity";
import { createIdleTimer } from "./idle";
import { createShortcutHandler, SHORTCUTS } from "./shortcuts";

export const ConnectivityContext = createContext<Connectivity>();

/**
 * Root layout (the router's render-prop child). Owns everything that is on every screen:
 * navigation (items without permission are absent), offline banner, idle warning, toasts,
 * keyboard shortcuts and the shortcut sheet, the document title and focus on page change.
 */
export function AdminLayout(props: { children?: JSX.Element }): JSX.Element {
  const { t } = useI18n();
  const state = useContext(SessionContext);
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useRouteMatches();
  const [helpOpen, setHelpOpen] = createSignal(false);

  const meta = createMemo(() => matches().at(-1)?.route.info as RouteMeta | undefined);
  const isPublic = () => meta()?.public === true;
  const session = () => state.session();
  const can = (need: string | readonly string[] | undefined) => hasPermission(session(), need);

  const connectivity = createConnectivity({ onBackOnline: () => toasts.show(t("admin.offline.back")) });

  const idle = createIdleTimer({
    enabled: () => session() !== undefined && !isPublic(),
    absoluteAt: () => {
      const at = session()?.expiresAt;
      return at ? Date.parse(at) : undefined;
    },
    onExpire: (reason) => {
      state.setSession(undefined);
      navigate(`${ROUTES.sessionEnded.path}?reason=${reason}`, { replace: true });
    },
  });
  // A new session starts a fresh idle clock.
  createEffect(
    () => session(),
    () => idle.reset(),
  );

  // Signed-out users only see public pages.
  createEffect(
    () => ({ authed: session() !== undefined, pub: isPublic() }),
    ({ authed, pub }) => {
      if (!authed && !pub) navigate(ROUTES.signin.path, { replace: true });
    },
  );

  createEffect(
    () => meta(),
    (m) => {
      document.title = m ? `${t(m.titleKey)} - ${t("admin.app.name")}` : t("admin.app.name");
    },
  );

  // Move focus to the page heading after navigating so screen reader and keyboard users start at the top.
  createEffect(
    () => location.pathname,
    () => {
      setTimeout(() => document.querySelector<HTMLElement>("[data-testid='page-title']")?.focus(), 0);
    },
    { defer: true },
  );

  const shortcut = createShortcutHandler({
    can: (need) => can(need),
    navigate: (path) => navigate(path),
    focusSearch: () => {
      const el = document.querySelector<HTMLElement>("[data-shortcut='search']");
      el?.focus();
      return el !== null;
    },
    openHelp: () => setHelpOpen(true),
    dialogOpen: () => document.querySelector("[role='dialog']") !== null,
    supportSessionActive: () => false, // wired with the support session in the next wave
    endSupportSession: () => undefined,
  });
  onSettled(() => {
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  const navItems = (): NavItem[] =>
    NAV.filter((n) => can(n.permission)).map((n) => ({
      id: n.id,
      label: t(n.labelKey),
      href: n.path,
    }));

  const signOut = () => {
    state.setSession(undefined);
    navigate(ROUTES.signin.path, { replace: true });
  };

  const header = () => (
    <NavBar
      label={t("admin.nav.label")}
      items={navItems()}
      currentId={meta()?.navId}
      brand={<span data-testid="nav-brand">{t("admin.app.name")}</span>}
      end={
        <>
          <span class="hy-nav__user" data-testid="nav-user">
            {t("admin.nav.user", { name: session()?.name ?? "" })}
          </span>
          <Button data-testid="nav-shortcuts" onClick={() => setHelpOpen(true)}>
            {t("admin.nav.shortcuts")}
          </Button>
          <Button data-testid="nav-signout" onClick={signOut}>
            {t("admin.nav.signout")}
          </Button>
        </>
      }
    />
  );

  return (
    <ConnectivityContext value={connectivity}>
      <AppShell
        {...(isPublic() ? {} : { header: header() })}
        banners={<OfflineBanner reason={connectivity.reason()} />}
      >
        <Show when={isPublic() || session() !== undefined}>
          <Show when={isPublic() || can(meta()?.permission)} fallback={<Forbidden />}>
            <div class={isPublic() ? "app-center" : "app-page"}>{props.children}</div>
          </Show>
        </Show>
      </AppShell>

      <Dialog
        open={idle.state() === "warning"}
        title={t("admin.session.warn.title")}
        onClose={idle.stay}
        data-testid="idle-dialog"
      >
        <p data-testid="idle-message">{t("admin.session.warn", { n: idle.minutesLeft() })}</p>
        <Button variant="primary" data-autofocus data-testid="idle-stay" onClick={idle.stay}>
          {t("admin.session.stay")}
        </Button>
      </Dialog>

      <Dialog open={helpOpen()} title={t("admin.shortcuts.title")} onClose={() => setHelpOpen(false)} data-testid="shortcuts-dialog">
        <ul class="hy-shortcuts">
          <For each={SHORTCUTS.filter((s) => can(s.need))}>
            {(s) => (
              <li>
                <kbd>{s.keys}</kbd> <span>{t(s.labelKey)}</span>
              </li>
            )}
          </For>
        </ul>
      </Dialog>
      <ToastRegion />
    </ConnectivityContext>
  );
}
