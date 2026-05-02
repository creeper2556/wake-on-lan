const sessions = new Map<string, number>() // token -> expiry

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (v < now) sessions.delete(k)
  }
}, 300000)

export async function createSession(): Promise<string> {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  const token = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("")
  sessions.set(token, Date.now() + 86400000 * 7)
  return token
}

export function validateSession(token: string): boolean {
  const expiry = sessions.get(token)
  if (!expiry || expiry < Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

export function destroySession(token: string): void {
  sessions.delete(token)
}
