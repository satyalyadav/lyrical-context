import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_SESSION_COOKIE } from "@/lib/api-session";
import { createContentSecurityPolicy, proxy } from "@/proxy";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

describe("proxy security headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds a strict content security policy", () => {
    const request = new NextRequest("https://app.test/");
    const csp = createContentSecurityPolicy("nonce-value", request);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("script-src 'self' 'nonce-nonce-value'");
  });

  it("sets a strict secure session cookie on page navigation", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = SESSION_SECRET;
    const response = await proxy(
      new NextRequest("https://app.test/", {
        headers: {
          accept: "text/html",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
        },
      })
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain(`${API_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=strict");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'"
    );
    expect(response.headers.get("Strict-Transport-Security")).toBeTruthy();
  });
});
