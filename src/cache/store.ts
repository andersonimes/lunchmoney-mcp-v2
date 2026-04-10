import type {
  Category,
  ManualAccount,
  PlaidAccount,
  RecurringItem,
  Tag,
} from "@lunch-money/lunch-money-js-v2";

import { client as defaultClient } from "../client.js";

/**
 * Default time-to-live for cache entries (5 minutes).
 *
 * Hydration lookups are served from an in-process cache that refreshes
 * lazily when a read arrives after this window has passed. The value is
 * exported so tests can pass a shorter TTL into the cache constructor.
 */
export const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * The five resource types the hydration layer resolves into human-readable
 * names. Each is a scope in the ScopedTtlCache. This union is closed — no
 * new scopes are added without updating the refresh method and every
 * consumer of the cache.
 */
export type CacheScope =
  | "categories"
  | "tags"
  | "manualAccounts"
  | "plaidAccounts"
  | "recurringItems";

const ALL_SCOPES: readonly CacheScope[] = [
  "categories",
  "tags",
  "manualAccounts",
  "plaidAccounts",
  "recurringItems",
] as const;

/**
 * Emitted when a cache scope failed to refresh during the current tool
 * call. Accumulated on a HydrationContext and surfaced to the caller via
 * the top-level `hydration_warnings` field on a tool response (unless the
 * tool was invoked with `raw: true`).
 */
export interface HydrationWarning {
  scope: CacheScope;
  reason: string;
}

/**
 * Per-call state threaded through hydration. Holds the warnings gathered
 * during the current tool invocation. A fresh context is created at the
 * start of each tool call that hydrates.
 */
export interface HydrationContext {
  warnings: HydrationWarning[];
}

interface ScopeEntry {
  data: Map<number, string>;
  refreshedAt: number;
  inFlight?: Promise<void>;
  lastError?: string;
}

/**
 * Structural subset of LunchMoneyClient that ScopedTtlCache depends on.
 * The real client from `@lunch-money/lunch-money-js-v2` satisfies this
 * interface; test fakes can be constructed as plain objects without
 * needing to extend or cast from LunchMoneyClient.
 */
export interface CacheClient {
  categories: { getAll: () => Promise<Category[]> };
  tags: { getAll: () => Promise<Tag[]> };
  manualAccounts: { getAll: () => Promise<ManualAccount[]> };
  plaidAccounts: { getAll: () => Promise<PlaidAccount[]> };
  recurringItems: { getAll: () => Promise<RecurringItem[]> };
}

export interface ScopedTtlCacheOptions {
  ttlMs?: number;
  client?: CacheClient;
}

/**
 * In-process TTL cache for hydration lookups.
 *
 * One ScopedTtlCache instance holds five scopes (categories, tags, manual
 * accounts, plaid accounts, recurring items). Each scope stores `{id →
 * human-readable-name}` and tracks when it was last refreshed. Reads are
 * served directly from the map; `ensureFresh` transparently refreshes a
 * scope when its data is older than `ttlMs` or has never been populated.
 *
 * Writes to any cached resource (from a tool that creates/updates/deletes
 * the resource) MUST invoke `invalidate(scope)` before returning so that
 * the next read sees the updated data without waiting for TTL expiry.
 *
 * State lives only inside the process — there is no persistence and no
 * cross-instance sharing.
 */
export class ScopedTtlCache {
  private readonly ttlMs: number;
  private readonly client: CacheClient;
  private readonly scopes: Record<CacheScope, ScopeEntry>;

  constructor(options: ScopedTtlCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.client = options.client ?? defaultClient;
    this.scopes = {
      categories: emptyScope(),
      tags: emptyScope(),
      manualAccounts: emptyScope(),
      plaidAccounts: emptyScope(),
      recurringItems: emptyScope(),
    };
  }

  /**
   * Ensure the named scope has data no older than `ttlMs`. Refreshes if
   * expired or empty. If a concurrent caller is already refreshing,
   * awaits that caller's promise instead of launching a second fetch
   * (in-flight coalescing). On refresh failure, records a warning on
   * `ctx` and leaves the scope in a recoverable state; the next call
   * will retry.
   *
   * Never throws. Failures degrade to null lookups plus a warning.
   */
  async ensureFresh(scope: CacheScope, ctx: HydrationContext): Promise<void> {
    const entry = this.scopes[scope];

    if (entry.inFlight) {
      await entry.inFlight;
      return;
    }

    if (entry.refreshedAt > 0 && Date.now() - entry.refreshedAt < this.ttlMs) {
      return;
    }

    const pending = this.refresh(scope);
    entry.inFlight = pending;
    try {
      await pending;
    } catch (err) {
      const reason = shortReason(err);
      ctx.warnings.push({ scope, reason });
      entry.lastError = reason;
    } finally {
      entry.inFlight = undefined;
    }
  }

  /** Look up the human-readable name for an id in the given scope. */
  lookup(scope: CacheScope, id: number): string | undefined {
    return this.scopes[scope].data.get(id);
  }

  /**
   * Drop all cached entries for a scope and reset its refresh timestamp.
   * The next `ensureFresh` call on this scope will perform a full fetch.
   *
   * `inFlight` and `lastError` are intentionally preserved so a
   * concurrent in-progress refresh is not interrupted and the most
   * recent error remains visible until the next successful refresh
   * overwrites it.
   */
  invalidate(scope: CacheScope): void {
    const entry = this.scopes[scope];
    entry.refreshedAt = 0;
    entry.data.clear();
  }

  /** Invalidate every scope. Useful for test isolation and full resets. */
  invalidateAll(): void {
    for (const scope of ALL_SCOPES) {
      this.invalidate(scope);
    }
  }

  private async refresh(scope: CacheScope): Promise<void> {
    const entry = this.scopes[scope];

    switch (scope) {
      case "categories": {
        const list = await this.client.categories.getAll();
        const next = new Map<number, string>();
        for (const item of list) {
          next.set(item.id, item.name);
        }
        entry.data = next;
        break;
      }
      case "tags": {
        const list = await this.client.tags.getAll();
        const next = new Map<number, string>();
        for (const item of list) {
          next.set(item.id, item.name);
        }
        entry.data = next;
        break;
      }
      case "manualAccounts": {
        const list = await this.client.manualAccounts.getAll();
        const next = new Map<number, string>();
        for (const item of list) {
          next.set(item.id, item.name);
        }
        entry.data = next;
        break;
      }
      case "plaidAccounts": {
        const list = await this.client.plaidAccounts.getAll();
        const next = new Map<number, string>();
        for (const item of list) {
          next.set(item.id, item.name);
        }
        entry.data = next;
        break;
      }
      case "recurringItems": {
        const list = await this.client.recurringItems.getAll();
        const next = new Map<number, string>();
        for (const item of list) {
          const payee = resolveRecurringPayee(item);
          if (payee !== null) {
            next.set(item.id, payee);
          }
        }
        entry.data = next;
        break;
      }
    }

    entry.refreshedAt = Date.now();
    entry.lastError = undefined;
  }
}

function emptyScope(): ScopeEntry {
  return { data: new Map(), refreshedAt: 0 };
}

/**
 * Resolve a recurring item to the string most likely to match the user's
 * mental model of "what this recurring is called." Prefers the explicit
 * override payee, falls back to the source pattern payee, then to the
 * user-authored description, and finally null when nothing is usable.
 */
function resolveRecurringPayee(item: RecurringItem): string | null {
  return (
    item.overrides?.payee ??
    item.transaction_criteria.payee ??
    item.description ??
    null
  );
}

function shortReason(err: unknown): string {
  const raw = err instanceof Error ? err.message || String(err) : String(err);
  return raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
}
