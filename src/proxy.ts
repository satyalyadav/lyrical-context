import { NextResponse, type NextRequest } from "next/server";

import {
  API_SESSION_COOKIE,
  createApiSessionToken,
  getApiSessionMaxAgeSeconds,
  verifyApiSessionToken,
} from "@/lib/api-session";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const session = request.cookies.get(API_SESSION_COOKIE)?.value;

    if (!(await verifyApiSessionToken(session))) {
      return Response.json(
        {
          error: {
            code: "forbidden",
            message: "Load the app before using this endpoint.",
          },
        },
        { status: 403 }
      );
    }

    return NextResponse.next();
  }

  const response = NextResponse.next();

  if (isPageNavigation(request)) {
    const session = request.cookies.get(API_SESSION_COOKIE)?.value;

    if (!(await verifyApiSessionToken(session))) {
      const nextSession = await createApiSessionToken();

      if (nextSession) {
        response.cookies.set(API_SESSION_COOKIE, nextSession, {
          httpOnly: true,
          maxAge: getApiSessionMaxAgeSeconds(),
          path: "/",
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
        });
      }
    }
  }

  return response;
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

export const config = {
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
