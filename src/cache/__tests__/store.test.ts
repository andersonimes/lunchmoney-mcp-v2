import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  Category,
  ManualAccount,
  PlaidAccount,
  RecurringItem,
  Tag,
} from "@lunch-money/lunch-money-js-v2";

// Stub the shared LunchMoneyClient so importing store.ts does not trigger
// the token-required exit in src/client.ts. Every test in this file
// constructs its own ScopedTtlCache with an explicit fake client, so the
// stubbed default is never actually consumed.
vi.mock("../../client.js", () => ({
  client: {},
}));

import {
  ScopedTtlCache,
  type CacheClient,
  type HydrationContext,
} from "../store.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCategory(id: number, name: string): Category {
  return {
    id,
    name,
    description: null,
    is_income: false,
    exclude_from_budget: false,
    exclude_from_totals: false,
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    group_id: null,
    is_group: false,
    archived: false,
    order: null,
    children: [],
  } as unknown as Category;
}

function makeTag(id: number, name: string): Tag {
  return {
    id,
    name,
    description: null,
    text_color: null,
    background_color: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Tag;
}

function makeManualAccount(id: number, name: string): ManualAccount {
  return { id, name } as unknown as ManualAccount;
}

function makePlaidAccount(id: number, name: string): PlaidAccount {
  return { id, name } as unknown as PlaidAccount;
}

function makeRecurring(
  id: number,
  payee: string | null,
  opts: {
    overridesPayee?: string;
    description?: string | null;
  } = {},
): RecurringItem {
  return {
    id,
    description: opts.description ?? null,
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
    overrides:
      opts.overridesPayee !== undefined ? { payee: opts.overridesPayee } : {},
    matches: {
      request_start_date: "2026-01-01",
      request_end_date: "2026-01-31",
      expected_occurrence_dates: [],
      found_transactions: [],
      missing_transaction_dates: [],
    },
  } as unknown as RecurringItem;
}

function freshContext(): HydrationContext {
  return { warnings: [] };
}

/**
 * Build a fresh fake client where every `getAll` is a vi.fn() that can be
 * configured per test. Returns both the client and the direct refs to
 * each getAll mock for ergonomic assertions.
 */
function makeFakeClient(initial: {
  categories?: Category[];
  tags?: Tag[];
  manualAccounts?: ManualAccount[];
  plaidAccounts?: PlaidAccount[];
  recurringItems?: RecurringItem[];
} = {}) {
  const categoriesGetAll = vi.fn<() => Promise<Category[]>>();
  categoriesGetAll.mockResolvedValue(initial.categories ?? []);

  const tagsGetAll = vi.fn<() => Promise<Tag[]>>();
  tagsGetAll.mockResolvedValue(initial.tags ?? []);

  const manualAccountsGetAll = vi.fn<() => Promise<ManualAccount[]>>();
  manualAccountsGetAll.mockResolvedValue(initial.manualAccounts ?? []);

  const plaidAccountsGetAll = vi.fn<() => Promise<PlaidAccount[]>>();
  plaidAccountsGetAll.mockResolvedValue(initial.plaidAccounts ?? []);

  const recurringItemsGetAll = vi.fn<() => Promise<RecurringItem[]>>();
  recurringItemsGetAll.mockResolvedValue(initial.recurringItems ?? []);

  const client: CacheClient = {
    categories: { getAll: categoriesGetAll },
    tags: { getAll: tagsGetAll },
    manualAccounts: { getAll: manualAccountsGetAll },
    plaidAccounts: { getAll: plaidAccountsGetAll },
    recurringItems: { getAll: recurringItemsGetAll },
  };

  return {
    client,
    categoriesGetAll,
    tagsGetAll,
    manualAccountsGetAll,
    plaidAccountsGetAll,
    recurringItemsGetAll,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScopedTtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cold ensureFresh populates data and calls client.getAll once", async () => {
    const fake = makeFakeClient({
      categories: [makeCategory(1, "Groceries"), makeCategory(2, "Rent")],
    });
    const cache = new ScopedTtlCache({ client: fake.client });
    const ctx = freshContext();

    await cache.ensureFresh("categories", ctx);

    expect(fake.categoriesGetAll).toHaveBeenCalledTimes(1);
    expect(cache.lookup("categories", 1)).toBe("Groceries");
    expect(cache.lookup("categories", 2)).toBe("Rent");
    expect(cache.lookup("categories", 99)).toBeUndefined();
    expect(ctx.warnings).toEqual([]);
  });

  it("ensureFresh within TTL does not trigger a second fetch", async () => {
    const fake = makeFakeClient({
      tags: [makeTag(10, "work")],
    });
    const cache = new ScopedTtlCache({ client: fake.client, ttlMs: 60_000 });
    const ctx = freshContext();

    await cache.ensureFresh("tags", ctx);
    await cache.ensureFresh("tags", ctx);
    await cache.ensureFresh("tags", ctx);

    expect(fake.tagsGetAll).toHaveBeenCalledTimes(1);
    expect(cache.lookup("tags", 10)).toBe("work");
  });

  it("ensureFresh after TTL expiry triggers a refresh", async () => {
    const fake = makeFakeClient({
      manualAccounts: [makeManualAccount(1, "Chase Checking")],
    });
    const cache = new ScopedTtlCache({ client: fake.client, ttlMs: 1_000 });
    const ctx = freshContext();

    await cache.ensureFresh("manualAccounts", ctx);
    expect(fake.manualAccountsGetAll).toHaveBeenCalledTimes(1);

    // Advance past TTL.
    vi.advanceTimersByTime(2_000);

    // Simulate the name having changed upstream.
    fake.manualAccountsGetAll.mockResolvedValueOnce([
      makeManualAccount(1, "Chase Primary"),
    ]);

    await cache.ensureFresh("manualAccounts", ctx);
    expect(fake.manualAccountsGetAll).toHaveBeenCalledTimes(2);
    expect(cache.lookup("manualAccounts", 1)).toBe("Chase Primary");
  });

  it("invalidate clears data and forces the next ensureFresh to refetch", async () => {
    const fake = makeFakeClient({
      plaidAccounts: [makePlaidAccount(42, "Amex Platinum")],
    });
    const cache = new ScopedTtlCache({ client: fake.client });
    const ctx = freshContext();

    await cache.ensureFresh("plaidAccounts", ctx);
    expect(cache.lookup("plaidAccounts", 42)).toBe("Amex Platinum");

    // Simulate a rename upstream.
    fake.plaidAccountsGetAll.mockResolvedValueOnce([
      makePlaidAccount(42, "Amex Gold"),
    ]);

    cache.invalidate("plaidAccounts");
    // After invalidation, lookup misses immediately.
    expect(cache.lookup("plaidAccounts", 42)).toBeUndefined();

    await cache.ensureFresh("plaidAccounts", ctx);
    expect(fake.plaidAccountsGetAll).toHaveBeenCalledTimes(2);
    expect(cache.lookup("plaidAccounts", 42)).toBe("Amex Gold");
  });

  it("concurrent ensureFresh calls on cold cache coalesce to one fetch", async () => {
    let resolveFetch: ((value: Category[]) => void) | undefined;
    const pending = new Promise<Category[]>((resolve) => {
      resolveFetch = resolve;
    });

    const fake = makeFakeClient();
    fake.categoriesGetAll.mockReturnValueOnce(pending);

    const cache = new ScopedTtlCache({ client: fake.client });
    const ctx = freshContext();

    const first = cache.ensureFresh("categories", ctx);
    const second = cache.ensureFresh("categories", ctx);
    const third = cache.ensureFresh("categories", ctx);

    // Release the fetch.
    resolveFetch?.([makeCategory(7, "Dining")]);
    await Promise.all([first, second, third]);

    expect(fake.categoriesGetAll).toHaveBeenCalledTimes(1);
    expect(cache.lookup("categories", 7)).toBe("Dining");
  });

  it("failed refresh pushes a HydrationWarning and leaves the scope recoverable", async () => {
    const fake = makeFakeClient();
    fake.tagsGetAll.mockRejectedValueOnce(new Error("tags endpoint down"));

    const cache = new ScopedTtlCache({ client: fake.client });
    const ctx = freshContext();

    await cache.ensureFresh("tags", ctx);

    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]?.scope).toBe("tags");
    expect(ctx.warnings[0]?.reason).toContain("tags endpoint down");
    expect(cache.lookup("tags", 1)).toBeUndefined();

    // Next call should retry and succeed.
    fake.tagsGetAll.mockResolvedValueOnce([makeTag(1, "reimbursable")]);
    const ctx2 = freshContext();
    await cache.ensureFresh("tags", ctx2);

    expect(fake.tagsGetAll).toHaveBeenCalledTimes(2);
    expect(ctx2.warnings).toEqual([]);
    expect(cache.lookup("tags", 1)).toBe("reimbursable");
  });

  it("recurringItems refresh uses overrides.payee when present", async () => {
    const fake = makeFakeClient({
      recurringItems: [
        makeRecurring(1, "WHOLEFDS #123", { overridesPayee: "Whole Foods" }),
      ],
    });
    const cache = new ScopedTtlCache({ client: fake.client });

    await cache.ensureFresh("recurringItems", freshContext());

    expect(cache.lookup("recurringItems", 1)).toBe("Whole Foods");
  });

  it("recurringItems refresh falls back to transaction_criteria.payee", async () => {
    const fake = makeFakeClient({
      recurringItems: [makeRecurring(2, "Netflix")],
    });
    const cache = new ScopedTtlCache({ client: fake.client });

    await cache.ensureFresh("recurringItems", freshContext());

    expect(cache.lookup("recurringItems", 2)).toBe("Netflix");
  });

  it("recurringItems refresh falls back to description when both payees are null", async () => {
    const fake = makeFakeClient({
      recurringItems: [
        makeRecurring(3, null, { description: "Quarterly HOA" }),
      ],
    });
    const cache = new ScopedTtlCache({ client: fake.client });

    await cache.ensureFresh("recurringItems", freshContext());

    expect(cache.lookup("recurringItems", 3)).toBe("Quarterly HOA");
  });

  it("recurringItems refresh omits items with no resolvable payee", async () => {
    const fake = makeFakeClient({
      recurringItems: [
        makeRecurring(4, null, { description: null }),
        makeRecurring(5, "Spotify"),
      ],
    });
    const cache = new ScopedTtlCache({ client: fake.client });

    await cache.ensureFresh("recurringItems", freshContext());

    expect(cache.lookup("recurringItems", 4)).toBeUndefined();
    expect(cache.lookup("recurringItems", 5)).toBe("Spotify");
  });

  it("invalidateAll clears every scope", async () => {
    const fake = makeFakeClient({
      categories: [makeCategory(1, "Groceries")],
      tags: [makeTag(2, "work")],
    });
    const cache = new ScopedTtlCache({ client: fake.client });
    const ctx = freshContext();

    await cache.ensureFresh("categories", ctx);
    await cache.ensureFresh("tags", ctx);
    expect(cache.lookup("categories", 1)).toBe("Groceries");
    expect(cache.lookup("tags", 2)).toBe("work");

    cache.invalidateAll();

    expect(cache.lookup("categories", 1)).toBeUndefined();
    expect(cache.lookup("tags", 2)).toBeUndefined();
  });
});
