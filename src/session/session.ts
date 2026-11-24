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
  /** Permission strings such as `admin.org.read`. Checks are on permissions, never role names. */
  permissions: readonly string[];
  /** RFC 3339 UTC. Absolute session limit (12 h); the idle limit is tracked separately. */
  expiresAt?: string;
};

/** `undefined` means signed out. */
export type SessionState = {
  session: () => AdminSession | undefined;
  setSession: (s: AdminSession | undefined) => void;
};

export const SessionContext = createContext<SessionState>();

export function createSessionState(initial?: AdminSession): SessionState {
  const [session, setSession] = createSignal<AdminSession | undefined>(initial);
  return { session, setSession };
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

/**
 * Development-only session so placeholder screens can be seen before real sign-in exists.
 * Dead-code eliminated from production builds (import.meta.env.DEV is false there).
 * Permissions come from VITE_DEV_PERMISSIONS (comma list); default is every A0 permission.
 */
export const ALL_A0_PERMISSIONS = [
  "admin.org.read",
  "admin.org.create",
  "admin.owner_invite.manage",
  "admin.device.read",
  "admin.device.revoke",
  "admin.audit.read",
  "admin.audit.read_own",
  "admin.user.manage",
  "admin.support.session.start",
] as const;

export function devSession(): AdminSession | undefined {
  if (!import.meta.env.DEV) return undefined;
  const env = import.meta.env.VITE_DEV_PERMISSIONS as string | undefined;
  const permissions = env === undefined ? [...ALL_A0_PERMISSIONS] : env.split(",").map((p) => p.trim()).filter(Boolean);
  return { name: "Dev user", permissions };
}
