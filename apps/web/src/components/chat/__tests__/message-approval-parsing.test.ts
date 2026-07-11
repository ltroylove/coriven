/**
 * Unit tests for the tool-result content parsing logic used in message.tsx
 * when routing submit_for_approval results to InlineApprovalCard.
 *
 * The parseApprovalId function is not exported; we replicate its logic here
 * to ensure the contract is locked.
 */

import { describe, it, expect } from 'vitest'

// Replicated from message.tsx — keep in sync if logic changes
function parseApprovalId(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'approval_id' in parsed &&
      typeof (parsed as Record<string, unknown>).approval_id === 'string'
    ) {
      return (parsed as Record<string, unknown>).approval_id as string
    }
    return null
  } catch {
    return null
  }
}

describe('parseApprovalId', () => {
  it('returns approval_id from well-formed result content', () => {
    const content = JSON.stringify({
      approval_id: 'abc-123',
      status: 'pending',
      message: 'Action queued — review it in the card above',
    })
    expect(parseApprovalId(content)).toBe('abc-123')
  })

  it('returns null when approval_id is missing', () => {
    const content = JSON.stringify({ status: 'pending' })
    expect(parseApprovalId(content)).toBeNull()
  })

  it('returns null when approval_id is not a string', () => {
    const content = JSON.stringify({ approval_id: 42, status: 'pending' })
    expect(parseApprovalId(content)).toBeNull()
  })

  it('returns null for non-JSON content (plain text tool result)', () => {
    expect(parseApprovalId('Task created successfully')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseApprovalId('')).toBeNull()
  })

  it('returns null for JSON array (not an object)', () => {
    expect(parseApprovalId('["approval_id", "value"]')).toBeNull()
  })

  it('returns null for JSON null', () => {
    expect(parseApprovalId('null')).toBeNull()
  })

  it('handles approval_id with a UUID format', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const content = JSON.stringify({ approval_id: id, status: 'pending' })
    expect(parseApprovalId(content)).toBe(id)
  })
})
