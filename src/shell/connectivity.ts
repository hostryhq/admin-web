import { createContext, createSignal, onSettled, useContext } from "solid-js";
import type { OfflineReason } from "@hostry/ui-kit";

export type ConnectivityOptions = {
  /** Where `online` / `offline` events arrive; defaults to window. */
  target?: EventTarget;
  isOnline?: () => boolean;
  /** Fired when the connection returns after an outage ("Back online. Reload to see current data."). */
  onBackOnline?: () => void;
};

/**
 * Connectivity for an online-only app (BR-70): nothing is queued, writes are disabled while offline.
 * `offline` = the browser reports no network; `unreachable` = browser online but the API call failed.
 * Offline wins over unreachable. The API layer calls `markUnreachable` / `markReachable`.
 */
export function createConnectivity(options: ConnectivityOptions = {}) {
  const isOnline = options.isOnline ?? (() => navigator.onLine);
  const [online, setOnline] = createSignal(isOnline());
  const [unreachable, setUnreachable] = createSignal(false);
  let hadOutage = !isOnline();

  const outage = () => {
    hadOutage = true;
  };
  const recovered = () => {
    if (hadOutage) {
      hadOutage = false;
      options.onBackOnline?.();
    }
  };

  const markUnreachable = () => {
    setUnreachable(true);
    outage();
  };
  const markReachable = () => {
    setUnreachable(false);
    if (online()) recovered();
  };

  onSettled(() => {
    const target = options.target ?? window;
    const goOffline = () => {
      setOnline(false);
      outage();
    };
    const goOnline = () => {
      setOnline(true);
      if (!unreachable()) recovered();
    };
    target.addEventListener("offline", goOffline);
    target.addEventListener("online", goOnline);
    return () => {
      target.removeEventListener("offline", goOffline);
      target.removeEventListener("online", goOnline);
    };
  });

  const reason = (): OfflineReason | undefined => (!online() ? "offline" : unreachable() ? "unreachable" : undefined);

  return {
    reason,
    /** True when write controls must be disabled (offline or unreachable). */
    writesDisabled: () => reason() !== undefined,
    markUnreachable,
    markReachable,
  };
}

export type Connectivity = ReturnType<typeof createConnectivity>;

export const ConnectivityContext = createContext<Connectivity>();

const ONLINE: Pick<Connectivity, "reason" | "writesDisabled"> = { reason: () => undefined, writesDisabled: () => false };

/** Connectivity for screens: write controls are disabled while offline or unreachable (nothing is queued). */
export function useConnectivity(): Pick<Connectivity, "reason" | "writesDisabled"> {
  return useContext(ConnectivityContext) ?? ONLINE;
}
