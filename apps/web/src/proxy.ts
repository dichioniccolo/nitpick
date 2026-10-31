import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends visitors without a session cookie away before anything renders,
 * prefetches included. It reads the cookie only: `requireUser` validates the
 * session in every data slot, and all data is filtered by membership.
 */
export default function proxy(request: NextRequest) {
  if (getSessionCookie(request) !== null) return NextResponse.next();

  return NextResponse.redirect(new URL("/?signin=required", request.url));
}

export const config = { matcher: ["/app/:path*"] };
