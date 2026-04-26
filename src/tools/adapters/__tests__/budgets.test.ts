import { describe, it, expect } from "vitest";
import { toUpsertBudgetInput } from "../budgets.js";

describe("toUpsertBudgetInput", () => {
  it("passes every field through unchanged when all are provided", () => {
    const result = toUpsertBudgetInput({
      start_date: "2026-05-01",
      category_id: 42,
      amount: 100,
      currency: "usd",
      notes: "monthly groceries cap",
    });

    expect(result.start_date).toBe("2026-05-01");
    expect(result.category_id).toBe(42);
    expect(result.amount).toBe(100);
    expect(result.currency).toBe("usd");
    expect(result.notes).toBe("monthly groceries cap");
  });

  it("leaves currency undefined when the schema omits it", () => {
    const result = toUpsertBudgetInput({
      start_date: "2026-05-01",
      category_id: 42,
      amount: 100,
    });

    expect(result.currency).toBeUndefined();
  });

  it("preserves explicit null on notes", () => {
    const result = toUpsertBudgetInput({
      start_date: "2026-05-01",
      category_id: 42,
      amount: 100,
      notes: null,
    });

    expect(result.notes).toBeNull();
  });

  it("accepts amount as a string (precision-preserving form)", () => {
    const result = toUpsertBudgetInput({
      start_date: "2026-05-01",
      category_id: 42,
      amount: "1234.56",
    });

    expect(result.amount).toBe("1234.56");
  });
});
