import { describe, expect, it, vi } from "vitest";
import { createAdminApi } from "./client";

type Paths = {
  "/v1/things": {
    get: { responses: { 200: { content: { "application/json": { ok: boolean } } } } };
    post: { responses: { 200: { content: { "application/json": { ok: boolean } } } } };
  };
};

const json = () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });

describe("admin API client", () => {
  it("never sends an Authorization header (no token in the browser, ADR-0013 V6)", async () => {
    const fetchFn = vi.fn((req: Request | string | URL) => Promise.resolve(req).then(json));
    const api = createAdminApi<Paths>({ baseUrl: "http://admin.test", fetch: fetchFn as unknown as typeof fetch });
    await api.GET("/v1/things");
    const req = fetchFn.mock.calls[0]?.[0] as Request;
    expect(req.headers.has("authorization")).toBe(false);
  });

  it("adds an Idempotency-Key to mutations", async () => {
    const fetchFn = vi.fn((req: Request | string | URL) => Promise.resolve(req).then(json));
    const api = createAdminApi<Paths>({ baseUrl: "http://admin.test", fetch: fetchFn as unknown as typeof fetch });
    await api.POST("/v1/things");
    const req = fetchFn.mock.calls[0]?.[0] as Request;
    expect(req.headers.get("idempotency-key")).toMatch(/\S+/);
  });

  it("reports reachability: network errors mark unreachable, any server answer marks reachable", async () => {
    const onReachable = vi.fn();
    const onUnreachable = vi.fn();
    const ok = createAdminApi<Paths>({
      baseUrl: "http://admin.test",
      fetch: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch,
      onReachable,
      onUnreachable,
    });
    await ok.GET("/v1/things");
    expect(onReachable).toHaveBeenCalledOnce();
    expect(onUnreachable).not.toHaveBeenCalled();

    const down = createAdminApi<Paths>({
      baseUrl: "http://admin.test",
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
      onReachable,
      onUnreachable,
    });
    await expect(down.GET("/v1/things")).rejects.toThrow();
    expect(onUnreachable).toHaveBeenCalledOnce();
  });
});
