'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  matchPrefixes?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { href: '/today', label: 'Today' },
  { href: '/chat', label: 'Chat' },
  { href: '/email', label: 'Email', matchPrefixes: ['/email'] },
  { href: '/tasks', label: 'Tasks' },
  { href: '/goals', label: 'Goals', matchPrefixes: ['/goals', '/projects'] },
  { href: '/approvals', label: 'Approvals' },
  { href: '/memory', label: 'Memory' },
  { href: '/constraints', label: 'Constraints' },
  { href: '/settings', label: 'Settings' },
]

export function AppNav() {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-4 text-sm">
      {NAV_ITEMS.map(({ href, label, matchPrefixes }) => {
        const prefixes = matchPrefixes ?? [href]
        const isActive = prefixes.some(
          (p) => pathname === p || pathname.startsWith(p + '/')
        )
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={`transition-colors ${
              isActive ? 'text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
