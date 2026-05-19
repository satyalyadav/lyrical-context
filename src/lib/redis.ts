import "server-only";

import { LyricalContextError } from "@/lib/errors";

export type RedisConfig = {
  url: string;
  token: string;
};

type RedisPipelineObjectResponse = {
  result?: unknown[];
};

type RedisPipelineItemResponse = {
  result?: unknown;
};

export function getRedisConfig(): RedisConfig | null {
  const url = (
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  )?.replace(/\/$/u, "");
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

export async function runRedisPipeline(redis: RedisConfig, commands: string[][]) {
  const response = await fetch(`${redis.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new LyricalContextError(
      "storage_unavailable",
      "Shared storage is unavailable. Please try again later.",
      503
    );
  }

  const payload = (await response.json()) as
    | RedisPipelineObjectResponse
    | RedisPipelineItemResponse[];

  if (Array.isArray(payload)) {
    return payload.map((item) => item.result);
  }

  if (!Array.isArray(payload.result)) {
    throw new LyricalContextError(
      "storage_unavailable",
      "Shared storage is unavailable. Please try again later.",
      503
    );
  }

  return payload.result;
}

export function redisString(value: string) {
  return value;
}
