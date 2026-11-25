/**
 * Calls return a plain outcome so screens branch on facts (status, problem code, field errors)
 * and never on exception types. Messages shown to the user come from i18n keys chosen by the
 * screen; server text (`title`, `detail`) is never rendered.
 */
export type FieldError = { field: string; code: string; message?: string };

export type Failure = {
  /** HTTP status; 0 when the request never reached a server. */
  status: number;
  /** Problem `code` (RFC 9457 extension), e.g. `gstin_in_use`, `vendor_approval_required`. */
  code?: string;
  errors?: FieldError[];
  /** Network error: no answer at all. */
  network?: boolean;
};

export type Outcome<T> = { ok: true; status: number; data: T } | { ok: false; failure: Failure };

type Settled<D> = { data?: D; error?: unknown; response: Response };

function problem(error: unknown): { code?: string; errors?: FieldError[] } {
  if (typeof error !== "object" || error === null) return {};
  const e = error as { code?: unknown; errors?: unknown };
  return {
    ...(typeof e.code === "string" ? { code: e.code } : {}),
    ...(Array.isArray(e.errors) ? { errors: e.errors as FieldError[] } : {}),
  };
}

/** Wraps one openapi-fetch call. Never throws: a network failure becomes `{ ok:false, failure:{ network:true } }`. */
export async function outcome<D>(call: Promise<Settled<D>>): Promise<Outcome<D>> {
  try {
    const r = await call;
    if (r.response.ok) return { ok: true, status: r.response.status, data: r.data as D };
    return { ok: false, failure: { status: r.response.status, ...problem(r.error) } };
  } catch {
    return { ok: false, failure: { status: 0, network: true } };
  }
}

/** Field errors keyed by field path, first message code wins. */
export function fieldErrors(f: Failure): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of f.errors ?? []) if (!(e.field in out)) out[e.field] = e.code;
  return out;
}
