import { NextResponse } from "next/server"
import { readDevices } from "@/lib/store"
import wol from "wol"

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json()
  const deviceId: string | undefined = body.id

  if (!deviceId) {
    return NextResponse.json({ error: "缺少设备 ID" }, { status: 400 })
  }

  const devices = readDevices()
  const device = devices.find((d) => d.id === deviceId)

  if (!device) {
    return NextResponse.json({ error: "设备不存在" }, { status: 404 })
  }

  try {
    await new Promise<void>((resolve, reject) => {
      wol.wake(device.mac, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })

    return NextResponse.json({ ok: true, name: device.name })
  } catch {
    return NextResponse.json(
      { error: "发送魔术包失败，请确认目标机器在同一局域网内" },
      { status: 500 }
    )
  }
}
