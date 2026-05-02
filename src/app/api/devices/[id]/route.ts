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

  if (body.ip !== undefined) {
    device.ip = body.ip || undefined
    device.updatedAt = new Date().toISOString()
  }

  writeDevices(devices)
  return NextResponse.json(device)
}
