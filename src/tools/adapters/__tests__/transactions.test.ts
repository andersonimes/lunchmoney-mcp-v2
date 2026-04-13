import { describe, it, expect } from "vitest";
import {
  toCreateTransactionsInput,
  toUpdateTransactionInput,
  toUpdateTransactionsInput,
} from "../transactions.js";

describe("toCreateTransactionsInput", () => {
  it("passes every top-level field through", () => {
    const result = toCreateTransactionsInput({
      transactions: [{ date: "2026-04-11", payee: "Coffee", amount: 5 }],
      apply_rules: true,
      skip_duplicates: false,
      skip_balance_update: true,
    });

    expect(result.apply_rules).toBe(true);
    expect(result.skip_duplicates).toBe(false);
    expect(result.skip_balance_update).toBe(true);
    expect(result.transactions).toHaveLength(1);
  });

  it("preserves the currency value on each transaction after widening", () => {
    const result = toCreateTransactionsInput({
      transactions: [
        { date: "2026-04-11", payee: "Tea", amount: 3, currency: "usd" },
        { date: "2026-04-11", payee: "Croissant", amount: 4, currency: "eur" },
      ],
    });

    expect(result.transactions[0].currency).toBe("usd");
    expect(result.transactions[1].currency).toBe("eur");
  });

  it("leaves currency undefined when the schema omits it", () => {
    const result = toCreateTransactionsInput({
      transactions: [{ date: "2026-04-11", payee: "Cash", amount: 10 }],
    });

    expect(result.transactions[0].currency).toBeUndefined();
  });

  it("passes per-transaction optional fields through (category_id, tag_ids, status)", () => {
    const result = toCreateTransactionsInput({
      transactions: [
        {
          date: "2026-04-11",
          payee: "Lunch",
          amount: 12,
          category_id: 42,
          tag_ids: [1, 2, 3],
          status: "reviewed",
          notes: "team lunch",
        },
      ],
    });

    expect(result.transactions[0].category_id).toBe(42);
    expect(result.transactions[0].tag_ids).toEqual([1, 2, 3]);
    expect(result.transactions[0].status).toBe("reviewed");
    expect(result.transactions[0].notes).toBe("team lunch");
  });
});

describe("toUpdateTransactionInput", () => {
  it("passes every field through unchanged except currency widening", () => {
    const result = toUpdateTransactionInput({
      date: "2026-04-11",
      payee: "Updated Payee",
      amount: 99,
      currency: "gbp",
      notes: "corrected",
      category_id: 7,
      status: "reviewed",
      tag_ids: [9],
    });

    expect(result.date).toBe("2026-04-11");
    expect(result.payee).toBe("Updated Payee");
    expect(result.amount).toBe(99);
    expect(result.currency).toBe("gbp");
    expect(result.notes).toBe("corrected");
    expect(result.category_id).toBe(7);
    expect(result.status).toBe("reviewed");
    expect(result.tag_ids).toEqual([9]);
  });

  it("preserves explicit nulls on nullable fields (notes, category_id)", () => {
    const result = toUpdateTransactionInput({
      notes: null,
      category_id: null,
    });

    expect(result.notes).toBeNull();
    expect(result.category_id).toBeNull();
  });

  it("returns an empty-ish object when the schema output is empty", () => {
    const result = toUpdateTransactionInput({});

    expect(result.currency).toBeUndefined();
    expect(Object.keys(result).every((k) => k === "currency")).toBe(true);
  });
});

describe("toUpdateTransactionsInput", () => {
  it("composes toUpdateTransactionInput over every element of the transactions array", () => {
    const result = toUpdateTransactionsInput({
      transactions: [
        { id: 1, payee: "First", currency: "usd" },
        { id: 2, notes: "Second", category_id: 3 },
      ],
    });

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].id).toBe(1);
    expect(result.transactions[0].payee).toBe("First");
    expect(result.transactions[0].currency).toBe("usd");
    expect(result.transactions[1].id).toBe(2);
    expect(result.transactions[1].notes).toBe("Second");
    expect(result.transactions[1].category_id).toBe(3);
  });

  it("preserves id on each element", () => {
    const result = toUpdateTransactionsInput({
      transactions: [
        { id: 10 },
        { id: 20 },
        { id: 30 },
      ],
    });

    expect(result.transactions.map((tx) => tx.id)).toEqual([10, 20, 30]);
  });

  it("returns an empty transactions array when given one", () => {
    const result = toUpdateTransactionsInput({ transactions: [] });
    expect(result.transactions).toEqual([]);
  });
});
