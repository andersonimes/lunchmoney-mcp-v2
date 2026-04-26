import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "./mock-client.js";
import { createTestServer } from "./test-helpers.js";
import { registerBudgetTools } from "../budgets.js";

describe("budget tools", () => {
  const { server, tools } = createTestServer();
  registerBudgetTools(server);

  beforeEach(() => {
    Object.values(mockClient.budgets).forEach((fn) => fn.mockReset());
  });

  it("registers all 3 budget tools", () => {
    expect(tools.has("get_budget_settings")).toBe(true);
    expect(tools.has("upsert_budget")).toBe(true);
    expect(tools.has("remove_budget")).toBe(true);
  });

  describe("get_budget_settings", () => {
    it("returns the v2 client's settings response unchanged", async () => {
      const settings = {
        budget_period_granularity: "month",
        budget_period_quantity: 1,
        budget_period_anchor_date: "2024-01-01",
      };
      mockClient.budgets.getSettings.mockResolvedValue(settings);

      const result = await tools.get("get_budget_settings")!.handler({});
      expect(JSON.parse(result.content[0].text)).toEqual(settings);
      expect(mockClient.budgets.getSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe("upsert_budget", () => {
    it("calls client.budgets.upsert with the converted body", async () => {
      const response = {
        category_id: 42,
        start_date: "2026-05-01",
        amount: "100",
        currency: "usd",
      };
      mockClient.budgets.upsert.mockResolvedValue(response);

      await tools.get("upsert_budget")!.handler({
        start_date: "2026-05-01",
        category_id: 42,
        amount: 100,
        currency: "usd",
      });

      expect(mockClient.budgets.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          start_date: "2026-05-01",
          category_id: 42,
          amount: 100,
          currency: "usd",
        }),
      );
    });

    it("forwards the upsert response to the caller", async () => {
      const response = {
        category_id: 7,
        start_date: "2026-05-01",
        amount: "50.00",
      };
      mockClient.budgets.upsert.mockResolvedValue(response);

      const result = await tools.get("upsert_budget")!.handler({
        start_date: "2026-05-01",
        category_id: 7,
        amount: "50.00",
      });

      expect(JSON.parse(result.content[0].text)).toEqual(response);
    });
  });

  describe("remove_budget", () => {
    it("calls client.budgets.delete with category_id and start_date", async () => {
      mockClient.budgets.delete.mockResolvedValue(undefined);

      await tools.get("remove_budget")!.handler({
        category_id: 42,
        start_date: "2026-05-01",
      });

      expect(mockClient.budgets.delete).toHaveBeenCalledWith({
        category_id: 42,
        start_date: "2026-05-01",
      });
    });

    it("returns a confirmation string naming both inputs and the idempotent semantics", async () => {
      mockClient.budgets.delete.mockResolvedValue(undefined);

      const result = await tools.get("remove_budget")!.handler({
        category_id: 99,
        start_date: "2026-06-01",
      });

      const text = result.content[0].text;
      expect(text).toContain("99");
      expect(text).toContain("2026-06-01");
      expect(text).toContain("(or did not exist)");
    });

    it("succeeds when the underlying delete call resolves to void (idempotent semantics)", async () => {
      mockClient.budgets.delete.mockResolvedValue(undefined);

      const result = await tools.get("remove_budget")!.handler({
        category_id: 1,
        start_date: "2026-05-01",
      });

      expect(result.content[0].text).toContain("deleted");
    });
  });
});
