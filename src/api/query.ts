import { createEffect, createSignal } from "solid-js";
import type { Failure, Outcome } from "./outcome";

export type QueryState<T> =
  | { status: "idle" }
  | { status: "loading"; data?: T; loadedAt?: number }
  | { status: "ready"; data: T; loadedAt: number }
  | { status: "error"; failure: Failure; data?: T; loadedAt?: number };

/**
 * One read from the admin API with explicit loading / ready / error states (the flows doc wants
 * skeleton, empty and error-with-retry on every screen). `key` returns undefined to stay idle and
 * re-runs the fetch whenever the key changes; `reload()` repeats it. A stale answer for an old key
 * is dropped. On a network failure the last data is kept (shown with a "stale" tag); on a server
 * error it is cleared so no partial data is presented as current.
 */
export function createQuery<K, T>(key: () => K | undefined, fetcher: (k: K) => Promise<Outcome<T>>) {
  const [state, setState] = createSignal<QueryState<T>>({ status: "idle" });
  const [tick, setTick] = createSignal(0);
  let seq = 0;

  createEffect(
    () => [key(), tick()] as const,
    ([k]) => {
      if (k === undefined) {
        setState({ status: "idle" });
        return;
      }
      const mine = ++seq;
      setState((s) => (s.status === "idle" ? { status: "loading" } : { ...s, status: "loading" }) as QueryState<T>);
      void fetcher(k).then((r) => {
        if (mine !== seq) return;
        if (r.ok) setState({ status: "ready", data: r.data, loadedAt: Date.now() });
        else
          setState((s) =>
            r.failure.network && "data" in s && s.data !== undefined
              ? { status: "error", failure: r.failure, data: s.data, ...("loadedAt" in s && s.loadedAt ? { loadedAt: s.loadedAt } : {}) }
              : { status: "error", failure: r.failure },
          );
      });
    },
  );

  return {
    state,
    data: () => {
      const s = state();
      return "data" in s ? s.data : undefined;
    },
    failure: () => {
      const s = state();
      return s.status === "error" ? s.failure : undefined;
    },
    loading: () => {
      const s = state();
      return s.status === "loading" || s.status === "idle";
    },
    loadedAt: () => {
      const s = state();
      return "loadedAt" in s ? s.loadedAt : undefined;
    },
    reload: () => setTick((n) => n + 1),
  };
}

/** What presentational wrappers need from any query. */
export type AnyQuery = {
  loading: () => boolean;
  failure: () => Failure | undefined;
  data: () => unknown;
  loadedAt: () => number | undefined;
  reload: () => void;
};

type Page<I> = { items: I[]; next_cursor?: string | undefined };

/** First page through `createQuery`, further pages appended by `more()`. A new key or reload starts over. */
export function createPaged<K, I>(key: () => K | undefined, fetchPage: (k: K, cursor?: string) => Promise<Outcome<Page<I>>>) {
  const first = createQuery(key, (k) => fetchPage(k));
  const [extra, setExtra] = createSignal<I[]>([]);
  const [cursor, setCursor] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);

  createEffect(
    () => first.data(),
    (d) => {
      setExtra([]);
      setCursor(d?.next_cursor);
      setFailed(false);
    },
  );

  const more = async () => {
    const c = cursor();
    const k = key();
    if (!c || k === undefined || busy()) return;
    setBusy(true);
    setFailed(false);
    const r = await fetchPage(k, c);
    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      return;
    }
    setExtra((e) => [...e, ...r.data.items]);
    setCursor(r.data.next_cursor);
  };

  return {
    first,
    rows: (): I[] => [...(first.data()?.items ?? []), ...extra()],
    hasMore: () => cursor() !== undefined,
    moreBusy: busy,
    moreFailed: failed,
    more,
  };
}
