import { describe, it, expect } from 'vitest'
import {
  surfaceForPathname,
  SURFACE_REGISTRY,
  SURFACE_MAP,
  type SurfaceId,
} from '../registry'

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------
describe('SURFACE_REGISTRY', () => {
  it('exports six surfaces', () => {
    expect(SURFACE_REGISTRY).toHaveLength(6)
  })

  it('declaration order matches rail order (overview, tasks, goals, email, settings, activity)', () => {
    const ids = SURFACE_REGISTRY.map((e) => e.surface)
    expect(ids).toEqual(['overview', 'tasks', 'goals', 'email', 'settings', 'activity'])
  })

  it('every rail-true surface has an icon and label', () => {
    for (const entry of SURFACE_REGISTRY) {
      if (entry.rail) {
        expect(entry.icon).toBeTruthy()
        expect(entry.label.length).toBeGreaterThan(0)
      }
    }
  })

  it('activity has rail=false', () => {
    expect(SURFACE_MAP.activity.rail).toBe(false)
  })

  it('SURFACE_MAP contains all six surfaces', () => {
    const ids: SurfaceId[] = ['overview', 'tasks', 'goals', 'email', 'settings', 'activity']
    for (const id of ids) {
      expect(SURFACE_MAP[id]).toBeDefined()
    }
  })

  it('each surface declares the correct tool list (spot-check)', () => {
    expect(SURFACE_MAP.overview.tools).toContain('generate_daily_briefing')
    expect(SURFACE_MAP.tasks.tools).toContain('create_task')
    expect(SURFACE_MAP.goals.tools).toContain('create_goal')
    expect(SURFACE_MAP.email.tools).toContain('get_email_thread')
    expect(SURFACE_MAP.activity.tools).toContain('submit_for_approval')
    expect(SURFACE_MAP.settings.tools).toHaveLength(0)
  })

  it('overview matchPrefixes contains only / (no /today interim alias)', () => {
    expect(SURFACE_MAP.overview.matchPrefixes).toEqual(['/'])
  })

  it('settings matchPrefixes contains only /settings (no /memory or /constraints aliases)', () => {
    expect(SURFACE_MAP.settings.matchPrefixes).toEqual(['/settings'])
  })

  it('activity matchPrefixes contains only /activity (no /approvals alias)', () => {
    expect(SURFACE_MAP.activity.matchPrefixes).toEqual(['/activity'])
  })
})

// ---------------------------------------------------------------------------
// surfaceForPathname — final C5 route map (Wave 9.1.3)
// ---------------------------------------------------------------------------
describe('surfaceForPathname', () => {
  // --- overview ---
  it('/ → overview', () => {
    expect(surfaceForPathname('/')).toBe('overview')
  })

  // --- tasks ---
  it('/tasks → tasks', () => {
    expect(surfaceForPathname('/tasks')).toBe('tasks')
  })
  it('/tasks/some-id → tasks (dynamic segment)', () => {
    expect(surfaceForPathname('/tasks/abc-123')).toBe('tasks')
  })

  // --- goals ---
  it('/goals → goals', () => {
    expect(surfaceForPathname('/goals')).toBe('goals')
  })
  it('/goals/[id] → goals', () => {
    expect(surfaceForPathname('/goals/g-999')).toBe('goals')
  })
  it('/projects → goals (legacy alias)', () => {
    expect(surfaceForPathname('/projects')).toBe('goals')
  })
  it('/projects/[id] → goals (legacy alias dynamic)', () => {
    expect(surfaceForPathname('/projects/p-42')).toBe('goals')
  })

  // --- email ---
  it('/email → email', () => {
    expect(surfaceForPathname('/email')).toBe('email')
  })
  it('/email/[id] → email', () => {
    expect(surfaceForPathname('/email/thread-7')).toBe('email')
  })

  // --- settings (including sub-routes) ---
  it('/settings → settings', () => {
    expect(surfaceForPathname('/settings')).toBe('settings')
  })
  it('/settings/memory → settings', () => {
    expect(surfaceForPathname('/settings/memory')).toBe('settings')
  })
  it('/settings/constraints → settings', () => {
    expect(surfaceForPathname('/settings/constraints')).toBe('settings')
  })
  it('/settings/integrations → settings', () => {
    expect(surfaceForPathname('/settings/integrations')).toBe('settings')
  })

  // --- activity ---
  it('/activity → activity', () => {
    expect(surfaceForPathname('/activity')).toBe('activity')
  })

  // --- null cases (retired routes redirect via next.config.ts) ---
  it('/chat → null (retired; redirects to /)', () => {
    expect(surfaceForPathname('/chat')).toBeNull()
  })
  it('/today → null (retired; redirects to /)', () => {
    expect(surfaceForPathname('/today')).toBeNull()
  })
  it('/approvals → null (retired; redirects to /activity)', () => {
    expect(surfaceForPathname('/approvals')).toBeNull()
  })
  it('/memory → null (retired; redirects to /settings/memory)', () => {
    expect(surfaceForPathname('/memory')).toBeNull()
  })
  it('/constraints → null (retired; redirects to /settings/constraints)', () => {
    expect(surfaceForPathname('/constraints')).toBeNull()
  })
  it('/unknown-route → null', () => {
    expect(surfaceForPathname('/unknown-route')).toBeNull()
  })

  // --- edge cases ---
  it('/ does not greedily match /tasks', () => {
    expect(surfaceForPathname('/tasks')).toBe('tasks')
  })
  it('/ does not greedily match /settings', () => {
    expect(surfaceForPathname('/settings')).toBe('settings')
  })
})
