/**
 * Public entrypoint for the hydration cache.
 *
 * Re-exports the ScopedTtlCache class and its types, and provides a
 * process-wide singleton `cache` that tool handlers import. The singleton
 * is constructed with no options so it uses the default 5-minute TTL and
 * the shared LunchMoneyClient from `../client.js`.
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

import { ScopedTtlCache } from "./store.js";

export const cache = new ScopedTtlCache();
