import "server-only";

import { LyricalContextError } from "@/lib/errors";
import { getRedisConfig, runRedisPipeline } from "@/lib/redis";

export type UsageBudgetSnapshot = {
  limit: number;
  remaining: number;
  resetAt: number;
  state: "ok" | "warning" | "blocked";
};

type BudgetConfig = {
  enabled: true;
  key: string;
  limit: number;
  warningRemaining: number;
  windowEndsAt: number;
  windowSeconds: number;
};

const DEFAULT_BUDGET_LIMIT = 500;
const DEFAULT_BUDGET_WINDOW_SECONDS = 60 * 60;
const DEFAULT_WARNING_REMAINING = 50;
const BUDGET_KEY_PREFIX = "lyrical-context:genius-budget";

const localBudget = new Map<string, number>();
let lastSnapshot: UsageBudgetSnapshot | null = null;

export async function consumeGeniusBudget() {
  const snapshot = await incrementBudget();
  lastSnapshot = snapshot;

  if (!snapshot) {
    return null;
  }

  if (snapshot.state === "blocked") {
    throw new LyricalContextError(
      "usage_budget_exhausted",
      "The shared Genius API budget is cooling down. Please try again later.",
      429
    );
  }

  return snapshot;
}

export async function getGeniusBudgetSnapshot() {
  const snapshot = await readBudget();
  lastSnapshot = snapshot;
  return snapshot;
}

export function getLastGeniusBudgetSnapshot() {
  return lastSnapshot;
}

export function getGeniusBudgetHeaders(snapshot = lastSnapshot) {
  const headers = new Headers();

  if (!snapshot) {
    return headers;
  }

  headers.set("x-lyrical-budget-limit", String(snapshot.limit));
  headers.set("x-lyrical-budget-remaining", String(snapshot.remaining));
  headers.set("x-lyrical-budget-reset-at", new Date(snapshot.resetAt).toISOString());
  headers.set("x-lyrical-budget-state", snapshot.state);

  if (snapshot.state === "blocked") {
    headers.set(
      "retry-after",
      String(Math.max(1, Math.ceil((snapshot.resetAt - Date.now()) / 1000)))
    );
  }

  return headers;
}

export function resetUsageBudgetForTests() {
  localBudget.clear();
  lastSnapshot = null;
}

async function incrementBudget() {
  const config = getBudgetConfig();

  if (!config.enabled) {
    return null;
  }

  const counter = await incrementCounter(config);
  return createSnapshot(counter.count, config);
}

async function readBudget() {
  const config = getBudgetConfig();

  if (!config.enabled) {
    return null;
  }

  const counter = await readCounter(config);
  return createSnapshot(counter.count, config);
}

function createSnapshot(
  count: number,
  config: BudgetConfig
) {
  const remaining = Math.max(0, config.limit - count);
  const state =
    count > config.limit
      ? "blocked"
      : remaining <= config.warningRemaining
        ? "warning"
        : "ok";

  return {
    limit: config.limit,
    remaining,
    resetAt: config.windowEndsAt,
    state,
  } satisfies UsageBudgetSnapshot;
}

async function incrementCounter(
  config: BudgetConfig
) {
  const redis = getRedisConfig();

  if (redis) {
    const result = await runRedisPipeline(redis, [
      ["INCR", config.key],
      ["EXPIRE", config.key, String(config.windowSeconds)],
    ]);
    return { count: toNumber(result[0], 0) };
  }

  const nextCount = (localBudget.get(config.key) ?? 0) + 1;
  localBudget.set(config.key, nextCount);
  return { count: nextCount };
}

async function readCounter(config: BudgetConfig) {
  const redis = getRedisConfig();

  if (redis) {
    const result = await runRedisPipeline(redis, [["GET", config.key]]);
    return { count: toNumber(result[0], 0) };
  }

  return { count: localBudget.get(config.key) ?? 0 };
}

function getBudgetConfig() {
  const limit = getPositiveInteger(
    process.env.LYRICAL_CONTEXT_GENIUS_BUDGET_LIMIT,
    DEFAULT_BUDGET_LIMIT
  );

  if (limit <= 0) {
    return { enabled: false as const };
  }

  const windowSeconds = getPositiveInteger(
    process.env.LYRICAL_CONTEXT_GENIUS_BUDGET_WINDOW_SECONDS,
    DEFAULT_BUDGET_WINDOW_SECONDS
  );
  const warningRemaining = Math.min(
    limit,
    getPositiveInteger(
      process.env.LYRICAL_CONTEXT_GENIUS_BUDGET_WARNING_REMAINING,
      Math.min(DEFAULT_WARNING_REMAINING, Math.ceil(limit * 0.1))
    )
  );
  const windowStartedAt =
    Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000;

  return {
    enabled: true as const,
    key: `${BUDGET_KEY_PREFIX}:${windowSeconds}:${windowStartedAt}`,
    limit,
    warningRemaining,
    windowEndsAt: windowStartedAt + windowSeconds * 1000,
    windowSeconds,
  };
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}
