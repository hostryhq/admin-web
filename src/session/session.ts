import { createContext, createSignal } from "solid-js";

/**
 * The vendor staff session as the browser sees it. There is no token in the browser (ADR-0013 V6):
 * the admin backend holds tokens and the browser carries a same-origin session cookie. This object
 * is what the backend reports about that session, for UI gating only. The server re-checks every
 * permission on every call; hiding a control is a convenience, not security.
 */
export type AdminSession = {
  /** Display name for the user menu. */
  name: string;
  /** RFC 3339 UTC: the account may approve from this moment (seven days after creation, ADR-0005 A2.3). */
  canApproveFrom?: string;
  /** Permission strings such as `admin.org.read`. Checks are on permissions, never role names. */
  permissions: readonly string[];
  /** RFC 3339 UTC. Absolute session limit (12 h); the idle limit is tracked separately. */
  expiresAt?: string;
  /** The signed-in vendor user's id (to recognise "you" in lists and own audit entries). */
  userId?: string;
  /** Per-session CSRF token. Held in memory only; never written to storage. */
  csrfToken?: string;
  /** Server idle limit in seconds (the shell mirrors it). */
  idleTimeoutSeconds?: number;
  /** The user's active support session, if any (per user, BR-47). */
  support?: SupportSessionInfo;
};

export type SupportSessionInfo = {
  id: string;
  organisationId: string;
  organisationName?: string;
  ticketReference: string;
  /** RFC 3339 UTC. */
  endsAt: string;
};

export type SessionEndReason = "idle" | "limit" | "generic";

/** `undefined` means signed out. */
export type SessionState = {
  session: () => AdminSession | undefined;
  setSession: (s: AdminSession | undefined) => void;
  /** Why the last session ended without the user signing out (read once by the shell, which shows screen 3). */
  endReason: () => SessionEndReason | undefined;
  /** The server ended the session (401 on a signed-in call): clear it and remember why. */
  expire: (reason: SessionEndReason) => void;
  clearEndReason: () => void;
  /** Update only the support-session part of the current session. */
  setSupport: (s: SupportSessionInfo | undefined) => void;
};

export const SessionContext = createContext<SessionState>();

export function createSessionState(initial?: AdminSession): SessionState {
  const [session, setSession] = createSignal<AdminSession | undefined>(initial);
  const [endReason, setEndReason] = createSignal<SessionEndReason | undefined>(undefined);
  return {
    session,
    setSession: (s) => setSession(s),
    endReason,
    expire: (reason) => {
      if (session() === undefined) return;
      setEndReason(reason);
      setSession(undefined);
    },
    clearEndReason: () => setEndReason(undefined),
    setSupport: (support) =>
      setSession((s) => {
        if (!s) return s;
        const next: AdminSession = { ...s };
        if (support) next.support = support;
        else delete next.support;
        return next;
      }),
  };
}

/** `need` may be one permission or a list meaning "any of" (for example audit read or read_own). */
export function hasPermission(
  session: Pick<AdminSession, "permissions"> | undefined,
  need: string | readonly string[] | undefined,
): boolean {
  if (need === undefined) return true;
  if (!session) return false;
  const list = typeof need === "string" ? [need] : need;
  return list.some((p) => session.permissions.includes(p));
}

/** Every A0 permission, for tests and fixtures. */
export const ALL_A0_PERMISSIONS = [
  "admin.org.read",
  "admin.org.create",
  "admin.owner_invite.manage",
  "admin.registration.verify",
  "admin.device.read",
  "admin.device.revoke",
  "admin.audit.read",
  "admin.audit.read_own",
  "admin.user.manage",
  "admin.support.session.start",
] as const;
