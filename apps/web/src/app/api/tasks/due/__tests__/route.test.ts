import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — declared before any imports so vi.mock hoisting works.
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { GET } from '../route'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type QueryResult = { data: unknown; error: null | { message: string } }

/**
 * Build a chainable Supabase query mock.
 * Each method returns `chain` for fluent chaining; `await chain` resolves to `result`
 * via a manually attached `then` that satisfies Promise<unknown>.
 */
function buildQueryChain(result: QueryResult): Record<string, ReturnType<typeof vi.fn>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {}
  for (const m of ['select', 'eq', 'lte', 'or', 'not', 'order']) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  // Make `await chain` work — attach a Promise-compatible `then`.
  chain.then = (
    onfulfilled?: ((value: QueryResult) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ) => Promise.resolve(result).then(onfulfilled, onrejected)
  return chain as Record<string, ReturnType<typeof vi.fn>>
}

/** Build a minimal mock service client. */
function buildServiceClientMock(result: QueryResult) {
  const query = buildQueryChain(result)
  return { from: vi.fn().mockReturnValue(query) }
}

/** Build a minimal mock auth client. */
function buildAuthClientMock(user: { id: string } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  }
}

// Typed references to the vi.mocked factories.
const mockCreateAuthServerClient = vi.mocked(createAuthServerClient)
const mockCreateServiceClient = vi.mocked(createServiceClient)

// ---------------------------------------------------------------------------
// Sample reminder rows
// ---------------------------------------------------------------------------

const BASE_REMINDER = {
  id: 'rem-1',
  task_id: 'task-1',
  user_id: 'user-abc',
  remind_at: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // +1h (within 24h)
  recurrence_type: 'none',
  recurrence_end_at: null,
  snoozed_until: null,
  last_fired_at: null,
  created_at: new Date().toISOString(),
  task: { title: 'Buy groceries', status: 'pending' },
}

// A reminder whose task was filtered by the DB .not() filter — Supabase
// nullifies the join object when the task row is excluded.
const DONE_TASK_REMINDER = {
  ...BASE_REMINDER,
  id: 'rem-2',
  task: null,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/tasks/due', () => {
  // (a) unauthenticated request
  describe('unauthenticated request', () => {
    it('returns 401 when no user is found in the session', async () => {
      mockCreateAuthServerClient.mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildAuthClientMock(null) as any,
      )

      const response = await GET()
      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body).toEqual({ error: 'Unauthorized' })
    })
  })

  // (b) authed user with due reminders
  describe('authed user with due reminders', () => {
    it('returns 200 with reminder rows from task_reminders', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      mockCreateServiceClient.mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildServiceClientMock({ data: [BASE_REMINDER], error: null }) as any,
      )

      const response = await GET()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('rem-1')
      expect(body[0].task.title).toBe('Buy groceries')
    })

    it('queries the task_reminders table via .from("task_reminders")', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      const serviceClient = buildServiceClientMock({ data: [BASE_REMINDER], error: null })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateServiceClient.mockReturnValue(serviceClient as any)

      await GET()
      expect(serviceClient.from).toHaveBeenCalledWith('task_reminders')
    })
  })

  // (c) reminders for done/cancelled tasks are excluded
  describe('done/cancelled task filtering', () => {
    it('excludes rows where the task join is null (done/cancelled filtered by DB)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      mockCreateServiceClient.mockReturnValue(
        buildServiceClientMock({
          data: [BASE_REMINDER, DONE_TASK_REMINDER],
          error: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      )

      const response = await GET()
      expect(response.status).toBe(200)
      const body = await response.json()
      // The route's client-side .filter(r => r.task !== null) removes the null-task row.
      expect(body).toHaveLength(1)
      expect(body[0].id).toBe('rem-1')
    })

    it('applies a .not() filter to exclude done/cancelled tasks at the DB level', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      const serviceClient = buildServiceClientMock({ data: [], error: null })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateServiceClient.mockReturnValue(serviceClient as any)

      await GET()

      const queryChain = serviceClient.from.mock.results[0].value as Record<
        string,
        ReturnType<typeof vi.fn>
      >
      expect(queryChain.not).toHaveBeenCalledOnce()
      const notArgs: unknown[] = queryChain.not.mock.calls[0]
      expect(notArgs[0]).toBe('task.status')
      expect(notArgs[1]).toBe('in')
      expect(String(notArgs[2])).toMatch(/done/)
      expect(String(notArgs[2])).toMatch(/cancelled/)
    })
  })

  // (d) snoozed reminders are excluded
  describe('snoozed reminder filtering', () => {
    it('does not return snoozed reminders (excluded by DB .or() filter)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      // The DB excludes snoozed rows; mock returns only the non-snoozed one.
      mockCreateServiceClient.mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        buildServiceClientMock({ data: [BASE_REMINDER], error: null }) as any,
      )

      const response = await GET()
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toHaveLength(1)
      expect(body.find((r: { id: string }) => r.id === 'rem-3')).toBeUndefined()
    })

    it('applies an .or() filter with snoozed_until conditions on the query', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      const serviceClient = buildServiceClientMock({ data: [], error: null })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateServiceClient.mockReturnValue(serviceClient as any)

      await GET()

      const queryChain = serviceClient.from.mock.results[0].value as Record<
        string,
        ReturnType<typeof vi.fn>
      >
      expect(queryChain.or).toHaveBeenCalledOnce()
      const orArg: string = queryChain.or.mock.calls[0][0]
      expect(orArg).toMatch(/snoozed_until\.is\.null/)
      expect(orArg).toMatch(/snoozed_until\.lte\./)
    })
  })

  // error handling
  describe('error handling', () => {
    it('returns 500 when the service query returns an error', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockCreateAuthServerClient.mockResolvedValue(buildAuthClientMock({ id: 'user-abc' }) as any)
      mockCreateServiceClient.mockReturnValue(
        buildServiceClientMock({
          data: null,
          error: { message: 'DB connection failed' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
      )

      const response = await GET()
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body).toEqual({ error: 'DB connection failed' })
    })
  })
})
