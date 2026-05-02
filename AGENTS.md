<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Quick start

```bash
# Use Node >= 20 (Node 18 will not build)
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Architecture

A Wake-on-LAN web tool: manage devices by name + MAC address, send magic packets to wake them on the LAN.

```
src/
  proxy.ts              # auth guard — redirects unauthenticated to /login
  app/
    page.tsx            # "use client" — device list + online status
    login/page.tsx      # login page (challenge-response auth)
    layout.tsx          # root layout, zh-CN lang
    api/devices/route.ts        # GET (list) / POST (add)
    api/devices/[id]/route.ts   # DELETE device, PATCH (update IP)
    api/devices/status/route.ts # POST — ping check for online status
    api/devices/refresh-ip/ (unused)
    api/scan/route.ts   # GET — ping sweep + mDNS + NetBIOS + UPnP + port scan
    api/wake/route.ts   # POST — sends magic packet via `wol` npm
    api/login/route.ts  # GET (nonce) / POST (challenge-response) / DELETE (logout)
  lib/store.ts          # readDevices / writeDevices on data/devices.json
  lib/auth.ts           # session store (Web Crypto)
data/                   # auto-created at runtime — devices.json + auth.json
```

## Next.js 16 gotchas

- `context.params` is a **Promise**, always `await` it in route handlers.
- Route handlers use standard Web APIs (`Request`, `Response.json()`) — not `NextResponse.json()`.
  However `NextResponse` is still available and can be used for convenience.
- Default caching for `GET` handlers is **dynamic** (not static).
- Use `RouteContext<'/path/[param]'>` for strongly typed params (global type, no import needed).
- `middleware.ts` renamed to `proxy.ts`. Export `proxy` function, not `middleware`.

## Data store

Devices are persisted as JSON in `data/devices.json`. The file is auto-created on first read/write. No database or migration needed.

## Auth

Challenge-response via `src/lib/auth.ts` (Web Crypto, in-memory session store). Login page computes `SHA256(nonce + SHA256(password))`, sends to `/api/login`. Password hash stored in `data/auth.json`.
