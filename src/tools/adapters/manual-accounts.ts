import type { LunchMoneyClient } from "@lunch-money/lunch-money-js-v2";
import type { z } from "zod";
import type {
  createManualAccountSchema,
  updateManualAccountSchema,
} from "../manual-accounts.js";

// Project the v2 client's manual-account write-path input types off the
// class itself. @lunch-money/lunch-money-js-v2 does not export these body
// types directly; walking the getter-returned shape via Parameters<> is
// the workable pattern. See src/tools/adapters/transactions.ts for the
// same pattern applied to the transactions resource.
type ManualAcctsResource = LunchMoneyClient["manualAccounts"];
type CreateManualAcctInput = Parameters<ManualAcctsResource["create"]>[0];
type UpdateManualAcctInput = Parameters<ManualAcctsResource["update"]>[1];

// Narrow currency enum reused across both adapters. The schema keeps
// `currency` as z.string() for LLM ergonomics (>150 ISO codes would
// bloat the tool description), so we widen here at a single boundary
// and nowhere else.
type CurrencyEnum = NonNullable<CreateManualAcctInput["currency"]>;

/**
 * Convert the `create_manual_account` tool's schema output into the v2
 * client's CreateManualAccountBody. Passes every field through unchanged
 * except `currency`, which is widened from `string` to `currencyEnum`.
 *
 * Note: the schema's `institution_name` and `display_name` are
 * already non-nullable strings (the create endpoint does not accept
 * null), so they pass through as-is. The update variant below allows
 * null for both because v2's update endpoint does.
 */
export function toCreateManualAccountInput(
  params: z.infer<typeof createManualAccountSchema>,
): CreateManualAcctInput {
  return {
    ...params,
    currency: params.currency as CurrencyEnum | undefined,
  };
}

/**
 * Convert the `update_manual_account` tool's schema output (after `id`
 * has been destructured out) into the v2 client's
 * UpdateManualAccountBody. Widens `currency` the same way
 * `toCreateManualAccountInput` does. Preserves `institution_name` and
 * `display_name` nullability because v2's update endpoint accepts
 * `string | null` for both.
 */
export function toUpdateManualAccountInput(
  data: Omit<z.infer<typeof updateManualAccountSchema>, "id">,
): UpdateManualAcctInput {
  return {
    ...data,
    currency: data.currency as CurrencyEnum | undefined,
  };
}
