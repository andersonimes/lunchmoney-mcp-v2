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
  /**
   * Monotonic counter bumped by every `invalidate(scope)` call. A refresh
   * in progress captures the generation at start and discards its result
   * if the value has changed by the time the fetch completes, so that a
   * pre-invalidation refresh cannot overwrite post-invalidation state.
   */
  generation: number;
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
      // A concurrent caller already kicked off a refresh. Await the same
      // promise so we coalesce to a single underlying fetch, but catch
      // any rejection locally so that this caller honors the "never
      // throws" contract. Each concurrent caller records its own warning
      // into its own HydrationContext.
      try {
        await entry.inFlight;
      } catch (err) {
        ctx.warnings.push({ scope, reason: shortReason(err) });
      }
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
      ctx.warnings.push({ scope, reason: shortReason(err) });
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
   * Bumps `generation` to cancel any refresh currently in flight: a
   * refresh that started before this invalidate() will discard its
   * result on completion rather than stamping pre-invalidation data
   * back onto the scope. This preserves write-through semantics even
   * when an invalidate races a concurrent read.
   *
   * `inFlight` and `lastError` are intentionally preserved: the
   * concurrent refresh is still allowed to complete (and the coalesced
   * caller awaiting it will return normally), we just discard the data
   * it would have written.
   */
  invalidate(scope: CacheScope): void {
    const entry = this.scopes[scope];
    entry.refreshedAt = 0;
    entry.data.clear();
    entry.generation += 1;
  }

  /** Invalidate every scope. Useful for test isolation and full resets. */
  invalidateAll(): void {
    for (const scope of ALL_SCOPES) {
      this.invalidate(scope);
    }
  }

  private async refresh(scope: CacheScope): Promise<void> {
    const entry = this.scopes[scope];
    // Capture the generation at refresh start. If `invalidate(scope)`
    // runs while we are awaiting the fetch, entry.generation will
    // differ when we come back and we discard the result.
    const startGeneration = entry.generation;

    switch (scope) {
      case "categories": {
        const list = await this.client.categories.getAll();
        if (entry.generation !== startGeneration) return;
        entry.data = toIdNameMap(list);
        break;
      }
      case "tags": {
        const list = await this.client.tags.getAll();
        if (entry.generation !== startGeneration) return;
        entry.data = toIdNameMap(list);
        break;
      }
      case "manualAccounts": {
        const list = await this.client.manualAccounts.getAll();
        if (entry.generation !== startGeneration) return;
        entry.data = toIdNameMap(list);
        break;
      }
      case "plaidAccounts": {
        const list = await this.client.plaidAccounts.getAll();
        if (entry.generation !== startGeneration) return;
        entry.data = toIdNameMap(list);
        break;
      }
      case "recurringItems": {
        const list = await this.client.recurringItems.getAll();
        if (entry.generation !== startGeneration) return;
        entry.data = toRecurringPayeeMap(list);
        break;
      }
    }

    entry.refreshedAt = Date.now();
  }
}

function emptyScope(): ScopeEntry {
  return { data: new Map(), refreshedAt: 0, generation: 0 };
}

/**
 * Build a `{id → name}` map from a list of resource objects whose shape
 * is `{ id: number; name: string }`. Used by the categories, tags,
 * manualAccounts, and plaidAccounts cache scopes — all four resource
 * types have the same relevant surface.
 */
function toIdNameMap<T extends { id: number; name: string }>(
  items: readonly T[],
): Map<number, string> {
  const next = new Map<number, string>();
  for (const item of items) {
    next.set(item.id, item.name);
  }
  return next;
}

/**
 * Build a `{id → payee}` map for the recurringItems scope, applying the
 * payee fallback chain (overrides.payee → transaction_criteria.payee →
 * description) and omitting items for which nothing resolves.
 */
function toRecurringPayeeMap(
  items: readonly RecurringItem[],
): Map<number, string> {
  const next = new Map<number, string>();
  for (const item of items) {
    const payee = resolveRecurringPayee(item);
    if (payee !== null) {
      next.set(item.id, payee);
    }
  }
  return next;
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
