import { useContext } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useApi } from "../api/context";
import { mut } from "../api/headers";
import { outcome } from "../api/outcome";
import { ROUTES } from "../routes";
import { SessionContext } from "../session/session";

/** `mm:ss` for the countdown; never negative. Western digits. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** The banner says "Ends soon" at 5 minutes remaining (text, not colour alone). */
export const ENDS_SOON_MS = 5 * 60_000;

export type EndedHow = "user" | "expired";

/** The ended page takes its facts from the query string: organisation name, how it ended, and when. */
export function endedPath(org: string | undefined, how: EndedHow, at: Date = new Date()): string {
  const q = new URLSearchParams({ how, at: at.toISOString(), ...(org ? { org } : {}) });
  return `${ROUTES.supportSessionEnded.path}?${q.toString()}`;
}

/**
 * Ending a support session, from the banner, the shortcut, or because it ran out or a read was
 * refused after expiry. All session data is dropped from the page (AC 56, 57).
 */
export function useSupportActions() {
  const api = useApi();
  const state = useContext(SessionContext);
  const navigate = useNavigate();

  const finish = (how: EndedHow) => {
    const org = state.session()?.support?.organisationName;
    state.setSupport(undefined);
    navigate(endedPath(org, how), { replace: true });
  };

  return {
    /** The user ends the session. The server's answer decides: a 401/403/409 means it is already over. */
    async end(): Promise<void> {
      const r = await outcome(api.DELETE("/v1/support-sessions/current", { params: { header: mut() } }));
      if (r.ok || r.failure.status === 409 || r.failure.status === 404) finish("user");
    },
    /** The countdown reached zero, or the server refused a read because the session has ended. */
    expired: () => finish("expired"),
  };
}
