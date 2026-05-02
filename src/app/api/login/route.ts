import { NextResponse } from "next/server"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { createSession, destroySession } from "@/lib/auth"

interface AuthConfig {
  username: string
  hash: string
}

const nonces = new Map<string, number>()

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of nonces) {
    if (now - v > 300000) nonces.delete(k)
  }
}, 300000)

async function sha256(s: string): Promise<string> {
  const data = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

function readAuth(): AuthConfig {
  const dir = join(process.cwd(), "data")
  const file = join(dir, "auth.json")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (!existsSync(file)) {
    const fallbackHash = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8" // SHA256("password")
    writeFileSync(file, JSON.stringify({
      username: "admin",
      hash: fallbackHash,
    }, null, 2), "utf-8")
  }
  return JSON.parse(readFileSync(file, "utf-8"))
}

export async function GET(): Promise<NextResponse> {
  const nonce = crypto.randomUUID()
  nonces.set(nonce, Date.now())
  return NextResponse.json({ nonce })
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json()
  const { username, response, nonce } = body
  const auth = readAuth()

  if (!nonce || !nonces.has(nonce)) {
    return NextResponse.json({ error: "会话过期，请重试" }, { status: 401 })
  }
  nonces.delete(nonce)

  const expected = await sha256(nonce + auth.hash)

  if (username !== auth.username || response !== expected) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 })
  }

  const token = await createSession()

  const resp = NextResponse.json({ ok: true })
  resp.cookies.set("wol_token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 86400 * 7,
    path: "/",
  })
  return resp
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const cookie = request.headers.get("cookie") || ""
  const token = cookie.match(/wol_token=([^;]+)/)?.[1]
  if (token) destroySession(token)

  const resp = NextResponse.json({ ok: true })
  resp.cookies.set("wol_token", "", {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return resp
}
