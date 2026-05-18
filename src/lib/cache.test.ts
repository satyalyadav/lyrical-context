import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getCachedJson,
  resetCacheForTests,
  setCachedJson,
  withJsonCache,
} from "@/lib/cache";

describe("SQLite JSON cache", () => {
  beforeEach(() => {
    process.env.LYRICAL_CONTEXT_DB_PATH = path.join(
      mkdtempSync(path.join(os.tmpdir(), "lyrical-context-")),
      "cache.sqlite"
    );
    resetCacheForTests();
  });

  afterEach(() => {
    resetCacheForTests();
    delete process.env.LYRICAL_CONTEXT_DB_PATH;
  });

  it("stores and reads JSON values", () => {
    setCachedJson("example", { ok: true }, 30);
    expect(getCachedJson("example")).toEqual({ ok: true });
  });

  it("reports cache and live sources", async () => {
    const [first, second] = await withJsonCache("computed", 30, async () => ({
      value: 1,
    })).then((liveResult) =>
      withJsonCache("computed", 30, async () => ({
        value: 2,
      })).then((cachedResult) => [liveResult, cachedResult] as const)
    );

    expect(first).toEqual({ source: "live", value: { value: 1 } });
    expect(second).toEqual({ source: "cache", value: { value: 1 } });
  });
});
