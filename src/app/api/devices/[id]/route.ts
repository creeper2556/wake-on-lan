import { NextResponse } from "next/server"
import { readDevices, writeDevices } from "@/lib/store"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const devices = readDevices()
  const index = devices.findIndex((d) => d.id === id)

  if (index === -1) {
    return NextResponse.json({ error: "设备不存在" }, { status: 404 })
  }

  devices.splice(index, 1)
  writeDevices(devices)

  return NextResponse.json({ ok: true })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params
  const body = await request.json()
  const devices = readDevices()
  const device = devices.find((d) => d.id === id)

  if (!device) {
    return NextResponse.json({ error: "设备不存在" }, { status: 404 })
  }

  let changed = false

  if (body.name !== undefined && typeof body.name === "string" && body.name.trim()) {
    device.name = body.name.trim()
    changed = true
  }
  if (body.ip !== undefined) {
    device.ip = body.ip || undefined
    changed = true
  }
  if (body.mac !== undefined && typeof body.mac === "string" && /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(body.mac)) {
    // 检查 MAC 是否与其他设备重复
    if (devices.some((d) => d.id !== id && d.mac.toLowerCase() === body.mac.toLowerCase())) {
      return NextResponse.json({ error: "该 MAC 地址已被其他设备使用" }, { status: 409 })
    }
    device.mac = body.mac.toLowerCase()
    changed = true
  }

  if (changed) {
    device.updatedAt = new Date().toISOString()
  }

  writeDevices(devices)
  return NextResponse.json(device)
}
