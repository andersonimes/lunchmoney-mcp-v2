import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { client } from "../client.js";
import {
  toCreateManualAccountInput,
  toUpdateManualAccountInput,
} from "./adapters/manual-accounts.js";

// Mirrors `accountTypeEnum` in @lunch-money/lunch-money-js-v2. Used by both
// the create and update manual-account schemas so an LLM caller is rejected
// at the MCP boundary with a clear Zod error instead of a confusing 400 from
// the Lunch Money API when an invalid `type` value is supplied.
export const accountTypeEnumValues = [
  "cash",
  "credit",
  "cryptocurrency",
  "employee compensation",
  "investment",
  "loan",
  "other liability",
  "other asset",
  "real estate",
  "vehicle",
] as const;

// Shared shape for the create_manual_account tool.
// Note: institution_name and display_name are NOT nullable here (v2's
// create-manual-account endpoint rejects null for both). The update
// variant below allows null because v2's update endpoint does.
export const createManualAccountShape = {
  name: z.string().describe("Account name"),
  type: z
    .enum(accountTypeEnumValues)
    .describe(
      "Account type. One of: 'cash', 'credit', 'cryptocurrency', 'employee compensation', 'investment', 'loan', 'other liability', 'other asset', 'real estate', 'vehicle'.",
    ),
  balance: z.union([z.number(), z.string()]).describe("Current balance"),
  institution_name: z.string().optional().describe("Financial institution name"),
  display_name: z.string().optional().describe("Display name"),
  subtype: z.string().optional().describe("Account subtype"),
  currency: z.string().optional().describe("Currency code (e.g. 'usd')"),
  balance_as_of: z.string().optional().describe("Date of balance (YYYY-MM-DD)"),
  status: z.enum(["active", "closed"]).optional().describe("Account status"),
  closed_on: z.string().nullable().optional().describe("Date account was closed"),
  external_id: z.string().nullable().optional().describe("External ID"),
  exclude_from_transactions: z.boolean().optional().describe("Exclude from transaction views"),
};
export const createManualAccountSchema = z.object(createManualAccountShape);

// Shared shape for the update_manual_account tool (minus the `id`
// field, which is destructured out of the handler's input).
export const updateManualAccountShape = {
  id: z.number().describe("Manual account ID to update"),
  name: z.string().optional().describe("Account name"),
  type: z
    .enum(accountTypeEnumValues)
    .optional()
    .describe(
      "Account type. One of: 'cash', 'credit', 'cryptocurrency', 'employee compensation', 'investment', 'loan', 'other liability', 'other asset', 'real estate', 'vehicle'.",
    ),
  balance: z.union([z.number(), z.string()]).optional().describe("Current balance"),
  institution_name: z.string().nullable().optional().describe("Financial institution name"),
  display_name: z.string().nullable().optional().describe("Display name"),
  subtype: z.string().optional().describe("Account subtype"),
  currency: z.string().optional().describe("Currency code"),
  balance_as_of: z.string().optional().describe("Date of balance (YYYY-MM-DD)"),
  status: z.enum(["active", "closed"]).optional().describe("Account status"),
  closed_on: z.string().nullable().optional().describe("Date account was closed"),
  external_id: z.string().nullable().optional().describe("External ID"),
  exclude_from_transactions: z.boolean().optional().describe("Exclude from transaction views"),
};
export const updateManualAccountSchema = z.object(updateManualAccountShape);

export function registerManualAccountTools(server: McpServer) {
  server.tool(
    "get_all_manual_accounts",
    "Get all manually-tracked accounts",
    {},
    async () => {
      const accounts = await client.manualAccounts.getAll();
      return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };
    },
  );

  server.tool(
    "get_manual_account",
    "Get a single manual account by ID",
    { id: z.number().describe("Manual account ID") },
    async ({ id }) => {
      const account = await client.manualAccounts.get(id);
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    },
  );

  server.tool(
    "create_manual_account",
    "Create a new manually-tracked account",
    createManualAccountShape,
    async (params) => {
      const account = await client.manualAccounts.create(toCreateManualAccountInput(params));
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    },
  );

  server.tool(
    "update_manual_account",
    "Update an existing manual account",
    updateManualAccountShape,
    async ({ id, ...data }) => {
      const account = await client.manualAccounts.update(id, toUpdateManualAccountInput(data));
      return { content: [{ type: "text", text: JSON.stringify(account, null, 2) }] };
    },
  );

  server.tool(
    "delete_manual_account",
    "Delete a manual account by ID",
    { id: z.number().describe("Manual account ID to delete") },
    async ({ id }) => {
      await client.manualAccounts.delete(id);
      return { content: [{ type: "text", text: `Manual account ${id} deleted successfully.` }] };
    },
  );
}
