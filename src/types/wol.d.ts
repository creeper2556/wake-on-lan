declare module "wol" {
  export function wake(
    mac: string,
    optionsOrCallback?: Record<string, unknown> | ((err: Error | null) => void)
  ): void
  export function createMagicPacket(mac: string): Buffer
}
