/**
 * Tests for apps/web/src/lib/email/triage.ts
 *
 * Verifies:
 * 1. Successful batch classification with valid model output
 * 2. Fallback on model API error
 * 3. Fallback on malformed/non-JSON model output
 * 4. Fallback on model returning non-array JSON
 * 5. Fallback on invalid urgency/category values (clamped to safe defaults)
 * 6. Empty batch returns []
 * 7. Message missing from model output falls back individually
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmailHeader } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Mock @/lib/anthropic
// ---------------------------------------------------------------------------

vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: vi.fn() } },
  CHAT_MODEL_FAST: 'claude-haiku-4-5-20251001',
}))

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

import { triageBatch } from '../triage'
import { anthropic } from '@/lib/anthropic'

const mockCreate = vi.mocked(anthropic.messages.create)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeader(overrides?: Partial<EmailHeader>): EmailHeader {
  return {
    message_id: 'msg-1',
    thread_id: 'thread-1',
    from_address: 'alice@example.com',
    subject: 'Hello world',
    received_at: '2024-07-03T10:00:00Z',
    ...overrides,
  }
}

function modelResponse(textContent: string) {
  return {
    content: [{ type: 'text', text: textContent }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triageBatch', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] for empty input without calling the model', async () => {
    const results = await triageBatch([])
    expect(results).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns classified results for valid model output', async () => {
    const headers = [
      makeHeader({ message_id: 'msg-1', subject: 'Urgent: sign contract' }),
      makeHeader({ message_id: 'msg-2', subject: 'Newsletter: top deals' }),
    ]

    mockCreate.mockResolvedValue(
      modelResponse(JSON.stringify([
        { id: 'msg-1', urgency: 'critical', category: 'action_required', summary: 'Contract signature needed immediately' },
        { id: 'msg-2', urgency: 'low', category: 'promotional', summary: 'Promotional newsletter with deals' },
      ])) as never,
    )

    const results = await triageBatch(headers)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ message_id: 'msg-1', urgency: 'critical', category: 'action_required' })
    expect(results[1]).toMatchObject({ message_id: 'msg-2', urgency: 'low', category: 'promotional' })
  })

  it('falls back to safe defaults on model API error', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'My subject' })]
    mockCreate.mockRejectedValue(new Error('API connection error'))

    const results = await triageBatch(headers)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      message_id: 'msg-1',
      urgency: 'normal',
      category: 'informational',
      summary: 'My subject',
    })
  })

  it('falls back on malformed model output (not valid JSON)', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'Fallback test' })]
    mockCreate.mockResolvedValue(modelResponse('Sorry, I cannot help with that.') as never)

    const results = await triageBatch(headers)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      message_id: 'msg-1',
      urgency: 'normal',
      category: 'informational',
      summary: 'Fallback test',
    })
  })

  it('falls back on model returning non-array JSON', async () => {
    const headers = [makeHeader({ message_id: 'msg-1' })]
    mockCreate.mockResolvedValue(modelResponse('{"error": "unexpected"}') as never)

    const results = await triageBatch(headers)
    expect(results).toHaveLength(1)
    expect(results[0]!.urgency).toBe('normal')
    expect(results[0]!.category).toBe('informational')
  })

  it('clamps invalid urgency value to "normal"', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'Test' })]
    mockCreate.mockResolvedValue(
      modelResponse(JSON.stringify([
        { id: 'msg-1', urgency: 'SUPER_CRITICAL', category: 'action_required', summary: 'Test' },
      ])) as never,
    )

    const results = await triageBatch(headers)
    expect(results[0]!.urgency).toBe('normal')
    expect(results[0]!.category).toBe('action_required')
  })

  it('clamps invalid category value to "informational"', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'Test' })]
    mockCreate.mockResolvedValue(
      modelResponse(JSON.stringify([
        { id: 'msg-1', urgency: 'high', category: 'unknown_cat', summary: 'Test' },
      ])) as never,
    )

    const results = await triageBatch(headers)
    expect(results[0]!.urgency).toBe('high')
    expect(results[0]!.category).toBe('informational')
  })

  it('falls back individually for messages missing from model output', async () => {
    const headers = [
      makeHeader({ message_id: 'msg-1', subject: 'Found message' }),
      makeHeader({ message_id: 'msg-2', subject: 'Missing message' }),
    ]
    // Model only returns msg-1
    mockCreate.mockResolvedValue(
      modelResponse(JSON.stringify([
        { id: 'msg-1', urgency: 'high', category: 'important', summary: 'Found' },
      ])) as never,
    )

    const results = await triageBatch(headers)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ message_id: 'msg-1', urgency: 'high' })
    // msg-2 missing from output → fallback
    expect(results[1]).toMatchObject({
      message_id: 'msg-2',
      urgency: 'normal',
      category: 'informational',
      summary: 'Missing message',
    })
  })

  it('handles model output wrapped in code fence', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'Test' })]
    mockCreate.mockResolvedValue(
      modelResponse('```json\n' + JSON.stringify([
        { id: 'msg-1', urgency: 'normal', category: 'informational', summary: 'Test summary' },
      ]) + '\n```') as never,
    )

    const results = await triageBatch(headers)
    expect(results[0]).toMatchObject({ message_id: 'msg-1', urgency: 'normal', summary: 'Test summary' })
  })

  it('uses subject as fallback summary when subject is present', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: 'Board Meeting Agenda' })]
    mockCreate.mockRejectedValue(new Error('timeout'))

    const results = await triageBatch(headers)
    expect(results[0]!.summary).toBe('Board Meeting Agenda')
  })

  it('uses (no subject) as fallback summary when subject is empty', async () => {
    const headers = [makeHeader({ message_id: 'msg-1', subject: '' })]
    mockCreate.mockRejectedValue(new Error('timeout'))

    const results = await triageBatch(headers)
    expect(results[0]!.summary).toBe('(no subject)')
  })
})
