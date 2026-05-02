import { spawn } from "child_process"
import { NextResponse } from "next/server"

async function pingCheck(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ping", ["-c", "1", "-W", "1", ip], { stdio: "ignore" })
    const t = setTimeout(() => { p.kill(); resolve(false) }, 1500)
    p.on("close", (code) => {
      clearTimeout(t)
      resolve(code === 0)
    })
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json()
  const ips: string[] = Array.isArray(body.ips) ? body.ips : []

  const results = await Promise.all(
    ips.map(async (ip) => {
      const online = await pingCheck(ip)
      return { ip, online }
    })
  )

  return NextResponse.json({ results })
}
