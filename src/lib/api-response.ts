import "server-only";

import {
  getGeniusBudgetHeaders,
  getGeniusBudgetSnapshot,
  getLastGeniusBudgetSnapshot,
} from "@/lib/usage-budget";

export async function jsonWithBudgetHeaders(
  body: unknown,
  init: ResponseInit = {}
) {
  const headers = new Headers(init.headers);
  const snapshot =
    (await getGeniusBudgetSnapshot().catch(() => null)) ??
    getLastGeniusBudgetSnapshot();

  getGeniusBudgetHeaders(snapshot).forEach((value, key) => {
    headers.set(key, value);
  });

  return Response.json(body, {
    ...init,
    headers,
  });
}
