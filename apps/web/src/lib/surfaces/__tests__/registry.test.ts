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
})

// ---------------------------------------------------------------------------
// surfaceForPathname
// ---------------------------------------------------------------------------
describe('surfaceForPathname', () => {
  // --- overview ---
  it('/ → overview', () => {
    expect(surfaceForPathname('/')).toBe('overview')
  })
  it('/today → overview (interim C5 mapping)', () => {
    expect(surfaceForPathname('/today')).toBe('overview')
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

  // --- settings (+ interim routes) ---
  it('/settings → settings', () => {
    expect(surfaceForPathname('/settings')).toBe('settings')
  })
  it('/memory → settings (interim until 9.1.3)', () => {
    expect(surfaceForPathname('/memory')).toBe('settings')
  })
  it('/constraints → settings (interim until 9.1.3)', () => {
    expect(surfaceForPathname('/constraints')).toBe('settings')
  })

  // --- activity (+ interim routes) ---
  it('/activity → activity', () => {
    expect(surfaceForPathname('/activity')).toBe('activity')
  })
  it('/approvals → activity (interim until 9.1.3)', () => {
    expect(surfaceForPathname('/approvals')).toBe('activity')
  })

  // --- null cases ---
  it('/chat → null (panel closed, full-width chat)', () => {
    expect(surfaceForPathname('/chat')).toBeNull()
  })
  it('/chat/room-id → null', () => {
    expect(surfaceForPathname('/chat/room-id')).toBeNull()
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
