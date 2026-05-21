import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_ROUTE_FILES = [
  "src/app/api/search/route.ts",
  "src/app/api/report/route.ts",
  "src/app/api/songs/[id]/references/route.ts",
  "src/app/api/albums/[id]/references/route.ts",
];

describe("API guard usage", () => {
  it("awaits assertApiAccess in every API route handler", () => {
    for (const file of API_ROUTE_FILES) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      const guardCalls = source.match(/assertApiAccess\(request\)/gu) ?? [];

      expect(guardCalls.length, file).toBe(1);
      expect(source, file).toMatch(/await assertApiAccess\(request\)/u);
    }
  });
});
