import { createContext, useContext } from "solid-js";
import type { components } from "../generated";
import type { AdminSession, SupportSessionInfo } from "../session/session";
import type { AdminApi } from "./client";

export const ApiContext = createContext<AdminApi>();

export function useApi(): AdminApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext is missing");
  return api;
}

type Schemas = components["schemas"];

export function toSupportInfo(s: Schemas["SupportSession"], organisationName?: string): SupportSessionInfo {
  return {
    id: s.id,
    organisationId: s.organisation_id,
    ticketReference: s.ticket_reference,
    endsAt: s.ends_at,
    ...(organisationName ? { organisationName } : {}),
  };
}

/** What the browser keeps of the server's session: names, permissions, CSRF token, limits. Never a bearer token. */
export function toSession(a: Schemas["AdminSession"]): AdminSession {
  return {
    name: a.user.display_name,
    userId: a.user.id,
    permissions: a.user.permissions,
    expiresAt: a.absolute_expires_at,
    csrfToken: a.csrf_token,
    idleTimeoutSeconds: a.idle_timeout_seconds,
    ...(a.support_session && a.support_session.status === "active" ? { support: toSupportInfo(a.support_session) } : {}),
  };
}
