import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

export interface Device {
  id: string
  name: string
  mac: string
  ip?: string
  createdAt: string
  updatedAt?: string
}

const DATA_DIR = join(process.cwd(), "data")
const DATA_FILE = join(DATA_DIR, "devices.json")

function ensureFile(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, "[]", "utf-8")
  }
}

export function readDevices(): Device[] {
  ensureFile()
  const raw = readFileSync(DATA_FILE, "utf-8")
  return JSON.parse(raw)
}

export function writeDevices(devices: Device[]): void {
  ensureFile()
  writeFileSync(DATA_FILE, JSON.stringify(devices, null, 2), "utf-8")
}
