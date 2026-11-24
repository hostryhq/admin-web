import { createApiClient } from "@hostry/client-core";

export type AdminApiOptions = {
  /** Same origin by default: the admin backend serves this app and the API. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The server answered (any status): the network path works. */
  onReachable?: () => void;
  /** The request never reached a server (network error): feeds the "Cannot reach the server" banner. */
  onUnreachable?: () => void;
};

/**
 * Typed client over a generated `paths` type (from client-core/src/generated once `admin.yaml`
 * exists in api-specs). There is deliberately no access token here (ADR-0013 V6): the browser
 * sends its same-origin session cookie and the admin backend attaches tokens server side.
 * Mutations get an `Idempotency-Key` from client-core. Tenant is never sent.
 */
export function createAdminApi<Paths extends object>(options: AdminApiOptions = {}) {
  const base = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const tracked: typeof fetch = async (input, init) => {
    try {
      const res = await base(input, init);
      options.onReachable?.();
      return res;
    } catch (err) {
      if (err instanceof TypeError) options.onUnreachable?.();
      throw err;
    }
  };
  return createApiClient<Paths>({ baseUrl: options.baseUrl ?? "", fetch: tracked });
}
