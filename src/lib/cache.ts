import "server-only";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Database as SqliteDatabase } from "better-sqlite3";

type CacheRow = {
  value: string;
  expires_at: number;
};

type JsonCacheEntry = CacheRow & {
  created_at: number;
};

type CacheBackend =
  | { kind: "sqlite"; db: SqliteDatabase }
  | { kind: "json"; filePath: string; entries: Record<string, JsonCacheEntry> }
  | { kind: "memory"; entries: Record<string, JsonCacheEntry> };

let backend: CacheBackend | null = null;
const nodeRequire = createRequire(import.meta.url);

export function getCacheBackend() {
  if (backend) {
    return backend;
  }

  const dbPath = getDefaultCachePath();

  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const Database = nodeRequire("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache_entries (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    backend = { kind: "sqlite", db };
    return backend;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "Falling back to JSON cache because SQLite could not be initialized:",
        error instanceof Error ? error.message : error
      );
    }
  }

  const filePath = dbPath.replace(/\.sqlite$/i, ".json");
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    backend = {
      kind: "json",
      filePath,
      entries: readJsonCache(filePath),
    };
  } catch {
    backend = {
      kind: "memory",
      entries: {},
    };
  }

  return backend;
}

export function getCachedJson<T>(key: string): T | null {
  const now = Date.now();
  const cacheBackend = getCacheBackend();
  const row =
    cacheBackend.kind === "sqlite"
      ? (cacheBackend.db
          .prepare("SELECT value, expires_at FROM cache_entries WHERE key = ?")
          .get(key) as CacheRow | undefined)
      : cacheBackend.entries[key];

  if (!row) {
    return null;
  }

  if (row.expires_at <= now) {
    if (cacheBackend.kind === "sqlite") {
      cacheBackend.db.prepare("DELETE FROM cache_entries WHERE key = ?").run(key);
    } else if (cacheBackend.kind === "json") {
      delete cacheBackend.entries[key];
      writeJsonCache(cacheBackend.filePath, cacheBackend.entries);
    } else {
      delete cacheBackend.entries[key];
    }

    return null;
  }

  return JSON.parse(row.value) as T;
}

export function setCachedJson<T>(key: string, value: T, ttlSeconds: number) {
  const now = Date.now();
  const cacheBackend = getCacheBackend();
  const serializedValue = JSON.stringify(value);
  const expiresAt = now + ttlSeconds * 1000;

  if (cacheBackend.kind === "sqlite") {
    cacheBackend.db
      .prepare(
        `INSERT INTO cache_entries (key, value, expires_at, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at,
           created_at = excluded.created_at`
      )
      .run(key, serializedValue, expiresAt, now);
    return;
  }

  cacheBackend.entries[key] = {
    value: serializedValue,
    expires_at: expiresAt,
    created_at: now,
  };
  if (cacheBackend.kind === "json") {
    writeJsonCache(cacheBackend.filePath, cacheBackend.entries);
  }
}

export async function withJsonCache<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<{ value: T; source: "cache" | "live" }> {
  const cached = (() => {
    try {
      return getCachedJson<T>(key);
    } catch {
      resetCacheForTests();
      return null;
    }
  })();

  if (cached !== null) {
    return { value: cached, source: "cache" };
  }

  const value = await loader();

  try {
    setCachedJson(key, value, ttlSeconds);
  } catch {
    resetCacheForTests();
  }

  return { value, source: "live" };
}

export function resetCacheForTests() {
  if (backend?.kind === "sqlite") {
    backend.db.close();
  }

  backend = null;
}

function readJsonCache(filePath: string): Record<string, JsonCacheEntry> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      JsonCacheEntry
    >;
  } catch {
    return {};
  }
}

function getDefaultCachePath() {
  if (process.env.LYRICAL_CONTEXT_DB_PATH) {
    return process.env.LYRICAL_CONTEXT_DB_PATH;
  }

  if (process.env.VERCEL === "1") {
    return path.join("/tmp", "lyrical-context.sqlite");
  }

  return path.join(process.cwd(), ".data", "lyrical-context.sqlite");
}

function writeJsonCache(
  filePath: string,
  entries: Record<string, JsonCacheEntry>
) {
  writeFileSync(filePath, JSON.stringify(entries, null, 2));
}
