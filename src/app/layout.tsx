import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Wake-on-LAN",
  description: "局域网唤醒工具",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 antialiased">
        {children}
      </body>
    </html>
  )
}
