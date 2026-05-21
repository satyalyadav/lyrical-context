import { NextResponse, type NextRequest } from "next/server";

import {
  API_SESSION_COOKIE,
  createApiSessionToken,
  getApiSessionConfigError,
  getApiSessionMaxAgeSeconds,
  verifyApiSessionToken,
} from "@/lib/api-session";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (isPageNavigation(request)) {
    const session = request.cookies.get(API_SESSION_COOKIE)?.value;

    if (!(await verifyApiSessionToken(session))) {
      const configError = getApiSessionConfigError();

      if (configError) {
        response = new NextResponse("Server security configuration is incomplete.", {
          status: 503,
        });
      } else {
        const nextSession = await createApiSessionToken();

        if (nextSession) {
          response.cookies.set(API_SESSION_COOKIE, nextSession, {
            httpOnly: true,
            maxAge: getApiSessionMaxAgeSeconds(),
            path: "/",
            sameSite: "strict",
            secure: isSecureRequest(request),
          });
        }
      }
    }
  }

  applySecurityHeaders(response.headers, nonce, request);
  return response;
}

export function createContentSecurityPolicy(nonce: string, request: NextRequest) {
  const isDevelopment = process.env.NODE_ENV === "development";
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(isDevelopment ? ["'unsafe-eval'", "https:", "http:"] : ["https:"]),
  ];
  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["script-src", ...scriptSrc],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", "https://vitals.vercel-insights.com"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    ["object-src", "'none'"],
    ...(isSecureRequest(request) ? [["upgrade-insecure-requests"]] : []),
  ];

  return directives.map((directive) => directive.join(" ")).join("; ");
}

function applySecurityHeaders(
  headers: Headers,
  nonce: string,
  request: NextRequest
) {
  headers.set("Content-Security-Policy", createContentSecurityPolicy(nonce, request));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
  );

  if (isSecureRequest(request)) {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
}

function isPageNavigation(request: NextRequest) {
  const accept = request.headers.get("accept") ?? "";
  const mode = request.headers.get("sec-fetch-mode");
  const destination = request.headers.get("sec-fetch-dest");

  return (
    request.method === "GET" &&
    accept.includes("text/html") &&
    (!mode || mode === "navigate") &&
    (!destination || destination === "document")
  );
}

function isSecureRequest(request: NextRequest) {
  return (
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
