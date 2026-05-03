"use client"

import { useState, useEffect, useCallback } from "react"
import ThemeToggle from "./theme-toggle"

interface Device {
  id: string
  name: string
  mac: string
  ip?: string
  createdAt: string
  updatedAt?: string
}

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

type View = "list" | "add"

export default function Home() {
  const [view, setView] = useState<View>("list")
  const [devices, setDevices] = useState<Device[]>([])
  const [onlineMap, setOnlineMap] = useState<Record<string, boolean>>({})
  const [name, setName] = useState("")
  const [mac, setMac] = useState("")
  const [ip, setIp] = useState("")
  const [error, setError] = useState("")
  const [wakingId, setWakingId] = useState<string | null>(null)
  const [msg, setMsg] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<ScanEntry[]>([])
  const [showScan, setShowScan] = useState(false)
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [editingName, setEditingName] = useState<string | null>(null)
  const [customName, setCustomName] = useState("")
  const [customMac, setCustomMac] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [refreshingIP, setRefreshingIP] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Online status check
  const checkOnline = useCallback(async (devs: Device[]) => {
    const ips = devs.filter((d) => d.ip).map((d) => d.ip!)
    if (ips.length === 0) {
      setOnlineMap({})
      return
    }
    setRefreshing(true)
    try {
      const res = await fetch("/api/devices/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ips }),
      })
      const data = await res.json()
      const map: Record<string, boolean> = {}
      for (const r of data.results || []) {
        map[r.ip] = r.online
      }
      setOnlineMap(map)
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }, [])

  const fetchWithStatus = useCallback(async () => {
    const res = await fetch("/api/devices")
    const devs = await res.json()
    setDevices(devs)
    await checkOnline(devs)
  }, [checkOnline])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    fetchWithStatus()
  }, [fetchWithStatus])

  const runScan = async (): Promise<ScanEntry[]> => {
    const res = await fetch("/api/scan")
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "扫描失败")
    return data.devices || []
  }

  const syncDeviceIPs = async (scanDevices: ScanEntry[]) => {
    for (const dev of devices) {
      const match = scanDevices.find(
        (s) => s.mac.toLowerCase() === dev.mac.toLowerCase()
      )
      if (match && match.ip !== dev.ip) {
        await fetch(`/api/devices/${dev.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip: match.ip }),
        })
      }
    }
    await fetchWithStatus()
  }

  const refreshIPs = async () => {
    setRefreshingIP(true)
    try {
      const scanDevices = await runScan()
      await syncDeviceIPs(scanDevices)
      const existingMacs = new Set(devices.map((d) => d.mac))
      setScanResults(
        scanDevices.filter((e: ScanEntry) => !existingMacs.has(e.mac))
      )
      setShowScan(true)
    } catch {
      // ignore
    } finally {
      setRefreshingIP(false)
    }
  }

  const addDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setMsg("")

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), mac: mac.trim(), ip: ip.trim() || undefined }),
    })

    const data = await res.json()
    if (!res.ok) {
      setError(data.error)
      return
    }

    setName("")
    setMac("")
    setIp("")
    fetchWithStatus()
    setView("list")
    setShowManualAdd(false)
  }

  const confirmScanned = async (entry: ScanEntry, idx: number) => {
    const finalName = customName.trim() || entry.label || entry.hostname || entry.ip
    const finalMac = entry.mac || customMac.trim()
    if (!finalMac) {
      setError("请输入 MAC 地址")
      return
    }
    setAddingIds((prev) => new Set(prev).add(String(idx)))
    setError("")

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: finalName,
        mac: finalMac,
        ip: entry.ip,
      }),
    })

    if (res.ok) {
      setScanResults((prev) => prev.filter((_, i) => i !== idx))
      setEditingName(null)
      fetchWithStatus()
    } else {
      const data = await res.json()
      setError(data.error)
    }
    setAddingIds((prev) => {
      const next = new Set(prev)
      next.delete(String(idx))
      return next
    })
  }

  const startEditing = (entry: ScanEntry, idx: number) => {
    setEditingName(`${entry.mac || entry.ip}-${idx}`)
    setCustomName(entry.label || entry.hostname || entry.ip || "")
    setCustomMac(entry.mac || "")
  }

  const deleteDevice = async (id: string) => {
    await fetch(`/api/devices/${id}`, { method: "DELETE" })
    fetchWithStatus()
  }

  const wakeDevice = async (id: string) => {
    setWakingId(id)
    setMsg("")

    const res = await fetch("/api/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })

    const data = await res.json()
    setWakingId(null)

    if (res.ok) {
      setMsg(`${data.name} 已发送唤醒包`)
    } else {
      setError(data.error)
    }
  }

  const startScan = async () => {
    setScanning(true)
    setError("")
    setScanResults([])
    setShowScan(true)

    try {
      const scanDevices = await runScan()
      await syncDeviceIPs(scanDevices)

      const existingMacs = new Set(devices.map((d) => d.mac))
      setScanResults(
        scanDevices.filter((e: ScanEntry) => !existingMacs.has(e.mac))
      )
    } catch {
      setError("扫描失败")
    } finally {
      setScanning(false)
    }
  }

  const formatMacInput = (value: string) => {
    const cleaned = value.replace(/[^0-9a-fA-F]/g, "").slice(0, 12)
    const parts: string[] = []
    for (let i = 0; i < cleaned.length; i += 2) {
      parts.push(cleaned.slice(i, i + 2))
    }
    return parts.join(":").toLowerCase()
  }

  return (
    <div className="max-w-lg mx-auto w-full px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Wake-on-LAN
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {view === "list" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setView("add"); setConfirmLogout(false); setShowManualAdd(false) }}
              className="px-3 py-1.5 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
            >
              添加设备
            </button>
            {confirmLogout ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={async () => {
                    await fetch("/api/login", { method: "DELETE" })
                    window.location.href = "/login"
                  }}
                  className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 rounded-md text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
                >
                  确认退出
                </button>
                <button
                  onClick={() => setConfirmLogout(false)}
                  className="px-3 py-1.5 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 rounded-md text-sm font-medium hover:opacity-80 transition-opacity"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmLogout(true)}
                className="px-3 py-1.5 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 rounded-md text-sm font-medium hover:opacity-80 transition-opacity"
              >
                退出
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setView("list")
              setError("")
              setMsg("")
              setConfirmLogout(false)
              setShowManualAdd(false)
            }}
            className="px-3 py-1.5 bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 rounded-md text-sm font-medium hover:opacity-80 transition-opacity"
          >
            ← 返回
          </button>
        )}
        </div>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400 text-sm text-center mb-4">
          {error}
        </p>
      )}
      {msg && (
        <p className="text-green-600 dark:text-green-400 text-sm text-center mb-4">
          {msg}
        </p>
      )}

      {view === "add" && (
        <>
          <div className="mb-6">
            <button
              onClick={() => setShowManualAdd(!showManualAdd)}
              className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors flex items-center justify-center gap-1"
            >
              手动添加
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className={`transition-transform ${showManualAdd ? "rotate-180" : ""}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {showManualAdd && (
              <form onSubmit={addDevice} className="mt-3 space-y-3">
                <input
                  type="text"
                  placeholder="设备名称"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-transparent text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                  required
                />
                <input
                  type="text"
                  placeholder="MAC 地址 (例如 AA:BB:CC:DD:EE:FF)"
                  value={mac}
                  onChange={(e) => setMac(formatMacInput(e.target.value))}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-transparent text-sm outline-none font-mono focus:border-zinc-400 dark:focus:border-zinc-600"
                  required
                />
                <input
                  type="text"
                  placeholder="IP 地址 (可选)"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-transparent text-sm outline-none font-mono focus:border-zinc-400 dark:focus:border-zinc-600"
                />
                <button
                  type="submit"
                  className="w-full px-3 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  添加
                </button>
              </form>
            )}
          </div>

          <div className="mb-6">
            <button
              onClick={startScan}
              disabled={scanning}
              className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
            >
              {scanning ? "正在扫描局域网..." : "扫描局域网设备"}
            </button>
          </div>

          {showScan && !scanning && scanResults.length > 0 && (
            <div className="mb-6">
              <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
                扫描结果 ({scanResults.length})
              </h2>
              <ul className="space-y-1">
                {scanResults.map((entry, idx) => {
                  const key = `${entry.mac || entry.ip}-${idx}`
                  const isEditing = editingName === key
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between py-2 px-3 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-md"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold font-mono flex-shrink-0">
                            {entry.ip}
                          </p>
                          {isEditing ? (
                            <div className="w-full space-y-1">
                              <input
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder="设备名称"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") confirmScanned(entry, idx)
                                  if (e.key === "Escape") setEditingName(null)
                                }}
                                className="w-full px-2 py-0.5 border border-zinc-300 dark:border-zinc-700 rounded bg-transparent text-sm outline-none focus:border-zinc-500"
                                autoFocus
                              />
                              {!entry.mac && (
                                <input
                                  type="text"
                                  value={customMac}
                                  onChange={(e) => setCustomMac(e.target.value)}
                                  placeholder="MAC 地址"
                                  className="w-full px-2 py-0.5 border border-zinc-300 dark:border-zinc-700 rounded bg-transparent text-xs font-mono outline-none focus:border-zinc-500"
                                />
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-400 truncate">
                              {entry.label || entry.hostname || entry.ip}
                            </p>
                          )}
                        </div>
                        {(entry.hostname || entry.netbiosName) && (
                          <p className="text-xs text-zinc-400 truncate">
                            {[entry.hostname, entry.netbiosName].filter(Boolean).join(" / ")}
                          </p>
                        )}
                        <p className="text-xs text-zinc-500 font-mono">
                          {entry.mac}
                          {entry.brand && (
                            <span className="font-sans ml-2">{entry.brand}</span>
                          )}
                        </p>
                      </div>
                      {isEditing ? (
                        <div className="flex gap-1 ml-2">
                          <button
                            onClick={() => setEditingName(null)}
                            className="px-2 py-1 text-xs rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => confirmScanned(entry, idx)}
                            disabled={addingIds.has(String(idx))}
                            className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                          >
                            确认
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditing(entry, idx)}
                          className="px-3 py-1 text-xs rounded-md bg-foreground text-background hover:opacity-80 transition-opacity"
                        >
                          添加
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {view === "list" && (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-500">
              {Object.values(onlineMap).filter(Boolean).length}/{devices.length} 在线
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshIPs}
                disabled={refreshingIP}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
              >
                {refreshingIP ? "刷IP中..." : "刷IP"}
              </button>
              <button
                onClick={fetchWithStatus}
                disabled={refreshing}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 disabled:opacity-50"
              >
                {refreshing ? "刷新中..." : "刷新"}
              </button>
            </div>
          </div>
          {devices.length === 0 ? (
            <p className="text-zinc-400 text-sm text-center">暂无设备</p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between py-2 px-3 border border-zinc-100 dark:border-zinc-800 rounded-md"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          d.ip && onlineMap[d.ip] !== undefined
                            ? onlineMap[d.ip]
                              ? "bg-green-500"
                              : "bg-zinc-300 dark:bg-zinc-600"
                            : "bg-zinc-200 dark:bg-zinc-700"
                        }`}
                      />
                      <p className="text-sm font-medium">{d.name}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 ml-4">
                      {d.ip && (
                        <p className="text-xs text-zinc-500 font-mono">{d.ip}</p>
                      )}
                      <p className="text-xs text-zinc-400 font-mono">{d.mac}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => wakeDevice(d.id)}
                      disabled={wakingId === d.id}
                      className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      {wakingId === d.id ? "..." : "唤醒"}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => {
                          setMenuOpenId(menuOpenId === d.id ? null : d.id)
                          setConfirmDeleteId(null)
                        }}
                        className="px-2 py-1 rounded-md text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        ···
                      </button>
                      {menuOpenId === d.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => {
                              setMenuOpenId(null)
                              setConfirmDeleteId(null)
                            }}
                          />
                          <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg py-1 min-w-[120px]">
                            {confirmDeleteId === d.id ? (
                              <div className="px-2 py-1 space-y-1">
                                <p className="text-xs text-zinc-500 px-1">确认删除？</p>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => {
                                      deleteDevice(d.id)
                                      setMenuOpenId(null)
                                      setConfirmDeleteId(null)
                                    }}
                                    className="flex-1 px-2 py-1 text-xs rounded bg-red-50 text-red-600 border border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900 transition-colors font-medium"
                                  >
                                    确认
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="px-2 py-1 text-xs rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 hover:opacity-80 transition-opacity font-medium"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(d.id)}
                                className="w-full text-left px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              >
                                删除
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
