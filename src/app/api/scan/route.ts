import { NextResponse } from "next/server"
import { spawn } from "child_process"
import { readFileSync } from "fs"
import { createRequire } from "module"
import { reverse as dnsReverse } from "dns/promises"
import dgram from "dgram"
import net from "net"
import os from "os"
import createMdns from "multicast-dns"

const req = createRequire(import.meta.url)
const ouiData: Record<string, string> = req("oui-data")

interface ScanEntry {
  ip: string
  mac: string
  vendor?: string
  hostname?: string
  netbiosName?: string
  upnpInfo?: string
  openPorts?: number[]
  deviceHint?: string
  label?: string
  brand?: string
  icon?: string
}

const ouiLookup: Record<string, string> = {}

const PORT_HINTS: Record<number, string> = {
  22: "SSH (Linux/网络设备)",
  23: "Telnet",
  53: "DNS",
  80: "HTTP",
  139: "NetBIOS",
  443: "HTTPS",
  445: "SMB (Windows/NAS)",
  548: "AFP (Mac/TimeCapsule)",
  631: "IPP (打印机)",
  3389: "RDP (Windows)",
  5900: "VNC",
  8080: "HTTP代理",
  9100: "打印机",
  5353: "mDNS",
  7000: "流媒体/摄像头",
  8000: "Web管理",
  32400: "Plex",
}

function getVendor(mac: string): string | undefined {
  const oui = mac.replace(/[^0-9a-f]/g, "").toUpperCase().slice(0, 6)
  if (!ouiLookup[oui]) {
    const raw = ouiData[oui]
    ouiLookup[oui] = raw ? raw.split("\n")[0] : ""
  }
  return ouiLookup[oui] || undefined
}

function getLocalSubnets(): string[] {
  const nets = os.networkInterfaces()
  const subnets = new Set<string>()

  for (const [, addrs] of Object.entries(nets)) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        const parts = addr.address.split(".")
        if (parts.length === 4) {
          subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`)
        }
      }
    }
  }
  return Array.from(subnets)
}

async function ping(ip: string, timeout = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ping", ["-c", "1", "-W", "1", ip], {
      stdio: "ignore",
    })
    const timer = setTimeout(() => {
      p.kill()
      resolve(false)
    }, timeout)
    p.on("close", (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

async function pingSweep(subnet: string): Promise<string[]> {
  const base = subnet.split(".").slice(0, 3).join(".")
  const ips: string[] = []
  for (let i = 1; i <= 254; i++) {
    ips.push(`${base}.${i}`)
  }

  const alive: string[] = []
  const concurrency = 50
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (ip) => {
        const ok = await ping(ip)
        return ok ? ip : null
      })
    )
    for (const r of results) {
      if (r) alive.push(r)
    }
  }
  return alive
}

function readArpTable(): { ip: string; mac: string }[] {
  try {
    const raw = readFileSync("/proc/net/arp", "utf-8")
    const lines = raw.split("\n").slice(1)
    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4) {
          const mac = parts[3].toLowerCase()
          if (mac !== "00:00:00:00:00:00") {
            return { ip: parts[0], mac }
          }
        }
        return null
      })
      .filter((e): e is { ip: string; mac: string } => e !== null)
  } catch {
    return []
  }
}

// ── NetBIOS ──────────────────────────────────────────

function netbiosQuery(ip: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4")
    const timeout = setTimeout(() => {
      socket.close()
      resolve(undefined)
    }, 2000)

    const tid = Buffer.alloc(2)
    tid.writeUInt16BE(Math.floor(Math.random() * 65535), 0)

    const name = "\x43\x4bAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const encoded = Buffer.alloc(33)
    encoded.writeUInt8(32, 0)
    for (let i = 0; i < 32; i++) {
      encoded[i + 1] =
        ((name.charCodeAt(i) - 64) << 1) | ((name.charCodeAt(i) - 64) >> 5)
    }
    encoded[33 - 1 + 1] = 0 // null terminator length byte

    const query = Buffer.concat([
      tid, // transaction ID
      Buffer.from([0x00, 0x00]), // flags: query
      Buffer.from([0x00, 0x01]), // 1 question
      Buffer.from([0x00, 0x00]), // 0 answers
      Buffer.from([0x00, 0x00]), // 0 authority
      Buffer.from([0x00, 0x00]), // 0 additional
      encoded,
      Buffer.from([0x00, 0x21, 0x00, 0x01]), // NBSTAT, IN
    ])

    socket.on("message", (msg: Buffer) => {
      clearTimeout(timeout)
      socket.close()
      try {
        const nameCount = msg.readUInt8(56)
        if (nameCount === 0) {
          resolve(undefined)
          return
        }
        const names: string[] = []
        let offset = 57
        for (let i = 0; i < nameCount; i++) {
          let name = ""
          for (let j = 0; j < 15; j++) {
            const c = (msg[offset + j] >> 4) * 16 + (msg[offset + j] & 0x0f)
            name += String.fromCharCode(c + 64)
          }
          const type = msg[offset + 15]
          const flags = msg[offset + 16]
          const unique = (flags & 0x80) !== 0
          const tag =
            type === 0x00
              ? unique
                ? ""
                : ""
              : `<${String.fromCharCode(type + 0x40).toLowerCase()}>`
          const trimmed = (unique ? name.trim() : name.trim()) + tag
          if (trimmed.length > 0) names.push(trimmed)
          offset += 18
        }
        resolve(names.length > 0 ? names[0] : undefined)
      } catch {
        resolve(undefined)
      }
    })

    socket.on("error", () => {
      clearTimeout(timeout)
      socket.close()
      resolve(undefined)
    })

    socket.send(query, 137, ip, (err) => {
      if (err) {
        clearTimeout(timeout)
        socket.close()
        resolve(undefined)
      }
    })
  })
}

// ── UPnP / SSDP ──────────────────────────────────────

function upnpDiscover(): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const results = new Map<string, string>()
    const socket = dgram.createSocket("udp4")
    const timeout = setTimeout(() => {
      socket.close()
      resolve(results)
    }, 3000)

    const ssdp =
      "M-SEARCH * HTTP/1.1\r\n" +
      "HOST: 239.255.255.250:1900\r\n" +
      'MAN: "ssdp:discover"\r\n' +
      "MX: 2\r\n" +
      "ST: upnp:rootdevice\r\n\r\n"

    socket.on("message", (msg: Buffer) => {
      const text = msg.toString()
      const locationMatch = text.match(/LOCATION:\s*(http:\/\/[^\r\n]+)/i)
      const serverMatch = text.match(/SERVER:\s*([^\r\n]+)/i)
      if (locationMatch) {
        const ipMatch = locationMatch[1].match(/http:\/\/([0-9.]+):/)
        if (ipMatch && !results.has(ipMatch[1])) {
          results.set(ipMatch[1], serverMatch?.[1] || "UPnP Device")
        }
      }
    })

    socket.on("error", () => {
      // ignore
    })

    socket.bind(() => {
      socket.setBroadcast(true)
      socket.send(ssdp, 1900, "239.255.255.250", (err) => {
        if (err) {
          clearTimeout(timeout)
          socket.close()
          resolve(results)
        }
      })
    })
  })
}

// ── mDNS / Bonjour Discovery ─────────────────────────

const MDNS_SERVICE_TYPES = [
  "_hap._tcp.local",            // HomeKit
  "_companion-link._tcp.local", // Apple
  "_airplay._tcp.local",        // AirPlay
  "_raop._tcp.local",           // AirPlay Remote Audio
  "_googlecast._tcp.local",     // Chromecast
  "_smb._tcp.local",            // SMB
  "_ipp._tcp.local",            // IPP Printer
  "_printer._tcp.local",        // Printer
  "_http._tcp.local",           // HTTP
  "_https._tcp.local",          // HTTPS
  "_ssh._tcp.local",            // SSH
  "_ftp._tcp.local",            // FTP
  "_dlna._tcp.local",           // DLNA
  "_spotify-connect._tcp.local",// Spotify
  "_homekit._tcp.local",        // HomeKit (legacy)
  "_sleep-proxy._udp.local",    // Apple Sleep Proxy
  "_miio._udp.local",           // Xiaomi IoT
  "_meshcop._udp.local",        // Thread/Matter
  "_nvstream._tcp.local",       // NVIDIA Shield
]

function mdnsDiscover(): Promise<Map<string, string>> {
  return new Promise((resolve) => {
    const results = new Map<string, string>()
    const queried = new Set<string>()
    let mdns: ReturnType<typeof createMdns>

    try {
      mdns = createMdns({ multicast: true })
    } catch {
      resolve(results)
      return
    }

    const _timer = setTimeout(() => {
      try { mdns.destroy() } catch { /* ignore */ }
      resolve(results)
    }, 5000)

    mdns.on("response", (resp) => {
      if (!resp.answers) return

      const answers = resp.answers.filter(
        (a) => a.type === "PTR" || a.type === "SRV" || a.type === "TXT" || a.type === "A" || a.type === "AAAA"
      )

      // Collect service types from PTR to fan out queries
      const newTypes: string[] = []
      for (const ans of answers) {
        if (ans.type === "PTR" && typeof ans.data === "string") {
          if (!queried.has(ans.data)) {
            newTypes.push(ans.data)
          }
        }
      }

      // Collect hostnames from PTR and SRV, match with A/AAAA records
      for (const ans of answers) {
        let host: string | undefined
        let ip: string | undefined

        if (ans.type === "PTR") {
          // The PTR data is like "DeviceName._hap._tcp.local"
          if (typeof ans.data === "string") {
            const m = (ans.data as string).match(/^([^.]+)\./)
            if (m && m[1]) host = m[1]
          }
          // Also check ans.name — the domain being answered
          // For PTR, the name is usually the service type like "_hap._tcp.local"
          // The data is the instance name
        }
        if (ans.type === "SRV") {
          const srv = ans.data as { target?: string; port?: number } | undefined
          if (srv?.target) {
            host = srv.target.replace(/\.local\.?$/, "")
            // Also try getting IP from additional answers
          }
        }

        // Find A/AAAA record for IP — match on name
        if (host) {
          const aRecord = answers.find(
            (a) =>
              (a.type === "A" || a.type === "AAAA") &&
              a.name === ((ans as { data?: { target?: string } }).data as { target?: string } | undefined)?.target &&
              typeof a.data === "string"
          ) as { data: string } | undefined

          if (aRecord) ip = aRecord.data

          // Also try: the SRV/PTR name as the A record name
          if (!ip) {
            const aRec2 = answers.find(
              (a) =>
                (a.type === "A" || a.type === "AAAA") &&
                a.name === ans.name &&
                typeof a.data === "string"
            ) as { data: string } | undefined
            if (aRec2) ip = aRec2.data
          }
        }

        if (host && ip && !results.has(ip)) {
          results.set(ip, host)
        }
      }

      // Query newly discovered service types
      for (const t of newTypes) {
        if (!queried.has(t)) {
          queried.add(t)
          try {
            mdns.query({ questions: [{ name: t, type: "PTR" }] })
          } catch { /* ignore */ }
        }
      }

      // Also query A records for any SRV targets we found without IP
    })

    mdns.on("error", () => {
      // ignore
    })

    // Start by discovering all service types
    try {
      mdns.query({
        questions: [{ name: "_services._dns-sd._udp.local", type: "PTR" }],
      })
    } catch { /* ignore */ }

    // Query known service types directly
    for (const t of MDNS_SERVICE_TYPES) {
      queried.add(t)
      try {
        mdns.query({ questions: [{ name: t, type: "PTR" }] })
      } catch { /* ignore */ }
    }

    // Second round after a delay (some devices are slow to respond)
    setTimeout(() => {
      for (const t of MDNS_SERVICE_TYPES) {
        try {
          mdns.query({ questions: [{ name: t, type: "PTR" }] })
        } catch { /* ignore */ }
      }
    }, 1500)
  })
}

// ── Port scanner ─────────────────────────────────────

const SCAN_PORTS = Object.keys(PORT_HINTS).map(Number)

function scanPort(ip: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const timer = setTimeout(() => {
      sock.destroy()
      resolve(null)
    }, 500)
    sock.connect(port, ip, () => {
      clearTimeout(timer)
      sock.destroy()
      resolve(port)
    })
    sock.on("error", () => {
      clearTimeout(timer)
      sock.destroy()
      resolve(null)
    })
  })
}

async function scanHostPorts(ip: string): Promise<number[]> {
  const results = await Promise.all(SCAN_PORTS.map((p) => scanPort(ip, p)))
  return results.filter((p): p is number => p !== null)
}

// ── Device hint from ports ───────────────────────────

function guessDeviceHint(ports: number[]): string | undefined {
  if (ports.length === 0) return undefined

  const has = (p: number) => ports.includes(p)

  if (has(445) && has(3389)) return "Windows PC"
  if (has(3389)) return "远程桌面(Windows)"
  if (has(445) && has(139)) return "Windows/Samba"
  if (has(445)) return "文件共享(Windows)"
  if (has(548)) return "Mac"
  if (has(22) && !has(80) && !has(443)) return "Linux"
  if (has(22) && (has(80) || has(443))) return "Linux 服务器"
  if (has(9100) || has(631)) return "打印机"
  if (has(32400)) return "Plex"
  if (has(5900)) return "VNC"
  if (has(53)) return "DNS"
  if (has(23)) return "交换机"

  const webPorts = [80, 443, 8080, 8000]
  if (webPorts.some((p) => has(p))) return "Web 设备"

  return undefined
}

// ── Router detection ─────────────────────────────────

function getGateway(): string | undefined {
  try {
    const raw = readFileSync("/proc/net/route", "utf-8")
    const lines = raw.split("\n").slice(1)
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 3 && parts[1] === "00000000") {
        const hex = parts[2]
        return `${parseInt(hex.slice(6, 8), 16)}.${parseInt(hex.slice(4, 6), 16)}.${parseInt(hex.slice(2, 4), 16)}.${parseInt(hex.slice(0, 2), 16)}`
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

// ── Comprehensive identification ─────────────────────

interface IdentifyResult {
  label: string
  brand?: string
  icon?: string
}

const BRAND_ICONS: Record<string, string> = {
  apple: "ic_apple",
  huawei: "ic_huawei",
  xiaomi: "ic_xiaomi",
  samsung: "ic_samsung",
  google: "ic_google",
  amazon: "ic_amazon",
  intel: "ic_intel",
  nvidia: "ic_nvidia",
  realtek: "ic_realtek",
  mediatek: "ic_mediatek",
  tplink: "ic_tplink",
  tp_link: "ic_tplink",
  cisco: "ic_cisco",
  dell: "ic_dell",
  lenovo: "ic_lenovo",
  asus: "ic_asus",
  sony: "ic_sony",
  microsoft: "ic_microsoft",
  raspberry: "ic_raspberry",
  espressif: "ic_espressif",
  nintendo: "ic_nintendo",
}

// Parse hostname patterns to identify device types
function parseHostnameType(name: string): string | undefined {
  const n = name.toLowerCase()

  // Viomi/Xiaomi smart home devices
  if (n.includes("viomi-fridge") || n.includes("fridge")) return "冰箱"
  if (n.includes("viomi-washer") || n.includes("washer")) return "洗衣机"
  if (n.includes("viomi-waterheater") || n.includes("waterheater") || n.includes("water-heater")) return "热水器"
  if (n.includes("viomi-airer") || n.includes("airer")) return "晾衣架"
  if (n.includes("viomi-hood") || n.includes("hood") || n.includes("range-hood")) return "油烟机"
  if (n.includes("viomi-oven") || n.includes("oven")) return "烤箱"
  if (n.includes("viomi-dishwasher") || n.includes("dishwasher")) return "洗碗机"
  if (n.includes("viomi-purifier") || n.includes("purifier") || n.includes("air-purifier")) return "空气净化器"
  if (n.includes("viomi-fan") || n.includes("smart-fan")) return "风扇"
  if (n.includes("viomi-heater") || n.includes("smart-heater")) return "取暖器"
  if (n.includes("viomi-sweeper") || n.includes("viomi-vacuum") || n.includes("robot") || n.includes("vacuum")) return "扫地机器人"
  if (n.includes("viomi-humidifier") || n.includes("humidifier")) return "加湿器"
  if (n.includes("viomi-kettle") || n.includes("kettle")) return "烧水壶"
  if (n.includes("viomi-cooker") || n.includes("rice-cooker")) return "电饭煲"
  if (n.includes("viomi-toothbrush") || n.includes("toothbrush")) return "电动牙刷"
  if (n.includes("viomi-lamp") || n.includes("viomi-light") || n.includes("yeelight")) return "智能灯"

  // Xiaomi ecosystem
  if (n.includes("xiaomi-") || n.includes("miio") || n.includes("mihome")) {
    if (n.includes("lamp") || n.includes("light")) return "智能灯"
    if (n.includes("plug") || n.includes("socket") || n.includes("outlet")) return "智能插座"
    if (n.includes("sensor")) return "传感器"
    if (n.includes("camera") || n.includes("cam")) return "摄像头"
    if (n.includes("lock")) return "智能门锁"
    if (n.includes("curtain")) return "智能窗帘"
    if (n.includes("remote")) return "智能遥控"
    if (n.includes("switch")) return "智能开关"
    if (n.includes("gateway")) return "网关"
    if (n.includes("speaker") || n.includes("alexa")) return "智能音箱"
  }

  // ESP devices
  if (/^esp[_]/.test(n) || /esp32/i.test(n) || /esp8266/i.test(n)) {
    if (n.includes("light") || n.includes("led") || n.includes("lamp")) return "ESP智能灯"
    if (n.includes("sensor")) return "ESP传感器"
    if (n.includes("relay") || n.includes("switch")) return "ESP开关"
    if (n.includes("display") || n.includes("screen")) return "ESP显示屏"
    return "ESP IoT设备"
  }
  if (n.includes("esphome")) return "ESPHome设备"
  if (n.includes("tasmota")) return "Tasmota设备"

  // Tuya devices
  if (n.includes("tuya")) return "涂鸦智能设备"

  // Common device types from hostname
  if (n.includes("printer") || n.includes("epson") || n.includes("hp-") || n.includes("canon-")) return "打印机"
  if (n.includes("camera") || n.includes("ipcam") || n.includes("dvr") || n.includes("nvr")) return "摄像头/监控"
  if (n.includes("nas")) return "NAS"
  if (n.includes("tv") || n.includes("television") || n.includes("roku") || n.includes("shield") || n.includes("appletv")) return "电视/盒子"
  if (n.includes("chromecast") || n.includes("google-home") || n.includes("nest")) return "Google设备"
  if (n.includes("alexa") || n.includes("echo-") || n.includes("echo_")) return "Amazon设备"
  if (n.includes("airplay") || n.includes("homepod")) return "HomePod"
  if (n.includes("iphone")) return "iPhone"
  if (n.includes("ipad")) return "iPad"
  if (n.includes("macbook") || n.includes("mac-mini") || n.includes("imac") || n.includes("macpro")) return "Mac"
  if (n.includes("windows") || n.includes("win-") || n.includes("win_")) return "Windows PC"
  if (n.includes("android")) return "Android设备"
  if (n.includes("raspberrypi") || n.includes("raspberry")) return "树莓派"
  if (n.includes("router") || n.includes("gateway")) return "路由器"

  // Chuangmi (创米) / 小米生态链
  if (n.includes("chuangmi")) return "小米生态链设备"

  // Yeelight
  if (n.includes("yeelight")) return "Yeelight灯具"

  // Aqara
  if (n.includes("aqara") || n.includes("lumi.")) return "Aqara设备"

  return undefined
}

function identify(entry: ScanEntry, gateway?: string): IdentifyResult {
  // Helper: is this MAC locally administered (randomized)?
  const isRandomized = entry.mac
    ? (parseInt(entry.mac.charAt(1), 16) & 2) !== 0
    : false

  // Helper: shorten vendor name
  let shortVendor: string | undefined
  if (entry.vendor) {
    shortVendor = entry.vendor.split("\n")[0].split(",")[0].split(/\s+/)[0]
  }

  // 0. Is this the gateway?
  if (gateway && entry.ip === gateway) {
    return { label: "路由器", brand: shortVendor, icon: "ic_router" }
  }

  // 1. Try to identify from hostname/NetBIOS/UPnP names
  const candidateNames = [
    entry.hostname,
    entry.netbiosName,
    entry.upnpInfo,
  ].filter(Boolean) as string[]

  let deviceType: string | undefined

  for (const name of candidateNames) {
    const t = parseHostnameType(name)
    if (t) {
      deviceType = t
      break
    }
  }

  // 2. OUI vendor for brand/icon
  let icon: string | undefined

  if (entry.vendor) {
    const vLow = entry.vendor.toLowerCase()
    for (const [key, ic] of Object.entries(BRAND_ICONS)) {
      if (vLow.includes(key)) {
        icon = ic
        break
      }
    }
  }

  // 3. Build label
  let label: string

  if (deviceType && shortVendor) {
    label = `${shortVendor} ${deviceType}`
  } else if (deviceType) {
    label = deviceType
  } else if (shortVendor) {
    // Known brand but no device type
    if (/apple/i.test(entry.vendor!)) {
      if (entry.deviceHint === "Mac" || entry.deviceHint?.includes("Mac")) label = "Mac"
      else label = "Apple 设备"
    } else if (/huawei/i.test(entry.vendor!)) {
      label = "华为设备"
    } else if (/xiaomi/i.test(entry.vendor!)) {
      label = "小米设备"
    } else if (/samsung/i.test(entry.vendor!)) {
      label = "三星设备"
    } else if (/raspberry/i.test(entry.vendor!)) {
      label = "树莓派"
    } else {
      label = shortVendor
    }
  } else if (entry.deviceHint) {
    // No OUI but ports gave a hint
    if (isRandomized) {
      label = `${entry.deviceHint} (随机MAC)`
    } else {
      label = entry.deviceHint
    }
  } else if (entry.netbiosName) {
    label = entry.netbiosName
  } else if (isRandomized) {
    label = "随机MAC设备"
  } else if (entry.hostname) {
    label = entry.hostname
  } else {
    label = entry.ip // fallback: just show IP
  }

  // 4. NetBIOS name as supplement if useful
  if (entry.netbiosName && !label.includes(entry.netbiosName.split("<")[0])) {
    label = `${label} (${entry.netbiosName.split("<")[0]})`
  }

  return { label, brand: shortVendor, icon }
}



// ── Main handler ─────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  try {
    const gateway = getGateway()
    const subnets = getLocalSubnets()

    // Step 1: Ping sweep all subnets
    const alive: string[] = []
    for (const subnet of subnets) {
      for (const ip of await pingSweep(subnet)) {
        alive.push(ip)
      }
    }

    // Step 2: Read ARP table
    const arpEntries = readArpTable()
    const arpMap = new Map<string, string>()
    for (const e of arpEntries) {
      arpMap.set(e.ip, e.mac)
    }

    // Step 3: Build initial entries
    const entries: ScanEntry[] = alive.map((ip) => ({
      ip,
      mac: arpMap.get(ip) || "",
      vendor: arpMap.has(ip)
        ? getVendor(arpMap.get(ip)!)
        : undefined,
    }))

    // Step 4: mDNS + UPnP discovery (start in parallel)
    const mdnsPromise = mdnsDiscover()
    const upnpPromise = upnpDiscover()

    // Step 5: NetBIOS queries for all alive IPs (concurrent)
    const netbiosPromise = Promise.all(
      entries.map(async (e) => {
        e.netbiosName = await netbiosQuery(e.ip)
      })
    )

    // Step 6: DNS reverse for all alive IPs
    const dnsPromise = Promise.all(
      entries.map(async (e) => {
        try {
          const names = await dnsReverse(e.ip)
          if (names.length > 0) e.hostname = names[0]
        } catch {
          // ignore
        }
      })
    )

    // Step 7: Port scan for all alive IPs
    const portsPromise = Promise.all(
      entries.map(async (e) => {
        e.openPorts = await scanHostPorts(e.ip)
        e.deviceHint = guessDeviceHint(e.openPorts)
      })
    )

    await Promise.all([mdnsPromise, upnpPromise, netbiosPromise, dnsPromise, portsPromise])
    const mdnsResults = await mdnsPromise
    const upnpResults = await upnpPromise

    for (const e of entries) {
      // mDNS hostname — most reliable, prefer over DNS reverse
      const mdnsHost = mdnsResults.get(e.ip)
      if (mdnsHost) e.hostname = mdnsHost
      const upnp = upnpResults.get(e.ip)
      if (upnp) e.upnpInfo = upnp
      const id = identify(e, gateway)
      e.label = id.label
      e.brand = id.brand
      e.icon = id.icon
    }

    return NextResponse.json({ devices: entries, gateway })
  } catch {
    return NextResponse.json(
      { error: "扫描失败" },
      { status: 500 }
    )
  }
}
