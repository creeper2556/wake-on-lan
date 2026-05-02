import { NextResponse } from "next/server"
import { readDevices, writeDevices, Device } from "@/lib/store"

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(readDevices())
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json()
  const { name, mac, ip } = body

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 })
  }
  if (!mac || typeof mac !== "string" || !/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(mac)) {
    return NextResponse.json({ error: "MAC 地址格式无效" }, { status: 400 })
  }

  const devices = readDevices()

  if (devices.some((d) => d.mac.toLowerCase() === mac.toLowerCase())) {
    return NextResponse.json({ error: "该 MAC 地址已存在" }, { status: 409 })
  }

  const device: Device = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: name.trim(),
    mac: mac.toLowerCase(),
    ip: typeof ip === "string" ? ip : undefined,
    createdAt: new Date().toISOString(),
  }

  devices.push(device)
  writeDevices(devices)

  return NextResponse.json(device, { status: 201 })
}
