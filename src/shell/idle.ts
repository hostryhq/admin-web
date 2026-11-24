import { createSignal, onSettled } from "solid-js";

/** BR-5: idle limit 30 minutes (warning at 28), absolute limit 12 hours. The server enforces; this mirrors it. */
export const DEFAULT_IDLE_WARN_MS = 28 * 60_000;
export const DEFAULT_IDLE_EXPIRE_MS = 30 * 60_000;

export type IdleState = "active" | "warning" | "expired";
export type ExpiryReason = "idle" | "limit";

export type IdleConfig = {
  warnAfterMs: number;
  expireAfterMs: number;
  /** Epoch ms of the absolute session limit, if the server reported one. */
  absoluteAt?: number | undefined;
  now: () => number;
};

/**
 * Framework-free state machine so the rules are testable with a fake clock.
 * Activity resets the idle clock only while `active`; once the warning is up, only an explicit
 * `stay()` (the user pressing "Stay signed in") continues the session, so a stray mouse move
 * cannot silently dismiss the warning. The clock is compared on each tick instead of counted,
 * so a throttled background tab or a sleeping laptop still expires on time.
 */
export function createIdleMachine(config: IdleConfig) {
  let lastActivity = config.now();
  let state: IdleState = "active";
  let reason: ExpiryReason | undefined;

  const remainingMs = () => Math.max(0, config.expireAfterMs - (config.now() - lastActivity));

  return {
    state: () => state,
    reason: () => reason,
    remainingMs,
    activity(): void {
      if (state === "active") lastActivity = config.now();
    },
    /** Returns true if the user could be kept signed in (the caller then refreshes the server session). */
    stay(): boolean {
      if (state !== "warning") return false;
      lastActivity = config.now();
      state = "active";
      return true;
    },
    tick(): IdleState {
      if (state === "expired") return state;
      const t = config.now();
      if (config.absoluteAt !== undefined && t >= config.absoluteAt) {
        state = "expired";
        reason = "limit";
      } else if (t - lastActivity >= config.expireAfterMs) {
        state = "expired";
        reason = "idle";
      } else if (t - lastActivity >= config.warnAfterMs) {
        state = "warning";
      }
      return state;
    },
  };
}

export type IdleTimerOptions = {
  enabled: () => boolean;
  absoluteAt?: () => number | undefined;
  warnAfterMs?: number;
  expireAfterMs?: number;
  now?: () => number;
  onExpire: (reason: ExpiryReason) => void;
  /** Called when the user chooses to stay; extend the server session here. */
  onStay?: () => void;
  /** Where activity is observed; defaults to window. */
  target?: EventTarget;
  tickMs?: number;
};

const ACTIVITY_EVENTS = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

/** Reactive wrapper: signals for the UI, activity listeners and a one second tick. Call inside a component. */
export function createIdleTimer(options: IdleTimerOptions) {
  const now = options.now ?? Date.now;
  const [state, setState] = createSignal<IdleState>("active");
  const [minutesLeft, setMinutesLeft] = createSignal(0);
  let machine = createIdleMachine(config());

  function config(): IdleConfig {
    return {
      warnAfterMs: options.warnAfterMs ?? DEFAULT_IDLE_WARN_MS,
      expireAfterMs: options.expireAfterMs ?? DEFAULT_IDLE_EXPIRE_MS,
      absoluteAt: options.absoluteAt?.(),
      now,
    };
  }

  const sync = () => {
    setState(machine.state());
    setMinutesLeft(Math.max(1, Math.ceil(machine.remainingMs() / 60_000)));
  };

  const tick = () => {
    if (!options.enabled()) return;
    const before = machine.state();
    const next = machine.tick();
    sync();
    if (next === "expired" && before !== "expired") options.onExpire(machine.reason() ?? "idle");
  };

  const stay = () => {
    if (machine.stay()) options.onStay?.();
    sync();
  };

  onSettled(() => {
    const target = options.target ?? window;
    const onActivity = () => machine.activity();
    for (const name of ACTIVITY_EVENTS) target.addEventListener(name, onActivity, { passive: true });
    const id = setInterval(tick, options.tickMs ?? 1000);
    return () => {
      for (const name of ACTIVITY_EVENTS) target.removeEventListener(name, onActivity);
      clearInterval(id);
    };
  });

  return {
    state,
    minutesLeft,
    stay,
    /** Start a fresh idle clock, for example right after sign-in. */
    reset: () => {
      machine = createIdleMachine(config());
      sync();
    },
    tick,
  };
}
