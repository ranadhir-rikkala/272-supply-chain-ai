import { afterAll, afterEach, beforeAll } from "vitest";
import { resetMockState } from "../mocks/handlers";
import { server } from "../mocks/server";

export function setupMockApi() {
  let intercepted: typeof fetch;
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
    intercepted = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => intercepted(input, init ? { ...init, signal: undefined } : init);
  });
  afterEach(() => resetMockState());
  afterAll(() => {
    globalThis.fetch = intercepted;
    server.close();
  });
}
