import { describe, expect, it, vi } from "vitest";
import { createRoot, flush } from "solid-js";
import { createConnectivity } from "./connectivity";

function setup(startOnline = true) {
  const target = new EventTarget();
  const onBackOnline = vi.fn();
  let online = startOnline;
  let c!: ReturnType<typeof createConnectivity>;
  const dispose = createRoot((d) => {
    c = createConnectivity({ target, isOnline: () => online, onBackOnline });
    return d;
  });
  flush();
  return {
    c,
    onBackOnline,
    dispose,
    goOffline: () => {
      online = false;
      target.dispatchEvent(new Event("offline"));
      flush();
    },
    goOnline: () => {
      online = true;
      target.dispatchEvent(new Event("online"));
      flush();
    },
  };
}

describe("connectivity (online-only app: writes disabled, nothing queued)", () => {
  it("is quiet while online", () => {
    const { c } = setup();
    expect(c.reason()).toBeUndefined();
    expect(c.writesDisabled()).toBe(false);
  });

  it("offline disables writes and recovery announces once", () => {
    const { c, goOffline, goOnline, onBackOnline } = setup();
    goOffline();
    expect(c.reason()).toBe("offline");
    expect(c.writesDisabled()).toBe(true);
    goOnline();
    expect(c.reason()).toBeUndefined();
    expect(onBackOnline).toHaveBeenCalledOnce();
  });

  it("unreachable server shows its own reason and clears when a call succeeds", () => {
    const { c, onBackOnline } = setup();
    c.markUnreachable();
    flush();
    expect(c.reason()).toBe("unreachable");
    c.markReachable();
    flush();
    expect(c.reason()).toBeUndefined();
    expect(onBackOnline).toHaveBeenCalledOnce();
  });

  it("offline wins over unreachable, and a browser online event alone does not clear an unreachable server", () => {
    const { c, goOffline, goOnline, onBackOnline } = setup();
    c.markUnreachable();
    goOffline();
    expect(c.reason()).toBe("offline");
    goOnline();
    expect(c.reason()).toBe("unreachable");
    expect(onBackOnline).not.toHaveBeenCalled();
  });
});
