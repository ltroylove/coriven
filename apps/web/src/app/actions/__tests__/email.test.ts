// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/auth-server', () => ({
  createAuthServerClient: vi.fn(),
}))

import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { revalidatePath } from 'next/cache'

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeUpdateChain(updateError: unknown = null) {
  const eqUser = vi.fn().mockResolvedValue({ error: updateError })
  const eqId = vi.fn().mockReturnValue({ eq: eqUser })
  const update = vi.fn().mockReturnValue({ eq: eqId })
  return { update, eqId, eqUser }
}

function makeSupabase(
  userId: string | null,
  updateError: unknown = null,
) {
  const { update } = makeUpdateChain(updateError)
  const mockFrom = vi.fn().mockReturnValue({ update })

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
    from: mockFrom,
  }
}

const mockCreateAuth = vi.mocked(createAuthServerClient)
const mockRevalidate = vi.mocked(revalidatePath)

// ---------------------------------------------------------------------------
// markEmailRead
// ---------------------------------------------------------------------------

describe('markEmailRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { success: false } when unauthenticated', async () => {
    mockCreateAuth.mockResolvedValue(makeSupabase(null) as never)

    const { markEmailRead } = await import('@/app/actions/email')
    const result = await markEmailRead('email-1')

    expect(result).toEqual({ success: false, error: 'Unauthenticated' })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('returns { success: true } and calls revalidatePath on success', async () => {
    mockCreateAuth.mockResolvedValue(makeSupabase('user-1') as never)

    const { markEmailRead } = await import('@/app/actions/email')
    const result = await markEmailRead('email-abc')

    expect(result).toEqual({ success: true })
    expect(mockRevalidate).toHaveBeenCalledWith('/email')
  })

  it('returns { success: false } when DB update fails', async () => {
    mockCreateAuth.mockResolvedValue(
      makeSupabase('user-1', { message: 'DB error' }) as never,
    )

    const { markEmailRead } = await import('@/app/actions/email')
    const result = await markEmailRead('email-xyz')

    expect(result).toEqual({ success: false, error: 'DB error' })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('calls from("email_metadata") with correct table name', async () => {
    const supabase = makeSupabase('user-1')
    mockCreateAuth.mockResolvedValue(supabase as never)

    const { markEmailRead } = await import('@/app/actions/email')
    await markEmailRead('email-test')

    expect(supabase.from).toHaveBeenCalledWith('email_metadata')
  })
})

// ---------------------------------------------------------------------------
// Security assertion: email detail page must not use dangerouslySetInnerHTML
// ---------------------------------------------------------------------------

describe('Email detail page security', () => {
  it('does not use dangerouslySetInnerHTML in the detail page source', () => {
    const detailPagePath = path.resolve(
      __dirname,
      '../../(app)/email/[id]/page.tsx',
    )
    const source = fs.readFileSync(detailPagePath, 'utf-8')
    expect(source).not.toContain('dangerouslySetInnerHTML')
  })

  it('uses whitespace-pre-wrap CSS for plain-text body rendering', () => {
    const detailPagePath = path.resolve(
      __dirname,
      '../../(app)/email/[id]/page.tsx',
    )
    const source = fs.readFileSync(detailPagePath, 'utf-8')
    expect(source).toContain('whitespace-pre-wrap')
  })

  it('has the external content security banner', () => {
    const detailPagePath = path.resolve(
      __dirname,
      '../../(app)/email/[id]/page.tsx',
    )
    const source = fs.readFileSync(detailPagePath, 'utf-8')
    expect(source).toContain('External content')
    expect(source).toContain('links are shown as text')
  })
})
