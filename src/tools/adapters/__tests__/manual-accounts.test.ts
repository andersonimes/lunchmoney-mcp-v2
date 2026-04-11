import { describe, it, expect } from "vitest";
import {
  toCreateManualAccountInput,
  toUpdateManualAccountInput,
} from "../manual-accounts.js";

describe("toCreateManualAccountInput", () => {
  it("passes every field through unchanged except currency widening", () => {
    const result = toCreateManualAccountInput({
      name: "My Savings",
      type: "cash",
      balance: "1234.56",
      institution_name: "Bank of Somewhere",
      display_name: "Savings",
      subtype: "high-yield",
      currency: "usd",
      balance_as_of: "2026-04-11",
      status: "active",
      exclude_from_transactions: false,
    });

    expect(result.name).toBe("My Savings");
    expect(result.type).toBe("cash");
    expect(result.balance).toBe("1234.56");
    expect(result.institution_name).toBe("Bank of Somewhere");
    expect(result.display_name).toBe("Savings");
    expect(result.subtype).toBe("high-yield");
    expect(result.currency).toBe("usd");
    expect(result.balance_as_of).toBe("2026-04-11");
    expect(result.status).toBe("active");
    expect(result.exclude_from_transactions).toBe(false);
  });

  it("accepts each of the 10 valid v2 account type enum values", () => {
    const types = [
      "cash",
      "credit",
      "cryptocurrency",
      "employee compensation",
      "investment",
      "loan",
      "other liability",
      "other asset",
      "real estate",
      "vehicle",
    ] as const;

    for (const type of types) {
      const result = toCreateManualAccountInput({
        name: `Test ${type}`,
        type,
        balance: 0,
      });
      expect(result.type).toBe(type);
    }
  });

  it("leaves optional fields undefined when the schema omits them", () => {
    const result = toCreateManualAccountInput({
      name: "Minimal",
      type: "cash",
      balance: 0,
    });

    expect(result.currency).toBeUndefined();
    expect(result.institution_name).toBeUndefined();
    expect(result.display_name).toBeUndefined();
  });
});

describe("toUpdateManualAccountInput", () => {
  it("passes every field through unchanged except currency widening", () => {
    const result = toUpdateManualAccountInput({
      name: "Renamed Account",
      type: "credit",
      balance: 500,
      institution_name: "New Bank",
      currency: "eur",
      status: "closed",
      closed_on: "2026-04-10",
    });

    expect(result.name).toBe("Renamed Account");
    expect(result.type).toBe("credit");
    expect(result.balance).toBe(500);
    expect(result.institution_name).toBe("New Bank");
    expect(result.currency).toBe("eur");
    expect(result.status).toBe("closed");
    expect(result.closed_on).toBe("2026-04-10");
  });

  it("preserves nullable institution_name and display_name on the update variant", () => {
    const result = toUpdateManualAccountInput({
      institution_name: null,
      display_name: null,
    });

    expect(result.institution_name).toBeNull();
    expect(result.display_name).toBeNull();
  });

  it("returns an empty-ish object when no fields are set", () => {
    const result = toUpdateManualAccountInput({});

    expect(result.currency).toBeUndefined();
    expect(Object.keys(result).every((k) => k === "currency")).toBe(true);
  });
});
