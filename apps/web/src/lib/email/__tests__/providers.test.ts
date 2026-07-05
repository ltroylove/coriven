/**
 * Tests for apps/web/src/lib/email/providers.ts
 *
 * Verifies:
 * 1. Gmail header normalization (list + metadata fetch → EmailHeader[])
 * 2. Microsoft Graph header normalization ($filter response → EmailHeader[])
 * 3. Not-connected (token null) → return []
 * 4. Provider API error → log + return []
 * 5. fetchEmailBody returns null when token is null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmailHeader } from '@personal-assistant/types'

// ---------------------------------------------------------------------------
// Mock integrations/nango
// ---------------------------------------------------------------------------

vi.mock('@/lib/integrations/nango', () => ({
  getProviderToken: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { fetchNewMessageHeaders, fetchEmailBody } from '../providers'
import { getProviderToken } from '@/lib/integrations/nango'

const mockGetProviderToken = vi.mocked(getProviderToken)

// ---------------------------------------------------------------------------
// Test data — Gmail shapes
// ---------------------------------------------------------------------------

const GMAIL_LIST_RESPONSE = {
  messages: [
    { id: 'gmail-msg-1', threadId: 'thread-1' },
    { id: 'gmail-msg-2', threadId: 'thread-2' },
  ],
}

function makeGmailMetaResponse(id: string, threadId: string) {
  return {
    id,
    threadId,
    internalDate: '1720000000000', // 2024-07-03T ...
    payload: {
      headers: [
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'Subject', value: `Test subject ${id}` },
        { name: 'Date', value: 'Wed, 03 Jul 2024 00:00:00 +0000' },
      ],
    },
  }
}

// ---------------------------------------------------------------------------
// Test data — Microsoft Graph shapes
// ---------------------------------------------------------------------------

const GRAPH_MESSAGES_RESPONSE = {
  value: [
    {
      id: 'graph-msg-1',
      conversationId: 'conv-1',
      from: { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
      subject: 'Graph Subject 1',
      receivedDateTime: '2024-07-03T10:00:00Z',
    },
    {
      id: 'graph-msg-2',
      conversationId: 'conv-2',
      from: { emailAddress: { address: 'noreply@example.com' } },
      subject: 'Graph Subject 2',
      receivedDateTime: '2024-07-03T09:00:00Z',
    },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  } as Response)
}

function errResponse(status: number, text = 'Error') {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(text),
  } as Response)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchNewMessageHeaders — Gmail', () => {
  beforeEach(() => {
    mockGetProviderToken.mockResolvedValue('fake-token')
    vi.clearAllMocks()
    mockGetProviderToken.mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes Gmail list + metadata into EmailHeader[]', async () => {
    mockFetch
      .mockResolvedValueOnce(okJson(GMAIL_LIST_RESPONSE)) // messages.list
      .mockResolvedValueOnce(okJson(makeGmailMetaResponse('gmail-msg-1', 'thread-1'))) // meta 1
      .mockResolvedValueOnce(okJson(makeGmailMetaResponse('gmail-msg-2', 'thread-2'))) // meta 2

    const headers = await fetchNewMessageHeaders('user-1', 'gmail', '2024-07-03T00:00:00Z')

    expect(headers).toHaveLength(2)

    const h1 = headers[0] as EmailHeader
    expect(h1.message_id).toBe('gmail-msg-1')
    expect(h1.thread_id).toBe('thread-1')
    expect(h1.from_address).toBe('Alice <alice@example.com>')
    expect(h1.subject).toBe('Test subject gmail-msg-1')
    expect(h1.received_at).toBe(new Date(1720000000000).toISOString())
  })

  it('returns [] when token is null (not connected)', async () => {
    mockGetProviderToken.mockResolvedValue(null)
    const headers = await fetchNewMessageHeaders('user-1', 'gmail', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] on Gmail messages.list API error', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(500, 'Internal Server Error'))
    const headers = await fetchNewMessageHeaders('user-1', 'gmail', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
  })

  it('returns [] when messages list is empty', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ messages: [] }))
    const headers = await fetchNewMessageHeaders('user-1', 'gmail', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
  })

  it('returns [] when messages field is absent', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}))
    const headers = await fetchNewMessageHeaders('user-1', 'gmail', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
  })
})

describe('fetchNewMessageHeaders — Outlook (Microsoft Graph)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderToken.mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes Graph /me/messages into EmailHeader[]', async () => {
    mockFetch.mockResolvedValueOnce(okJson(GRAPH_MESSAGES_RESPONSE))

    const headers = await fetchNewMessageHeaders('user-1', 'outlook', '2024-07-03T00:00:00Z')

    expect(headers).toHaveLength(2)

    const h1 = headers[0] as EmailHeader
    expect(h1.message_id).toBe('graph-msg-1')
    expect(h1.thread_id).toBe('conv-1')
    expect(h1.from_address).toBe('Bob <bob@example.com>')
    expect(h1.subject).toBe('Graph Subject 1')
    expect(h1.received_at).toBe('2024-07-03T10:00:00Z')

    // Sender without display name
    const h2 = headers[1] as EmailHeader
    expect(h2.from_address).toBe('noreply@example.com')
  })

  it('returns [] when token is null (not connected)', async () => {
    mockGetProviderToken.mockResolvedValue(null)
    const headers = await fetchNewMessageHeaders('user-1', 'outlook', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns [] on Graph API error', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(401, 'Unauthorized'))
    const headers = await fetchNewMessageHeaders('user-1', 'outlook', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
  })

  it('returns [] when value array is empty', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ value: [] }))
    const headers = await fetchNewMessageHeaders('user-1', 'outlook', '2024-07-03T00:00:00Z')
    expect(headers).toEqual([])
  })
})

describe('fetchEmailBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderToken.mockResolvedValue('fake-token')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when token is null', async () => {
    mockGetProviderToken.mockResolvedValue(null)
    const body = await fetchEmailBody('user-1', 'gmail', 'msg-1')
    expect(body).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null on Gmail body fetch error', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(500))
    const body = await fetchEmailBody('user-1', 'gmail', 'msg-1')
    expect(body).toBeNull()
  })

  it('returns null on Outlook body fetch error', async () => {
    mockFetch.mockResolvedValueOnce(errResponse(404))
    const body = await fetchEmailBody('user-1', 'outlook', 'msg-1')
    expect(body).toBeNull()
  })

  it('extracts plain text from Gmail full message', async () => {
    const plainText = 'Hello from Alice'
    const base64url = Buffer.from(plainText).toString('base64url')
    const gmailFullMsg = {
      id: 'msg-1',
      threadId: 'thread-1',
      internalDate: '1720000000000',
      payload: {
        headers: [
          { name: 'Subject', value: 'Hello' },
          { name: 'From', value: 'alice@example.com' },
        ],
        mimeType: 'text/plain',
        body: { data: base64url },
      },
    }
    mockFetch.mockResolvedValueOnce(okJson(gmailFullMsg))
    const body = await fetchEmailBody('user-1', 'gmail', 'msg-1')
    expect(body).not.toBeNull()
    expect(body!.body_text).toBe(plainText)
    expect(body!.subject).toBe('Hello')
    expect(body!.from).toBe('alice@example.com')
  })

  it('extracts body text from Outlook Graph response', async () => {
    const graphMsg = {
      subject: 'Meeting notes',
      from: { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
      receivedDateTime: '2024-07-03T10:00:00Z',
      body: { contentType: 'text', content: 'Please review the attached notes.' },
    }
    mockFetch.mockResolvedValueOnce(okJson(graphMsg))
    const body = await fetchEmailBody('user-1', 'outlook', 'graph-msg-1')
    expect(body).not.toBeNull()
    expect(body!.body_text).toBe('Please review the attached notes.')
    expect(body!.subject).toBe('Meeting notes')
    expect(body!.from).toBe('Bob <bob@example.com>')
  })
})
