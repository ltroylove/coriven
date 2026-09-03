'use client'

/**
 * Settings layout — provides grouped sub-navigation.
 *
 * Groups per design §6:
 *   Assistant — sentinel mode, briefing settings (existing)
 *   Mind       — Memory, Constraints (relocated from top-level routes)
 *   Connections — integrations (existing)
 *   Account    — (future; placeholder stub)
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS = [
  {
    label: 'Assistant',
    items: [
      { href: '/settings', label: 'General', exact: true },
    ],
  },
  {
    label: 'Mind',
    items: [
      { href: '/settings/memory',      label: 'Memory',      exact: false },
      { href: '/settings/constraints', label: 'Constraints', exact: false },
    ],
  },
  {
    label: 'Connections',
    items: [
      { href: '/settings/integrations', label: 'Integrations', exact: false },
    ],
  },
]

function SettingsNav() {
  const pathname = usePathname()

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <nav
      aria-label="Settings navigation"
      className="w-44 shrink-0 border-r border-gray-800 pr-4 pt-1"
    >
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mb-5">
          <p className="text-[10px] font-medium uppercase tracking-widest text-gray-600 mb-1.5 px-2">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href, item.exact) ? 'page' : undefined}
                  className={`block px-2 py-1.5 rounded text-sm transition-colors ${
                    isActive(item.href, item.exact)
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-8 min-h-full">
      <SettingsNav />
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
