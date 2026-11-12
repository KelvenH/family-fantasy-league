import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Block direct access to seed JSON paths the host might otherwise expose. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/data" || pathname.startsWith("/data/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (
    pathname === "/seed-data" ||
    pathname.startsWith("/seed-data/") ||
    pathname.startsWith("/src/seed-data/")
  ) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/data",
    "/data/:path*",
    "/seed-data",
    "/seed-data/:path*",
    "/src/seed-data",
    "/src/seed-data/:path*",
  ],
};
