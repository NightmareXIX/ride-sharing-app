import { NextResponse, type NextRequest } from 'next/server';

// Must match the API's cookie name (apps/api/src/auth/session.ts).
const SESSION_COOKIE = 'tp_session';

// A quick check before rendering signed-in pages: with no session cookie at all, go
// straight to sign-in instead of flashing the page. It can't verify the cookie; the page
// asks /me for that.
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: ['/passenger/:path*', '/driver/:path*'],
};
