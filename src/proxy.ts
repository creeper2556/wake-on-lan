import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest): NextResponse {
  const token = request.cookies.get("wol_token")
  const { pathname } = request.nextUrl

  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next()
  }

  if (!token?.value) {
    const resp = NextResponse.redirect(new URL("/login", request.url))
    return resp
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
