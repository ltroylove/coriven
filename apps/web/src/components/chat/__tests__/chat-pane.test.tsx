// @vitest-environment jsdom
//
// DOM environment is required for React Testing Library.
// The global vitest config uses 'node' (for the API route tests) — this
// file-level pragma overrides it just for this suite without touching the config.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
// @testing-library/jest-dom matchers (toBeInTheDocument, toHaveAttribute, etc.)
// are loaded globally via vitest.setup.ts — no direct import needed here.

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that transitively load
// the mocked modules (vi.mock is hoisted to the top of the file by Vitest).
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/chat', () => ({
  getChatHistory: vi.fn(),
}))

// lucide-react SVG icons are not critical to test behaviour; stub them to
// avoid potential SVG rendering issues in jsdom and keep snapshots clean.
vi.mock('lucide-react', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  Zap: () => null,
  CheckCircle2: () => null,
  XCircle: () => null,
  ArrowUp: () => null,
  Square: () => null,
  Plus: () => null,
  MessageSquare: () => null,
}))

import { ChatPane } from '../chat-pane'
import { ConversationProvider } from '@/components/providers/conversation-provider'
import { getChatHistory } from '@/app/actions/chat'
import type { ChatMessage } from '../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockGetChatHistory = vi.mocked(getChatHistory)

/** Create a minimal ChatMessage fixture. */
function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

/** Three varied messages to cover user + assistant roles. */
function makeThreeMessages(): ChatMessage[] {
  return [
    makeMessage({ role: 'user', content: [{ type: 'text', text: 'First user message' }] }),
    makeMessage({ role: 'assistant', content: [{ type: 'text', text: 'First assistant reply' }] }),
    makeMessage({ role: 'user', content: [{ type: 'text', text: 'Second user message' }] }),
  ]
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom provides localStorage — clear between tests to avoid conv-id bleed.
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatPane — history load', () => {
  // (a) getChatHistory returns 3 messages → message list is populated
  it('renders 3 messages after getChatHistory resolves', async () => {
    const messages = makeThreeMessages()
    mockGetChatHistory.mockResolvedValue(messages)

    render(<ConversationProvider><ChatPane conversationId="conv-test-123" /></ConversationProvider>)

    // Messages appear after the promise resolves.
    await waitFor(() => {
      expect(screen.getByText('First user message')).toBeInTheDocument()
    })

    expect(screen.getByText('First assistant reply')).toBeInTheDocument()
    expect(screen.getByText('Second user message')).toBeInTheDocument()
  })

  // (b) getChatHistory returns [] → empty-state prompt renders
  it('shows the empty-state prompt when getChatHistory returns an empty array', async () => {
    mockGetChatHistory.mockResolvedValue([])

    render(<ConversationProvider><ChatPane conversationId="conv-empty-456" /></ConversationProvider>)

    await waitFor(() => {
      expect(
        screen.getByText(/ask me to create tasks/i),
      ).toBeInTheDocument()
    })
  })

  // (c) loading state visible before resolve, gone after
  it('shows loading indicator before getChatHistory resolves and hides it after', async () => {
    // Use a deferred promise so we can assert on the intermediate loading state.
    let resolveFn!: (value: ChatMessage[]) => void
    const deferred = new Promise<ChatMessage[]>(resolve => {
      resolveFn = resolve
    })
    mockGetChatHistory.mockReturnValue(deferred)

    render(<ConversationProvider><ChatPane conversationId="conv-loading-789" /></ConversationProvider>)

    // Loading indicator must be visible immediately (before resolution).
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByLabelText(/loading conversation history/i)).toBeInTheDocument()

    // Resolve the promise with no messages.
    resolveFn([])

    // Loading indicator must disappear after resolution.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  // (d) aria-live region is present for screen-reader compatibility (WCAG 2.1 AA)
  it('has an aria-live="polite" region on the message container', () => {
    mockGetChatHistory.mockResolvedValue([])

    render(<ConversationProvider><ChatPane conversationId="conv-aria-000" /></ConversationProvider>)

    const liveRegion = screen.getByLabelText('Conversation messages')
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
  })
})

describe('ChatPane — tool-use blocks in history', () => {
  it('renders tool-use block from loaded history message', async () => {
    const toolMessage: ChatMessage = makeMessage({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu-1', name: 'create_task', input: { title: 'Buy milk' } },
        { type: 'tool_result', tool_use_id: 'tu-1', content: 'Task created', is_error: false },
        { type: 'text', text: 'Done — I created the task for you.' },
      ],
    })
    mockGetChatHistory.mockResolvedValue([toolMessage])

    render(<ConversationProvider><ChatPane conversationId="conv-tool-111" /></ConversationProvider>)

    // Tool name appears in the ToolCallCard button label.
    await waitFor(() => {
      expect(screen.getByLabelText(/tool used: create_task/i)).toBeInTheDocument()
    })
  })
})
