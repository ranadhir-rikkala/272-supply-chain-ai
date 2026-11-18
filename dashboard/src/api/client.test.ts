import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureClient, etagVersion, query, request } from "./client";

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("turns problem details into a readable ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      respond(403, {
        type: "https://supplychain.local/problems/forbidden",
        title: "Forbidden",
        status: 403,
        detail: "only a supply manager can change the quantity",
        requestId: "req-1",
      }),
    );
    const error = await request("/recommendations/x/approve", { method: "POST", body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.requestId).toBe("req-1");
    expect(error.friendly).toBe("Not allowed: only a supply manager can change the quantity");
  });

  it("explains stale versions and network failures in plain words", async () => {
    vi.stubGlobal("fetch", respond(412, { title: "Precondition Failed", status: 412, detail: "changed since version 0" }));
    const stale = await request("/x").catch((e) => e);
    expect(stale.friendly).toMatch(/Reload and try again/);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const offline = await request("/x").catch((e) => e);
    expect(offline.status).toBe(0);
    expect(offline.friendly).toMatch(/could not be reached/);
  });

  it("sends bearer token, If-Match, Idempotency-Key and a request id", async () => {
    const fetchMock = respond(200, { ok: true }, { ETag: '"4"' });
    vi.stubGlobal("fetch", fetchMock);
    configureClient(() => "token-123", () => undefined);
    const result = await request("/recommendations/1/approve", {
      method: "POST",
      body: { comment: "ok" },
      ifMatch: 3,
      idempotencyKey: "key-1",
    });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer token-123");
    expect(headers.get("If-Match")).toBe('"3"');
    expect(headers.get("Idempotency-Key")).toBe("key-1");
    expect(headers.get("X-Request-ID")).toBeTruthy();
    expect(etagVersion(result.etag)).toBe(4);
  });

  it("calls the unauthorized handler on 401", async () => {
    const unauthorized = vi.fn();
    configureClient(() => null, unauthorized);
    vi.stubGlobal("fetch", respond(401, { title: "Unauthorized", status: 401, detail: "a valid bearer token is required" }));
    await request("/me").catch(() => undefined);
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("builds query strings without empty values", () => {
    expect(query({ level: "HIGH", search: "", page: 0, warehouseId: undefined })).toBe("?level=HIGH&page=0");
  });
});
