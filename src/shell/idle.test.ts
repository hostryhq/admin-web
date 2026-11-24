import { describe, expect, it } from "vitest";
import { createIdleMachine, DEFAULT_IDLE_EXPIRE_MS, DEFAULT_IDLE_WARN_MS } from "./idle";

const MIN = 60_000;

function setup(absoluteAt?: number) {
  let t = 1_000_000;
  const m = createIdleMachine({
    warnAfterMs: DEFAULT_IDLE_WARN_MS,
    expireAfterMs: DEFAULT_IDLE_EXPIRE_MS,
    absoluteAt,
    now: () => t,
  });
  return { m, advance: (ms: number) => void (t += ms), at: () => t };
}

describe("idle timeout (BR-5: warn at 28 minutes, sign out at 30)", () => {
  it("defaults are 28 and 30 minutes", () => {
    expect(DEFAULT_IDLE_WARN_MS).toBe(28 * MIN);
    expect(DEFAULT_IDLE_EXPIRE_MS).toBe(30 * MIN);
  });

  it("warns at 28 minutes idle and expires at 30 with reason idle", () => {
    const { m, advance } = setup();
    advance(27 * MIN + 59_000);
    expect(m.tick()).toBe("active");
    advance(1_000);
    expect(m.tick()).toBe("warning");
    advance(2 * MIN);
    expect(m.tick()).toBe("expired");
    expect(m.reason()).toBe("idle");
  });

  it("activity before the warning restarts the idle clock", () => {
    const { m, advance } = setup();
    advance(20 * MIN);
    m.activity();
    advance(20 * MIN);
    expect(m.tick()).toBe("active");
  });

  it("activity during the warning does not dismiss it; only stay() does", () => {
    const { m, advance } = setup();
    advance(28 * MIN);
    expect(m.tick()).toBe("warning");
    m.activity();
    advance(MIN + 1);
    expect(m.tick()).toBe("warning");
    expect(m.remainingMs()).toBeLessThan(MIN);
    expect(m.stay()).toBe(true);
    expect(m.state()).toBe("active");
    advance(27 * MIN);
    expect(m.tick()).toBe("active");
  });

  it("stay() does nothing when there is no warning, and nothing revives an expired session", () => {
    const { m, advance } = setup();
    expect(m.stay()).toBe(false);
    advance(31 * MIN);
    expect(m.tick()).toBe("expired");
    expect(m.stay()).toBe(false);
    m.activity();
    expect(m.tick()).toBe("expired");
  });

  it("a long gap (sleeping laptop) goes straight to expired", () => {
    const { m, advance } = setup();
    advance(5 * 60 * MIN);
    expect(m.tick()).toBe("expired");
  });

  it("the absolute limit expires the session with reason limit even if the user is active", () => {
    const { m, advance, at } = setup(1_000_000 + 12 * 60 * MIN);
    advance(11 * 60 * MIN);
    m.activity();
    expect(m.tick()).toBe("active");
    advance(60 * MIN);
    m.activity();
    expect(at()).toBe(1_000_000 + 12 * 60 * MIN);
    expect(m.tick()).toBe("expired");
    expect(m.reason()).toBe("limit");
  });
});
