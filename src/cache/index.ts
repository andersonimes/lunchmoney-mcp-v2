/**
 * Public entrypoint for the hydration cache.
 *
 * Re-exports the ScopedTtlCache class, its types, the hydration helpers,
 * and the process-wide singleton `cache` that tool handlers import.
 *
 * The singleton itself lives in `./singleton.ts` rather than here so
 * that `./hydrate.ts` can import it directly without creating a
 * circular dependency through this entrypoint.
 *
 * Tests that need isolation should construct their own `ScopedTtlCache`
 * instance with a fake client rather than mutating the singleton.
 */
export {
  DEFAULT_TTL_MS,
  ScopedTtlCache,
  type CacheClient,
  type CacheScope,
  type HydrationContext,
  type HydrationWarning,
  type ScopedTtlCacheOptions,
} from "./store.js";

export {
  hydrateTransaction,
  hydrateTransactions,
  type HydratedTransaction,
} from "./hydrate.js";

export { cache } from "./singleton.js";
