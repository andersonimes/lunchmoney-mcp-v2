import { describe, it, expect, vi } from "vitest";
import type {
  Category,
  ManualAccount,
  PlaidAccount,
  RecurringItem,
  Tag,
  Transaction,
} from "@lunch-money/lunch-money-js-v2";

// Prevent src/client.ts from exiting when it runs at module load.
vi.mock("../../client.js", () => ({
  client: {},
}));

import {
  ScopedTtlCache,
  type CacheClient,
  type HydrationContext,
} from "../store.js";
import { hydrateTransaction, hydrateTransactions } from "../hydrate.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  const base = {
    id: 1,
    date: "2026-04-01",
    amount: "-10.00",
    currency: "usd",
    to_base: -10,
    recurring_id: null,
    payee: "Test Payee",
    category_id: null,
    plaid_account_id: null,
    manual_account_id: null,
    external_id: null,
    tag_ids: [] as number[],
    notes: null,
    status: "reviewed",
    is_pending: false,
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    split_parent_id: null,
    is_group_parent: false,
    group_parent_id: null,
    source: "manual" as const,
  };
  return { ...base, ...overrides } as unknown as Transaction;
}

function makeCategory(id: number, name: string): Category {
  return { id, name } as unknown as Category;
}

function makeTag(id: number, name: string): Tag {
  return { id, name } as unknown as Tag;
}

function makeManualAccount(id: number, name: string): ManualAccount {
  return { id, name } as unknown as ManualAccount;
}

function makePlaidAccount(id: number, name: string): PlaidAccount {
  return { id, name } as unknown as PlaidAccount;
}

function makeRecurring(id: number, payee: string): RecurringItem {
  return {
    id,
    description: null,
    status: "reviewed",
    transaction_criteria: {
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      granularity: "month",
      quantity: 1,
      anchor_date: "2026-01-01",
      payee,
      amount: "10.00",
      to_base: 10,
      currency: "usd",
      plaid_account_id: null,
      manual_account_id: null,
    },
    overrides: {},
    matches: {
      request_start_date: "2026-01-01",
      request_end_date: "2026-01-31",
      expected_occurrence_dates: [],
      found_transactions: [],
      missing_transaction_dates: [],
    },
  } as unknown as RecurringItem;
}

function makeCacheWith(data: {
  categories?: Category[];
  tags?: Tag[];
  manualAccounts?: ManualAccount[];
  plaidAccounts?: PlaidAccount[];
  recurringItems?: RecurringItem[];
}) {
  const fakeClient: CacheClient = {
    categories: { getAll: vi.fn().mockResolvedValue(data.categories ?? []) },
    tags: { getAll: vi.fn().mockResolvedValue(data.tags ?? []) },
    manualAccounts: {
      getAll: vi.fn().mockResolvedValue(data.manualAccounts ?? []),
    },
    plaidAccounts: {
      getAll: vi.fn().mockResolvedValue(data.plaidAccounts ?? []),
    },
    recurringItems: {
      getAll: vi.fn().mockResolvedValue(data.recurringItems ?? []),
    },
  };
  return {
    cache: new ScopedTtlCache({ client: fakeClient }),
    fakeClient,
  };
}

function ctx(): HydrationContext {
  return { warnings: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hydrateTransactions", () => {
  it("populates all five name fields when every reference resolves", async () => {
    const { cache } = makeCacheWith({
      categories: [makeCategory(7, "Groceries")],
      tags: [makeTag(3, "work"), makeTag(8, "reimbursable")],
      manualAccounts: [makeManualAccount(5, "Cash Wallet")],
      plaidAccounts: [makePlaidAccount(11, "Chase Checking")],
      recurringItems: [makeRecurring(22, "Whole Foods")],
    });

    const tx = makeTx({
      id: 100,
      category_id: 7,
      manual_account_id: 5,
      plaid_account_id: 11,
      tag_ids: [3, 8],
      recurring_id: 22,
    });

    const c = ctx();
    const [hydrated] = await hydrateTransactions([tx], c, cache);

    expect(hydrated.category_name).toBe("Groceries");
    expect(hydrated.manual_account_name).toBe("Cash Wallet");
    expect(hydrated.plaid_account_name).toBe("Chase Checking");
    expect(hydrated.tag_names).toEqual(["work", "reimbursable"]);
    expect(hydrated.recurring_payee).toBe("Whole Foods");
    expect(c.warnings).toEqual([]);
    // Original v2 fields are preserved.
    expect(hydrated.id).toBe(100);
    expect(hydrated.category_id).toBe(7);
    expect(hydrated.tag_ids).toEqual([3, 8]);
  });

  it("returns null for any reference type that is not in the cache map", async () => {
    // Categories map is populated but the tx's category_id is not in it.
    const { cache } = makeCacheWith({
      categories: [makeCategory(1, "Other")],
    });

    const tx = makeTx({ category_id: 999 });
    const c = ctx();
    const [hydrated] = await hydrateTransactions([tx], c, cache);

    expect(hydrated.category_name).toBeNull();
    expect(c.warnings).toEqual([]);
  });

  it("preserves tag_ids order with null placeholders for unresolved tags", async () => {
    const { cache } = makeCacheWith({
      tags: [makeTag(3, "known")],
    });

    const tx = makeTx({ tag_ids: [3, 999, 3] });
    const [hydrated] = await hydrateTransactions([tx], ctx(), cache);

    expect(hydrated.tag_names).toEqual(["known", null, "known"]);
  });

  it("does not fetch scopes that have no referenced ids", async () => {
    const { cache, fakeClient } = makeCacheWith({});
    const tx = makeTx({
      category_id: null,
      manual_account_id: null,
      plaid_account_id: null,
      tag_ids: [],
      recurring_id: null,
    });

    await hydrateTransactions([tx], ctx(), cache);

    expect(fakeClient.categories.getAll).not.toHaveBeenCalled();
    expect(fakeClient.tags.getAll).not.toHaveBeenCalled();
    expect(fakeClient.manualAccounts.getAll).not.toHaveBeenCalled();
    expect(fakeClient.plaidAccounts.getAll).not.toHaveBeenCalled();
    expect(fakeClient.recurringItems.getAll).not.toHaveBeenCalled();
  });

  it("null fields on a tx produce null name fields without lookups", async () => {
    const { cache, fakeClient } = makeCacheWith({
      // Populated but should not be consulted.
      categories: [makeCategory(7, "Groceries")],
    });

    const tx = makeTx(); // all references null/empty
    const [hydrated] = await hydrateTransactions([tx], ctx(), cache);

    expect(hydrated.category_name).toBeNull();
    expect(hydrated.manual_account_name).toBeNull();
    expect(hydrated.plaid_account_name).toBeNull();
    expect(hydrated.tag_names).toEqual([]);
    expect(hydrated.recurring_payee).toBeNull();
    expect(fakeClient.categories.getAll).not.toHaveBeenCalled();
  });

  it("batches scope refreshes: one fetch per scope for a page of transactions", async () => {
    const { cache, fakeClient } = makeCacheWith({
      categories: [makeCategory(1, "A"), makeCategory(2, "B")],
    });

    const txs = [
      makeTx({ id: 1, category_id: 1 }),
      makeTx({ id: 2, category_id: 2 }),
      makeTx({ id: 3, category_id: 1 }),
      makeTx({ id: 4, category_id: 2 }),
    ];

    await hydrateTransactions(txs, ctx(), cache);

    // Four transactions, one category fetch total.
    expect(fakeClient.categories.getAll).toHaveBeenCalledTimes(1);
  });

  it("pushes a warning and null-fills when a scope refresh fails", async () => {
    const fakeClient: CacheClient = {
      categories: { getAll: vi.fn().mockResolvedValue([]) },
      tags: {
        getAll: vi.fn().mockRejectedValue(new Error("tags down")),
      },
      manualAccounts: { getAll: vi.fn().mockResolvedValue([]) },
      plaidAccounts: { getAll: vi.fn().mockResolvedValue([]) },
      recurringItems: { getAll: vi.fn().mockResolvedValue([]) },
    };
    const cache = new ScopedTtlCache({ client: fakeClient });

    const tx = makeTx({ tag_ids: [3, 8] });
    const c = ctx();
    const [hydrated] = await hydrateTransactions([tx], c, cache);

    // Hydration did not throw; the transaction is still returned.
    expect(hydrated.tag_names).toEqual([null, null]);
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]?.scope).toBe("tags");
    expect(c.warnings[0]?.reason).toContain("tags down");
  });

  it("does not mutate input transactions", async () => {
    const { cache } = makeCacheWith({
      categories: [makeCategory(7, "Groceries")],
    });
    const tx = makeTx({ category_id: 7 });
    const snapshot = JSON.stringify(tx);

    await hydrateTransactions([tx], ctx(), cache);

    expect(JSON.stringify(tx)).toBe(snapshot);
    expect((tx as unknown as { category_name?: unknown }).category_name).toBeUndefined();
  });
});

describe("hydrateTransaction (single-item wrapper)", () => {
  it("delegates to hydrateTransactions and returns a single hydrated object", async () => {
    const { cache } = makeCacheWith({
      categories: [makeCategory(7, "Groceries")],
    });
    const tx = makeTx({ category_id: 7 });

    const hydrated = await hydrateTransaction(tx, ctx(), cache);

    expect(hydrated.category_name).toBe("Groceries");
    expect(hydrated.id).toBe(tx.id);
  });
});
