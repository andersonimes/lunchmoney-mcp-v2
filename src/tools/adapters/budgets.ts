import type { UpsertBudgetBody } from "@lunch-money/lunch-money-js-v2";
import type { z } from "zod";
import type { upsertBudgetSchema } from "../budgets.js";

// The schema keeps `currency` as z.string() for LLM ergonomics — the v2
// client narrows it to a >150-value ISO-4217 enum (`currencyEnum`), and
// inlining all those codes into the tool description would balloon the
// prompt that the LLM sees. The widening happens here, at one boundary,
// on a single field. Same pattern as src/tools/adapters/transactions.ts
// and src/tools/adapters/manual-accounts.ts. Not a strategy-(c) cast —
// no upstream bug; we are deliberately looser at the MCP surface.
type CurrencyEnum = NonNullable<UpsertBudgetBody["currency"]>;

/**
 * Convert the `upsert_budget` tool's schema output into the v2 client's
 * UpsertBudgetBody. Passes every field through unchanged except
 * `currency`, which is widened from `string` to `currencyEnum`.
 */
export function toUpsertBudgetInput(
  data: z.infer<typeof upsertBudgetSchema>,
): UpsertBudgetBody {
  return {
    ...data,
    currency: data.currency as CurrencyEnum | undefined,
  };
}
