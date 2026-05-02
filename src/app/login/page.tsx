"use client"

import { useState } from "react"

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

export default function LoginPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const nonceRes = await fetch("/api/login")
      const { nonce } = await nonceRes.json()

      const passwordHash = await sha256(password)
      const response = await sha256(nonce + passwordHash)

      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, nonce, response }),
      })

      if (res.ok) {
        window.location.href = "/"
        return
      } else {
        const data = await res.json()
        setError(data.error || "登录失败")
      }
    } catch {
      setError("网络错误")
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-semibold tracking-tight mb-8 text-center">
          Wake-on-LAN
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-transparent text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            required
            autoFocus
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-zinc-200 dark:border-zinc-800 rounded-md bg-transparent text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            required
          />
          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm text-center">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-3 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  )
}
