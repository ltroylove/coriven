// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

describe('deleteMemory', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when not authenticated', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const { deleteMemory } = await import('../memory')
    const result = await deleteMemory('some-id')
    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('soft-deletes by superseding with tombstone', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)

    const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'tombstone-id' }, error: null })
    const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
    const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
    const mockEqChain = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: mockInsert, update: mockUpdate }),
    } as never)

    const { deleteMemory } = await import('../memory')
    const result = await deleteMemory('memory-1')
    expect(result).toEqual({})
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      content: '__deleted__',
      source: 'tombstone',
    }))
  })
})

describe('deleteEntity', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when not authenticated', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const { deleteEntity } = await import('../memory')
    const result = await deleteEntity('some-id')
    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('hard-deletes the entity row', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)

    const mockEqChain = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq1 })

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ delete: mockDelete }),
    } as never)

    const { deleteEntity } = await import('../memory')
    const result = await deleteEntity('entity-1')
    expect(result).toEqual({})
    expect(mockDelete).toHaveBeenCalled()
  })
})

describe('editEntity', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns error when not authenticated', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as never)
    const { editEntity } = await import('../memory')
    const result = await editEntity('some-id', { name: 'Alice' })
    expect(result).toEqual({ error: 'Not authenticated' })
  })

  it('returns error when name is empty', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)
    const { editEntity } = await import('../memory')
    const result = await editEntity('some-id', { name: '   ' })
    expect(result).toEqual({ error: 'Name is required' })
  })

  it('updates the entity in-place', async () => {
    const { createAuthServerClient } = await import('@/lib/supabase/auth-server')
    vi.mocked(createAuthServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    } as never)

    const mockEqChain = vi.fn().mockResolvedValue({ error: null })
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEqChain })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 })

    const { createServiceClient } = await import('@/lib/supabase/server')
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn().mockReturnValue({ update: mockUpdate }),
    } as never)

    const { editEntity } = await import('../memory')
    const result = await editEntity('entity-1', { name: 'Alice', description: 'My friend', aliases: ['Al'] })
    expect(result).toEqual({})
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alice' }))
  })
})
