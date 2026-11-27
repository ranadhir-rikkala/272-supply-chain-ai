import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../mocks/server";
import { setupMockApi } from "../test/msw";
import { renderAs } from "../test/render";
import { WarehouseSelect } from "./WarehouseSelect";

setupMockApi();

const warehouse = (warehouseId: string, city: string) => ({
  warehouseId, name: `${city} DC`, city, state: "", latitude: 0, longitude: 0,
  high: 0, medium: 0, low: 0, overstocked: 0, pendingInbound: 0, pendingOutbound: 0,
});

describe("WarehouseSelect", () => {
  it("lists the warehouses the API returns, sorted by id", async () => {
    server.use(
      http.get("*/api/v1/warehouses", () => HttpResponse.json([warehouse("WH-02", "Dallas"), warehouse("WH-01", "Los Angeles")])),
    );
    renderAs("vic.viewer", <WarehouseSelect id="w" value="" onChange={() => undefined} />);
    const select = screen.getByRole("combobox");
    await within(select).findByRole("option", { name: "WH-01 · Los Angeles" });
    expect(within(select).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["", "WH-01", "WH-02"]);
  });
});
