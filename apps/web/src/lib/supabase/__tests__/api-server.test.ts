// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — hoisted before imports.
// ---------------------------------------------------------------------------

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

import { createServerClient } from '@supabase/ssr'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createApiServerClient } from '../api-server'

const mockCreateServerClient = vi.mocked(createServerClient)
const mockCreateAuthServerClient = vi.mocked(createAuthServerClient)

/** Minimal fake Supabase client returned by createServerClient mock. */
const FAKE_BEARER_CLIENT = { auth: { getUser: vi.fn() }, _tag: 'bearer' }
/** Minimal fake Supabase client returned by createAuthServerClient mock. */
const FAKE_COOKIE_CLIENT = { auth: { getUser: vi.fn() }, _tag: 'cookie' }

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateServerClient.mockReturnValue(FAKE_BEARER_CLIENT as never)
  mockCreateAuthServerClient.mockResolvedValue(FAKE_COOKIE_CLIENT as never)
})

// ---------------------------------------------------------------------------
// Helper to build requests
// ---------------------------------------------------------------------------

function makeRequest(options: { bearerToken?: string } = {}) {
  const headers = new Headers()
  if (options.bearerToken) {
    headers.set('Authorization', `Bearer ${options.bearerToken}`)
  }
  return new Request('http://localhost/api/test', { headers })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createApiServerClient', () => {
  describe('Bearer token path', () => {
    it('calls createServerClient (not createAuthServerClient) when Bearer is present', async () => {
      const client = await createApiServerClient(makeRequest({ bearerToken: 'test-jwt-token' }))

      expect(mockCreateServerClient).toHaveBeenCalledOnce()
      expect(mockCreateAuthServerClient).not.toHaveBeenCalled()
      expect(client).toBe(FAKE_BEARER_CLIENT)
    })

    it('passes the Bearer token as a global Authorization header', async () => {
      await createApiServerClient(makeRequest({ bearerToken: 'my-secret-jwt' }))

      const [, , options] = mockCreateServerClient.mock.calls[0]
      expect(options.global?.headers?.Authorization).toBe('Bearer my-secret-jwt')
    })

    it('uses the anon key (not service role key) for the Bearer client', async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123'

      await createApiServerClient(makeRequest({ bearerToken: 'some-token' }))

      const [url, anonKey] = mockCreateServerClient.mock.calls[0]
      expect(url).toBe('https://test.supabase.co')
      expect(anonKey).toBe('anon-key-123')
    })

    it('provides empty cookie handlers (no cookie dependency in Bearer path)', async () => {
      await createApiServerClient(makeRequest({ bearerToken: 'any-token' }))

      const [, , options] = mockCreateServerClient.mock.calls[0]
      expect(typeof options.cookies?.getAll).toBe('function')
      expect(typeof options.cookies?.setAll).toBe('function')
      // getAll returns empty array — no cookies read
      expect((options.cookies?.getAll as () => unknown[])()).toEqual([])
      // setAll is a no-op — no cookies written
      expect(() => (options.cookies?.setAll as (c: unknown[]) => void)([])).not.toThrow()
    })
  })

  describe('cookie path (no Bearer)', () => {
    it('falls back to createAuthServerClient when no Authorization header', async () => {
      const client = await createApiServerClient(makeRequest())

      expect(mockCreateAuthServerClient).toHaveBeenCalledOnce()
      expect(mockCreateServerClient).not.toHaveBeenCalled()
      expect(client).toBe(FAKE_COOKIE_CLIENT)
    })

    it('falls back to createAuthServerClient when Authorization header is not Bearer', async () => {
      const headers = new Headers({ Authorization: 'Basic dXNlcjpwYXNz' })
      const request = new Request('http://localhost/api/test', { headers })

      const client = await createApiServerClient(request)

      expect(mockCreateAuthServerClient).toHaveBeenCalledOnce()
      expect(mockCreateServerClient).not.toHaveBeenCalled()
      expect(client).toBe(FAKE_COOKIE_CLIENT)
    })
  })
})
