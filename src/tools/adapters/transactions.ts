import type { LunchMoneyClient } from "@lunch-money/lunch-money-js-v2";
import type { z } from "zod";
import type {
  createTransactionsSchema,
  updateTransactionSchema,
  updateTransactionsSchema,
} from "../transactions.js";

// Project the v2 client's write-path input types off the class itself.
// @lunch-money/lunch-money-js-v2 does not export these body types directly,
// so we walk the getter-returned shape via Parameters<> to name them.
type TxResource = LunchMoneyClient["transactions"];
type CreateTxInput = Parameters<TxResource["create"]>[0];
type UpdateTxInput = Parameters<TxResource["update"]>[1];
type UpdateManyTxInput = Parameters<TxResource["updateMany"]>[0];

// A `currency` widening type alias used inside the adapters below. The
// schema deliberately keeps `currency` as z.string() for LLM ergonomics
// (so the LLM doesn't have to memorize the full v2 currencyEnum, which
// is >150 ISO codes). The adapter is the one place we widen from `string`
// to the narrow enum — at a single field on a single line — and the
// cost is bounded there. See specs/002-fix-any-casts/research.md for
// why this is not a strategy-(c) upstream-bug case: the v2 enum is
// correct, we are choosing to be looser at the MCP surface on purpose.
type CurrencyEnum = NonNullable<
  NonNullable<CreateTxInput["transactions"][number]["currency"]>
>;

/**
 * Convert the `create_transactions` tool's schema output into the v2
 * client's CreateTransactionsBody. Passes every field through unchanged
 * except `transactions[].currency`, which is widened from `string` to
 * `currencyEnum` at the boundary.
 */
export function toCreateTransactionsInput(
  params: z.infer<typeof createTransactionsSchema>,
): CreateTxInput {
  return {
    ...params,
    transactions: params.transactions.map((tx) => ({
      ...tx,
      // Lossy widening: schema accepts any string; v2 accepts a narrow enum.
      currency: tx.currency as CurrencyEnum | undefined,
    })),
  };
}

/**
 * Convert the `update_transaction` tool's schema output (after `id` has
 * been destructured out) into the v2 client's UpdateTransactionBody.
 * Widens `currency` the same way `toCreateTransactionsInput` does.
 */
export function toUpdateTransactionInput(
  data: Omit<z.infer<typeof updateTransactionSchema>, "id">,
): UpdateTxInput {
  return {
    ...data,
    currency: data.currency as CurrencyEnum | undefined,
  };
}

/**
 * Convert the `update_transactions` (bulk) tool's schema output into
 * the v2 client's UpdateTransactionsBody. Composes
 * `toUpdateTransactionInput` over each element of the `transactions`
 * array so the two bulk and single-update handlers stay in lockstep:
 * any future change to the single-update conversion automatically
 * propagates to the bulk path.
 */
export function toUpdateTransactionsInput(
  params: z.infer<typeof updateTransactionsSchema>,
): UpdateManyTxInput {
  return {
    transactions: params.transactions.map(({ id, ...rest }) => ({
      id,
      ...toUpdateTransactionInput(rest),
    })),
  };
}
