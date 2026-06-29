import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Coriven',
  description: 'Coriven — your AI-powered personal assistant and Life OS',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  )
}
