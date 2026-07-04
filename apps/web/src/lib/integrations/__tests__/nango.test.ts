import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @nangohq/node before any import of the module under test
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn()

vi.mock('@nangohq/node', () => {
  class NangoMock {
    getToken = mockGetToken
  }
  return { Nango: NangoMock }
})

// ---------------------------------------------------------------------------
// Mock Supabase service client
// ---------------------------------------------------------------------------

const mockMaybeSingle = vi.fn()
const mockEqProvider = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockEqUser = vi.fn(() => ({ eq: mockEqProvider }))
const mockSelect = vi.fn(() => ({ eq: mockEqUser }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { getConnection, getProviderToken } from '../nango'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setEnvVars(vars: { NANGO_SECRET_KEY?: string; NANGO_HOST?: string }) {
  if (vars.NANGO_SECRET_KEY !== undefined) {
    process.env.NANGO_SECRET_KEY = vars.NANGO_SECRET_KEY
  } else {
    delete process.env.NANGO_SECRET_KEY
  }
  if (vars.NANGO_HOST !== undefined) {
    process.env.NANGO_HOST = vars.NANGO_HOST
  } else {
    delete process.env.NANGO_HOST
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PROVIDER_CONFIG_KEYS mapping (via getProviderToken)', () => {
  beforeEach(() => {
    setEnvVars({ NANGO_SECRET_KEY: 'test-secret', NANGO_HOST: 'https://nango.example.com' })
    // Simulate a connected user
    mockMaybeSingle.mockResolvedValue({ data: { nango_connection_id: 'conn-abc' }, error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.NANGO_SECRET_KEY
    delete process.env.NANGO_HOST
  })

  it('maps gmail → google-mail', async () => {
    mockGetToken.mockResolvedValue('access-token-xyz')
    await getProviderToken('user-1', 'gmail')
    expect(mockGetToken).toHaveBeenCalledWith('google-mail', 'conn-abc')
  })

  it('maps outlook → outlook', async () => {
    mockGetToken.mockResolvedValue('access-token-xyz')
    await getProviderToken('user-1', 'outlook')
    expect(mockGetToken).toHaveBeenCalledWith('outlook', 'conn-abc')
  })

  it('maps google_calendar → google-calendar', async () => {
    mockGetToken.mockResolvedValue('access-token-xyz')
    await getProviderToken('user-1', 'google_calendar')
    expect(mockGetToken).toHaveBeenCalledWith('google-calendar', 'conn-abc')
  })

  it('maps outlook_calendar → outlook-calendar', async () => {
    mockGetToken.mockResolvedValue('access-token-xyz')
    await getProviderToken('user-1', 'outlook_calendar')
    expect(mockGetToken).toHaveBeenCalledWith('outlook-calendar', 'conn-abc')
  })
})

describe('getConnection', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns the nango_connection_id when a row exists', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { nango_connection_id: 'conn-123' },
      error: null,
    })
    const result = await getConnection('user-1', 'gmail')
    expect(result).toBe('conn-123')
  })

  it('returns null when no row exists (maybeSingle returns null data)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const result = await getConnection('user-1', 'outlook')
    expect(result).toBeNull()
  })

  it('returns null and logs error when the DB call fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const result = await getConnection('user-1', 'gmail')
    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })
})

describe('getProviderToken', () => {
  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.NANGO_SECRET_KEY
    delete process.env.NANGO_HOST
  })

  it('returns the access token when user is connected and Nango succeeds', async () => {
    setEnvVars({ NANGO_SECRET_KEY: 'test-secret', NANGO_HOST: 'https://nango.example.com' })
    mockMaybeSingle.mockResolvedValue({ data: { nango_connection_id: 'conn-abc' }, error: null })
    mockGetToken.mockResolvedValue('valid-access-token')

    const result = await getProviderToken('user-1', 'gmail')
    expect(result).toBe('valid-access-token')
  })

  it('returns null (not null-throwing) when there is no connection row', async () => {
    setEnvVars({ NANGO_SECRET_KEY: 'test-secret', NANGO_HOST: 'https://nango.example.com' })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await getProviderToken('user-1', 'outlook')
    expect(result).toBeNull()
    // Should log a "not_connected" event, not throw
    expect(consoleSpy).toHaveBeenCalledOnce()
    const logArg = consoleSpy.mock.calls[0][0] as string
    expect(logArg).toContain('not_connected')
    consoleSpy.mockRestore()
  })

  it('returns null and logs error (without token values) when Nango throws', async () => {
    setEnvVars({ NANGO_SECRET_KEY: 'test-secret', NANGO_HOST: 'https://nango.example.com' })
    mockMaybeSingle.mockResolvedValue({ data: { nango_connection_id: 'conn-abc' }, error: null })
    mockGetToken.mockRejectedValue(new Error('Nango 503 Service Unavailable'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await getProviderToken('user-1', 'gmail')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledOnce()
    const logArg = consoleSpy.mock.calls[0][0] as string
    // Log must contain context but must NOT contain any token-like value
    expect(logArg).toContain('nango_error')
    expect(logArg).toContain('503')
    expect(logArg).not.toContain('valid-access-token')
    consoleSpy.mockRestore()
  })

  it('returns null when NANGO_SECRET_KEY env var is missing', async () => {
    setEnvVars({ NANGO_HOST: 'https://nango.example.com' }) // no secret key
    mockMaybeSingle.mockResolvedValue({ data: { nango_connection_id: 'conn-abc' }, error: null })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await getProviderToken('user-1', 'gmail')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledOnce()
    const logArg = consoleSpy.mock.calls[0][0] as string
    expect(logArg).toContain('client_init_error')
    consoleSpy.mockRestore()
  })

  it('returns null when NANGO_HOST env var is missing', async () => {
    setEnvVars({ NANGO_SECRET_KEY: 'test-secret' }) // no host
    mockMaybeSingle.mockResolvedValue({ data: { nango_connection_id: 'conn-abc' }, error: null })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await getProviderToken('user-1', 'gmail')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledOnce()
    const logArg = consoleSpy.mock.calls[0][0] as string
    expect(logArg).toContain('client_init_error')
    consoleSpy.mockRestore()
  })
})
