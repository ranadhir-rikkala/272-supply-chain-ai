import { describe, expect, it } from "vitest";
import { configureClient } from "../api/client";
import { api } from "../api/endpoints";
import { setupMockApi } from "../test/msw";

setupMockApi();

function as(username: string) {
  configureClient(() => `mock:${username}`, () => undefined);
}

describe("mock API follows the contract rules", () => {
  it("lets a planner approve small orders and endorse large ones", async () => {
    as("pat.planner");
    const { items } = await api.recommendations({ status: "PENDING_REVIEW", kind: "REORDER", page: 0, size: 500 });
    const small = items.find((r) => r.totalValue <= 10000)!;
    const large = items.find((r) => r.totalValue > 10000)!;
    const approved = await api.approve(small.recommendationId, small.version, { comment: "ok" });
    expect(approved.data.recommendation.status).toBe("APPROVED");
    expect(approved.data.draftOrderId).toMatch(/^DPO-/);
    const endorsed = await api.approve(large.recommendationId, large.version, {});
    expect(endorsed.data.recommendation.status).toBe("PENDING_MANAGER");
    await expect(api.approve(large.recommendationId, endorsed.data.recommendation.version, {})).rejects.toMatchObject({ status: 403 });
    as("max.manager");
    const final = await api.approve(large.recommendationId, endorsed.data.recommendation.version, { quantity: 10 });
    expect(final.data.recommendation.status).toBe("APPROVED");
    expect(final.data.recommendation.quantity).toBe(10);
  });

  it("rejects stale versions and blocks admins and viewers from approving", async () => {
    as("pat.planner");
    const { items } = await api.recommendations({ status: "PENDING_REVIEW", page: 0, size: 5 });
    await expect(api.approve(items[0].recommendationId, items[0].version + 1, {})).rejects.toMatchObject({ status: 412 });
    as("ada.admin");
    await expect(api.approve(items[0].recommendationId, items[0].version, {})).rejects.toMatchObject({ status: 403 });
    as("vic.viewer");
    await expect(api.audit({ page: 0, size: 10 })).rejects.toMatchObject({ status: 403 });
  });
});
