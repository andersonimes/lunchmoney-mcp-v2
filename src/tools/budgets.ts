import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client } from "../client.js";
import { toUpsertBudgetInput } from "./adapters/budgets.js";

// Shared shape for the upsert_budget tool. Exported as a ZodRawShape so
// server.tool() can consume it directly, and wrapped in z.object() as
// upsertBudgetSchema so the adapter can type its input via z.infer.
export const upsertBudgetShape = {
  start_date: z
    .string()
    .describe(
      "Period start date in YYYY-MM-DD form. Must align with the user's budget period anchor (call get_budget_settings to confirm).",
    ),
  category_id: z.number().describe("Category ID the budget applies to"),
  amount: z
    .union([z.number(), z.string()])
    .describe("Budget amount for the period (number or string for precision)"),
  currency: z
    .string()
    .optional()
    .describe(
      "Three-letter ISO 4217 currency code (e.g. 'usd'). Defaults to the user's primary account currency when omitted.",
    ),
  notes: z.string().nullable().optional().describe("Optional notes for the budget period"),
};
export const upsertBudgetSchema = z.object(upsertBudgetShape);

export function registerBudgetTools(server: McpServer) {
  server.tool(
    "get_budget_settings",
    "Get the user's budget period configuration (granularity, quantity, anchor date, display preferences).",
    {},
    async () => {
      const settings = await client.budgets.getSettings();
      return { content: [{ type: "text", text: JSON.stringify(settings, null, 2) }] };
    },
  );

  server.tool(
    "upsert_budget",
    "Set or change a budget for a category and period. Upsert semantics: replaces an existing entry rather than rejecting it.",
    upsertBudgetShape,
    async (params) => {
      const result = await client.budgets.upsert(toUpsertBudgetInput(params));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "remove_budget",
    "Remove a budget for a category and period. Idempotent: returns success whether or not a budget existed for the period.",
    {
      category_id: z.number().describe("Category ID whose budget should be removed"),
      start_date: z
        .string()
        .describe("Period start date in YYYY-MM-DD form. Must align with the user's budget period anchor."),
    },
    async ({ category_id, start_date }) => {
      await client.budgets.delete({ category_id, start_date });
      return {
        content: [
          {
            type: "text",
            text: `Budget for category ${category_id} on ${start_date} deleted (or did not exist).`,
          },
        ],
      };
    },
  );
}
