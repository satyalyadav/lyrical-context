import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeGeniusBudget,
  getGeniusBudgetHeaders,
  getGeniusBudgetSnapshot,
  resetUsageBudgetForTests,
} from "@/lib/usage-budget";

describe("Genius usage budget", () => {
  beforeEach(() => {
    resetUsageBudgetForTests();
    vi.stubEnv("LYRICAL_CONTEXT_GENIUS_BUDGET_LIMIT", "2");
    vi.stubEnv("LYRICAL_CONTEXT_GENIUS_BUDGET_WARNING_REMAINING", "1");
    vi.stubEnv("LYRICAL_CONTEXT_GENIUS_BUDGET_WINDOW_SECONDS", "60");
  });

  afterEach(() => {
    resetUsageBudgetForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns when the shared budget is low and blocks after it is exhausted", async () => {
    await expect(consumeGeniusBudget()).resolves.toMatchObject({
      remaining: 1,
      state: "warning",
    });

    await expect(consumeGeniusBudget()).resolves.toMatchObject({
      remaining: 0,
      state: "warning",
    });

    await expect(consumeGeniusBudget()).rejects.toThrowError(
      expect.objectContaining({
        code: "usage_budget_exhausted",
        status: 429,
      })
    );
  });

  it("reports budget response headers", async () => {
    await consumeGeniusBudget();

    const headers = getGeniusBudgetHeaders(await getGeniusBudgetSnapshot());

    expect(headers.get("x-lyrical-budget-limit")).toBe("2");
    expect(headers.get("x-lyrical-budget-remaining")).toBe("1");
    expect(headers.get("x-lyrical-budget-state")).toBe("warning");
    expect(headers.get("x-lyrical-budget-reset-at")).toBeTruthy();
  });
});
