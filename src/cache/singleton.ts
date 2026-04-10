/**
 * Process-wide singleton ScopedTtlCache used by tool handlers in
 * production. Isolated into its own module so that both the public
 * entry point (`./index.ts`) and the hydration helpers
 * (`./hydrate.ts`) can import it without creating a circular
 * dependency through `./index.ts`.
 *
 * Tests that need isolation should construct their own `ScopedTtlCache`
 * instance (via the constructor's `client` option) rather than
 * mutating or depending on this singleton.
 */
import { ScopedTtlCache } from "./store.js";

export const cache = new ScopedTtlCache();
