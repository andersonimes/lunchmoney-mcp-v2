import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "./mock-client.js";
import { createTestServer } from "./test-helpers.js";
import { registerTransactionTools } from "../transactions.js";
import { cache } from "../../cache/index.js";

describe("transaction tools", () => {
  const { server, tools } = createTestServer();
  registerTransactionTools(server);

  beforeEach(() => {
    // Reset every mocked client method so lingering mockResolvedValueOnce
    // state from a previous test does not bleed across. The hydration cache
    // holds module-level state, so also reset it between tests.
    Object.values(mockClient.transactions).forEach((fn) => fn.mockReset());
    mockClient.categories.getAll.mockReset();
    mockClient.tags.getAll.mockReset();
    mockClient.manualAccounts.getAll.mockReset();
    mockClient.plaidAccounts.getAll.mockReset();
    mockClient.recurringItems.getAll.mockReset();
    // Default: empty maps, so pages whose transactions have no references
    // hydrate trivially without triggering warnings.
    mockClient.categories.getAll.mockResolvedValue([]);
    mockClient.tags.getAll.mockResolvedValue([]);
    mockClient.manualAccounts.getAll.mockResolvedValue([]);
    mockClient.plaidAccounts.getAll.mockResolvedValue([]);
    mockClient.recurringItems.getAll.mockResolvedValue([]);
    cache.invalidateAll();
  });

  const allToolNames = [
    "get_all_transactions",
    "get_transaction",
    "create_transactions",
    "update_transaction",
    "delete_transaction",
    "delete_transactions",
    "update_transactions",
    "split_transaction",
    "unsplit_transaction",
    "group_transactions",
    "ungroup_transaction",
    "attach_file",
    "get_attachment_url",
    "delete_attachment",
  ];

  it("registers all 14 transaction tools", () => {
    allToolNames.forEach((name) => {
      expect(tools.has(name), `Missing tool: ${name}`).toBe(true);
    });
  });

  it("get_all_transactions passes filters to client and does not forward raw to the client", async () => {
    const mockResult = { transactions: [{ id: 1 }], hasMore: false };
    mockClient.transactions.getAll.mockResolvedValue(mockResult);

    const result = await tools.get("get_all_transactions")!.handler({
      start_date: "2024-01-01",
      end_date: "2024-01-31",
      category_id: 5,
      raw: true,
    });
    // With raw:true, the output is byte-identical to the client response.
    expect(JSON.parse(result.content[0].text)).toEqual(mockResult);
    // The raw parameter must not be passed through to the underlying client.
    expect(mockClient.transactions.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: "2024-01-01", category_id: 5 }),
    );
    const forwardedParams = mockClient.transactions.getAll.mock.calls[0]?.[0];
    expect(forwardedParams).not.toHaveProperty("raw");
  });

  it("get_transaction with raw:true returns the unmodified v2 response", async () => {
    const mockTx = { id: 99, payee: "Coffee Shop", amount: -5.0 };
    mockClient.transactions.get.mockResolvedValue(mockTx);

    const result = await tools.get("get_transaction")!.handler({
      id: 99,
      raw: true,
    });
    expect(JSON.parse(result.content[0].text)).toEqual(mockTx);
  });

  it("create_transactions passes transaction array", async () => {
    const mockResponse = { ids: [1, 2] };
    mockClient.transactions.create.mockResolvedValue(mockResponse);

    const params = {
      transactions: [
        { date: "2024-01-15", payee: "Store", amount: 25.0 },
        { date: "2024-01-16", payee: "Gas", amount: 40.0 },
      ],
      apply_rules: true,
    };
    const result = await tools.get("create_transactions")!.handler(params);
    expect(JSON.parse(result.content[0].text)).toEqual(mockResponse);
  });

  it("update_transaction separates id from data", async () => {
    const updated = { id: 10, payee: "Updated Payee" };
    mockClient.transactions.update.mockResolvedValue(updated);

    await tools.get("update_transaction")!.handler({ id: 10, payee: "Updated Payee" });
    expect(mockClient.transactions.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ payee: "Updated Payee" }),
    );
  });

  it("delete_transaction calls client", async () => {
    mockClient.transactions.delete.mockResolvedValue(undefined);

    const result = await tools.get("delete_transaction")!.handler({ id: 7 });
    expect(result.content[0].text).toContain("deleted successfully");
    expect(mockClient.transactions.delete).toHaveBeenCalledWith(7);
  });

  it("delete_transactions bulk deletes", async () => {
    mockClient.transactions.deleteMany.mockResolvedValue(undefined);

    const result = await tools.get("delete_transactions")!.handler({ ids: [1, 2, 3] });
    expect(result.content[0].text).toContain("3 transaction(s) deleted");
    expect(mockClient.transactions.deleteMany).toHaveBeenCalledWith({ ids: [1, 2, 3] });
  });

  it("split_transaction calls client with child transactions", async () => {
    const splitResult = { id: 5, children: [{ id: 6 }, { id: 7 }] };
    mockClient.transactions.split.mockResolvedValue(splitResult);

    await tools.get("split_transaction")!.handler({
      id: 5,
      child_transactions: [{ amount: 10 }, { amount: 15 }],
    });
    expect(mockClient.transactions.split).toHaveBeenCalledWith(5, {
      child_transactions: [{ amount: 10 }, { amount: 15 }],
    });
  });

  it("unsplit_transaction calls client", async () => {
    mockClient.transactions.unsplit.mockResolvedValue(undefined);

    const result = await tools.get("unsplit_transaction")!.handler({ id: 5 });
    expect(result.content[0].text).toContain("unsplit successfully");
  });

  it("group_transactions passes all params", async () => {
    const grouped = { id: 100 };
    mockClient.transactions.group.mockResolvedValue(grouped);

    await tools.get("group_transactions")!.handler({
      ids: [1, 2],
      date: "2024-01-01",
      payee: "Grouped",
    });
    expect(mockClient.transactions.group).toHaveBeenCalledWith(
      expect.objectContaining({ ids: [1, 2], date: "2024-01-01", payee: "Grouped" }),
    );
  });

  it("ungroup_transaction calls client", async () => {
    mockClient.transactions.ungroup.mockResolvedValue(undefined);

    const result = await tools.get("ungroup_transaction")!.handler({ id: 100 });
    expect(result.content[0].text).toContain("ungrouped successfully");
  });

  it("get_attachment_url calls client with file_id", async () => {
    const mockUrl = { url: "https://example.com/file.pdf" };
    mockClient.transactions.getAttachmentUrl.mockResolvedValue(mockUrl);

    const result = await tools.get("get_attachment_url")!.handler({ file_id: 42 });
    expect(JSON.parse(result.content[0].text)).toEqual(mockUrl);
    expect(mockClient.transactions.getAttachmentUrl).toHaveBeenCalledWith(42);
  });

  it("delete_attachment calls client with file_id", async () => {
    mockClient.transactions.deleteAttachment.mockResolvedValue(undefined);

    const result = await tools.get("delete_attachment")!.handler({ file_id: 42 });
    expect(result.content[0].text).toContain("deleted successfully");
    expect(mockClient.transactions.deleteAttachment).toHaveBeenCalledWith(42);
  });

  // ---------------------------------------------------------------------
  // Hydration behavior (default) and raw escape hatch
  // ---------------------------------------------------------------------

  describe("hydration", () => {
    it("get_all_transactions hydrates every reference by default", async () => {
      mockClient.transactions.getAll.mockResolvedValue({
        transactions: [
          {
            id: 100,
            payee: "WHOLE FOODS",
            category_id: 7,
            manual_account_id: null,
            plaid_account_id: 11,
            tag_ids: [3, 8],
            recurring_id: 22,
          },
        ],
        hasMore: false,
      });
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Groceries" },
      ]);
      mockClient.tags.getAll.mockResolvedValue([
        { id: 3, name: "work" },
        { id: 8, name: "reimbursable" },
      ]);
      mockClient.plaidAccounts.getAll.mockResolvedValue([
        { id: 11, name: "Chase Checking" },
      ]);
      mockClient.recurringItems.getAll.mockResolvedValue([
        {
          id: 22,
          description: null,
          transaction_criteria: { payee: "Whole Foods" },
          overrides: {},
        },
      ]);

      const result = await tools.get("get_all_transactions")!.handler({});
      const body = JSON.parse(result.content[0].text);

      expect(body.transactions).toHaveLength(1);
      const tx = body.transactions[0];
      expect(tx.id).toBe(100);
      expect(tx.category_name).toBe("Groceries");
      expect(tx.manual_account_name).toBeNull();
      expect(tx.plaid_account_name).toBe("Chase Checking");
      expect(tx.tag_names).toEqual(["work", "reimbursable"]);
      expect(tx.recurring_payee).toBe("Whole Foods");
      expect(body.hasMore).toBe(false);
      expect(body.hydration_warnings).toBeUndefined();
    });

    it("get_all_transactions with raw:true omits all hydrated fields and hydration_warnings", async () => {
      const mockResult = {
        transactions: [
          {
            id: 100,
            category_id: 7,
            tag_ids: [3],
          },
        ],
        hasMore: false,
      };
      mockClient.transactions.getAll.mockResolvedValue(mockResult);
      // Populate lookup maps so we can confirm they are NOT consulted.
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Groceries" },
      ]);

      const result = await tools.get("get_all_transactions")!.handler({ raw: true });
      const body = JSON.parse(result.content[0].text);

      expect(body).toEqual(mockResult);
      expect(body.transactions[0]).not.toHaveProperty("category_name");
      expect(body.transactions[0]).not.toHaveProperty("tag_names");
      expect(body).not.toHaveProperty("hydration_warnings");
      expect(mockClient.categories.getAll).not.toHaveBeenCalled();
    });

    it("get_transaction hydrates the returned transaction by default", async () => {
      mockClient.transactions.get.mockResolvedValue({
        id: 5,
        category_id: 7,
        manual_account_id: null,
        plaid_account_id: null,
        tag_ids: [],
        recurring_id: null,
      });
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Dining" },
      ]);

      const result = await tools.get("get_transaction")!.handler({ id: 5 });
      const body = JSON.parse(result.content[0].text);

      expect(body.id).toBe(5);
      expect(body.category_name).toBe("Dining");
      expect(body.manual_account_name).toBeNull();
      expect(body.tag_names).toEqual([]);
    });

    it("split_transaction hydrates the returned transaction by default", async () => {
      mockClient.transactions.split.mockResolvedValue({
        id: 5,
        category_id: 7,
        tag_ids: [],
      });
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Shopping" },
      ]);

      const result = await tools.get("split_transaction")!.handler({
        id: 5,
        child_transactions: [{ amount: 10 }, { amount: 15 }],
      });
      const body = JSON.parse(result.content[0].text);

      expect(body.id).toBe(5);
      expect(body.category_name).toBe("Shopping");
    });

    it("split_transaction with raw:true returns the unmodified v2 response", async () => {
      const splitResult = { id: 5, category_id: 7, tag_ids: [] };
      mockClient.transactions.split.mockResolvedValue(splitResult);
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Shopping" },
      ]);

      const result = await tools.get("split_transaction")!.handler({
        id: 5,
        child_transactions: [{ amount: 10 }, { amount: 15 }],
        raw: true,
      });
      const body = JSON.parse(result.content[0].text);

      expect(body).toEqual(splitResult);
      expect(body).not.toHaveProperty("category_name");
      expect(mockClient.categories.getAll).not.toHaveBeenCalled();
    });

    it("group_transactions hydrates the returned transaction by default", async () => {
      mockClient.transactions.group.mockResolvedValue({
        id: 100,
        category_id: 7,
        tag_ids: [],
      });
      mockClient.categories.getAll.mockResolvedValue([
        { id: 7, name: "Travel" },
      ]);

      const result = await tools.get("group_transactions")!.handler({
        ids: [1, 2],
        date: "2026-04-01",
        payee: "Airline Bundle",
      });
      const body = JSON.parse(result.content[0].text);

      expect(body.id).toBe(100);
      expect(body.category_name).toBe("Travel");
    });

    it("get_all_transactions surfaces hydration_warnings when a scope refresh fails", async () => {
      mockClient.transactions.getAll.mockResolvedValue({
        transactions: [
          {
            id: 100,
            category_id: null,
            manual_account_id: null,
            plaid_account_id: null,
            tag_ids: [3],
            recurring_id: null,
          },
        ],
        hasMore: false,
      });
      mockClient.tags.getAll.mockRejectedValue(new Error("tags endpoint down"));

      const result = await tools.get("get_all_transactions")!.handler({});
      const body = JSON.parse(result.content[0].text);

      expect(body.transactions[0].tag_names).toEqual([null]);
      expect(body.hydration_warnings).toHaveLength(1);
      expect(body.hydration_warnings[0].scope).toBe("tags");
      expect(body.hydration_warnings[0].reason).toContain("tags endpoint down");
    });

    it("get_all_transactions with raw:true does not forward raw to the underlying client", async () => {
      mockClient.transactions.getAll.mockResolvedValue({
        transactions: [],
        hasMore: false,
      });

      await tools.get("get_all_transactions")!.handler({
        start_date: "2026-04-01",
        raw: true,
      });

      const forwardedParams = mockClient.transactions.getAll.mock.calls[0]?.[0];
      expect(forwardedParams).not.toHaveProperty("raw");
      expect(forwardedParams).toMatchObject({ start_date: "2026-04-01" });
    });
  });
});
