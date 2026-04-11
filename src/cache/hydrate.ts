import type { Transaction } from "@lunch-money/lunch-money-js-v2";

import { cache as defaultCache } from "./singleton.js";
import {
  ALL_SCOPES,
  type CacheScope,
  type HydrationContext,
  type ScopedTtlCache,
} from "./store.js";

/**
 * A v2 transaction object augmented with human-readable name fields for
 * every reference it carries. The name fields live at the top level
 * alongside the existing `*_id` fields; the original v2 fields are
 * preserved exactly. A null value means the id was null or could not be
 * resolved (either because the referent has been deleted, or because the
 * relevant cache scope failed to refresh — in the latter case a
 * HydrationWarning is also pushed onto the HydrationContext).
 *
 * `tag_names` is order-matched to `tag_ids`; each position contains the
 * resolved name or null if that specific tag could not be resolved.
 */
export type HydratedTransaction = Transaction & {
  category_name: string | null;
  manual_account_name: string | null;
  plaid_account_name: string | null;
  tag_names: (string | null)[];
  recurring_payee: string | null;
};

/**
 * Hydrate an array of v2 transactions. Gathers the set of cache scopes
 * that are referenced by at least one transaction in the input, refreshes
 * those scopes in parallel (refreshes are batched — fetch once per page,
 * not once per transaction), then walks the input a second time to build
 * shallow-cloned hydrated transactions with the five name fields populated.
 *
 * Never mutates the input array or its elements.
 */
export async function hydrateTransactions(
  txs: readonly Transaction[],
  ctx: HydrationContext,
  cacheInstance: ScopedTtlCache = defaultCache,
): Promise<HydratedTransaction[]> {
  const neededScopes = collectNeededScopes(txs);

  await Promise.all(
    neededScopes.map((scope) => cacheInstance.ensureFresh(scope, ctx)),
  );

  return txs.map((tx) => hydrateOne(tx, cacheInstance));
}

/**
 * Hydrate a single v2 transaction. Thin wrapper around
 * `hydrateTransactions` that preserves the single-item return shape.
 */
export async function hydrateTransaction(
  tx: Transaction,
  ctx: HydrationContext,
  cacheInstance: ScopedTtlCache = defaultCache,
): Promise<HydratedTransaction> {
  const [hydrated] = await hydrateTransactions([tx], ctx, cacheInstance);
  // hydrateTransactions always returns an array of the same length as its
  // input, so a single-item input always yields a single-item output.
  return hydrated as HydratedTransaction;
}

function collectNeededScopes(txs: readonly Transaction[]): CacheScope[] {
  const scopes = new Set<CacheScope>();

  for (const tx of txs) {
    if (tx.category_id != null) scopes.add("categories");
    if (tx.tag_ids && tx.tag_ids.length > 0) scopes.add("tags");
    if (tx.manual_account_id != null) scopes.add("manualAccounts");
    if (tx.plaid_account_id != null) scopes.add("plaidAccounts");
    if (tx.recurring_id != null) scopes.add("recurringItems");

    // Early exit: nothing more to discover once every scope is needed.
    // Sized against the authoritative scope list so adding a new scope
    // only requires touching ALL_SCOPES in ./store.ts.
    if (scopes.size === ALL_SCOPES.length) break;
  }

  return Array.from(scopes);
}

function hydrateOne(
  tx: Transaction,
  cacheInstance: ScopedTtlCache,
): HydratedTransaction {
  const category_name =
    tx.category_id != null
      ? (cacheInstance.lookup("categories", tx.category_id) ?? null)
      : null;

  const manual_account_name =
    tx.manual_account_id != null
      ? (cacheInstance.lookup("manualAccounts", tx.manual_account_id) ?? null)
      : null;

  const plaid_account_name =
    tx.plaid_account_id != null
      ? (cacheInstance.lookup("plaidAccounts", tx.plaid_account_id) ?? null)
      : null;

  const tag_names: (string | null)[] = (tx.tag_ids ?? []).map(
    (id) => cacheInstance.lookup("tags", id) ?? null,
  );

  const recurring_payee =
    tx.recurring_id != null
      ? (cacheInstance.lookup("recurringItems", tx.recurring_id) ?? null)
      : null;

  return {
    ...tx,
    category_name,
    manual_account_name,
    plaid_account_name,
    tag_names,
    recurring_payee,
  };
}
