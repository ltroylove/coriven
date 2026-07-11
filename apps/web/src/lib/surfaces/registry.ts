// NO 'use client' — this module is isomorphic: imported by client panel-provider.tsx
// AND by server-side engine.ts (C6, Wave 9.4.1). Keep free of React hooks and
// next/navigation.

// Icons are imported as value references (lucide-react is isomorphic — no DOM side-effects).
import {
  LayoutDashboard,
  CheckSquare,
  Target,
  Mail,
  Settings,
  Activity,
  type LucideIcon,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// SurfaceId — the canonical set of surfaces (C2 table, rail/declaration order)
// ---------------------------------------------------------------------------
export type SurfaceId =
  | 'overview'
  | 'tasks'
  | 'goals'
  | 'email'
  | 'settings'
  | 'activity'

// ---------------------------------------------------------------------------
// SurfaceEntry
// ---------------------------------------------------------------------------
export interface SurfaceEntry {
  surface: SurfaceId
  /** Whether this surface has a rail icon */
  rail: boolean
  /** Primary route (used by openPanel → router.push) */
  route: string
  /** All pathname prefixes that map to this surface */
  matchPrefixes: string[]
  icon: LucideIcon
  label: string
  /** Tool names that trigger this surface (C2 §C6, consumed by Wave 9.4.1) */
  tools: string[]
}

// ---------------------------------------------------------------------------
// Registry — declaration order = rail order per C3
// ---------------------------------------------------------------------------
export const SURFACE_REGISTRY: SurfaceEntry[] = [
  {
    surface: 'overview',
    rail: true,
    route: '/',
    matchPrefixes: ['/', '/today'],
    icon: LayoutDashboard,
    label: 'Overview',
    tools: ['generate_daily_briefing', 'generate_weekly_review'],
  },
  {
    surface: 'tasks',
    rail: true,
    route: '/tasks',
    matchPrefixes: ['/tasks'],
    icon: CheckSquare,
    label: 'Tasks',
    tools: ['create_task', 'update_task', 'list_tasks', 'add_reminder', 'snooze_reminder'],
  },
  {
    surface: 'goals',
    rail: true,
    route: '/goals',
    matchPrefixes: ['/goals', '/projects'],
    icon: Target,
    label: 'Goals',
    tools: ['create_goal', 'update_goal', 'list_goals', 'set_goal_momentum', 'create_project'],
  },
  {
    surface: 'email',
    rail: true,
    route: '/email',
    matchPrefixes: ['/email'],
    icon: Mail,
    label: 'Email',
    tools: ['get_email_thread', 'search_email_metadata'],
  },
  {
    surface: 'settings',
    rail: true,
    route: '/settings',
    matchPrefixes: ['/settings', '/memory', '/constraints'],
    icon: Settings,
    label: 'Settings',
    tools: [],
  },
  {
    surface: 'activity',
    rail: false,
    route: '/activity',
    matchPrefixes: ['/activity', '/approvals'],
    icon: Activity,
    label: 'Activity',
    tools: ['submit_for_approval'],
  },
]

// Convenience lookup by SurfaceId
export const SURFACE_MAP: Record<SurfaceId, SurfaceEntry> = Object.fromEntries(
  SURFACE_REGISTRY.map((e) => [e.surface, e]),
) as Record<SurfaceId, SurfaceEntry>

// ---------------------------------------------------------------------------
// surfaceForPathname
//
// Returns the SurfaceId that owns a given pathname, or null when no surface
// owns it (e.g. `/chat` renders panel-closed, full-width chat).
//
// Rules (interim mappings per C2 + C5):
//   /            → overview
//   /today       → overview  (C5: will 301 in wave 9.1.3)
//   /tasks       → tasks
//   /tasks/[id]  → tasks
//   /goals       → goals
//   /goals/[id]  → goals
//   /projects    → goals     (legacy alias, C5 Finding 5)
//   /projects/[id] → goals
//   /email       → email
//   /email/[id]  → email
//   /settings    → settings
//   /memory      → settings  (interim until 9.1.3 folds into /settings)
//   /constraints → settings  (interim)
//   /activity    → activity
//   /approvals   → activity  (interim until 9.1.3)
//   /chat        → null      (panel closed, full-width chat)
// ---------------------------------------------------------------------------
export function surfaceForPathname(pathname: string): SurfaceId | null {
  // Explicit null for /chat (legacy route; panel closed)
  if (pathname === '/chat' || pathname.startsWith('/chat/')) return null

  // Walk the registry and check each entry's matchPrefixes
  for (const entry of SURFACE_REGISTRY) {
    for (const prefix of entry.matchPrefixes) {
      if (prefix === '/') {
        // Exact match only — '/' must not consume every route
        if (pathname === '/') return entry.surface
      } else {
        if (pathname === prefix || pathname.startsWith(prefix + '/')) {
          return entry.surface
        }
      }
    }
  }

  return null
}
