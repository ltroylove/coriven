// @vitest-environment jsdom
//
// Component tests for HistoryFlyout — Task 9.1.2.4.1 acceptance criteria.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports)
// ---------------------------------------------------------------------------
vi.mock('@/app/actions/chat', () => ({
  listConversations: vi.fn(),
  getChatHistory: vi.fn().mockResolvedValue([]),
}))

vi.mock('lucide-react', () => ({
  MessageSquare: () => null,
  History: () => null,
  Plus: () => null,
}))

import { HistoryFlyout } from '../history-flyout'
import { listConversations } from '@/app/actions/chat'
import {
  ConversationProvider,
  ACTIVE_CONV_KEY,
} from '@/components/providers/conversation-provider'
import { TimezoneProvider } from '@/components/providers/timezone-provider'
import type { ConversationSummary } from '@/app/actions/chat'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListConversations = vi.mocked(listConversations)

function makeConv(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: crypto.randomUUID(),
    title: 'Sample conversation',
    updated_at: new Date().toISOString(),
    pinned_at: null,
    ...overrides,
  }
}

const onClose = vi.fn()

function renderFlyout(convs: ConversationSummary[] = []) {
  mockListConversations.mockResolvedValue(convs)
  return render(
    <TimezoneProvider timezone="America/Chicago">
      <ConversationProvider>
        <HistoryFlyout onClose={onClose} />
      </ConversationProvider>
    </TimezoneProvider>,
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  onClose.mockClear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Render list
// ---------------------------------------------------------------------------
describe('HistoryFlyout — render list', () => {
  it('shows loading skeleton while fetching', () => {
    // Never resolve so we see the loading state
    mockListConversations.mockReturnValue(new Promise(() => {}))
    render(
      <TimezoneProvider timezone="UTC">
        <ConversationProvider>
          <HistoryFlyout onClose={onClose} />
        </ConversationProvider>
      </TimezoneProvider>,
    )
    expect(screen.getByRole('status', { name: /loading conversations/i })).toBeInTheDocument()
  })

  it('renders conversation titles after loading', async () => {
    const convs = [
      makeConv({ title: 'First conversation' }),
      makeConv({ title: 'Second conversation' }),
    ]
    renderFlyout(convs)

    await waitFor(() => {
      expect(screen.getByText('First conversation')).toBeInTheDocument()
      expect(screen.getByText('Second conversation')).toBeInTheDocument()
    })
  })

  it('renders "New conversation" for untitled conversations (null title)', async () => {
    renderFlyout([makeConv({ title: null })])

    await waitFor(() => {
      expect(screen.getByText('New conversation')).toBeInTheDocument()
    })
  })

  it('shows first-run empty state when no conversations exist', async () => {
    renderFlyout([])

    await waitFor(() => {
      expect(screen.getByText(/no conversations yet/i)).toBeInTheDocument()
      expect(screen.getByText(/new chat/i)).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// Filter / search
// ---------------------------------------------------------------------------
describe('HistoryFlyout — search filter', () => {
  it('filters conversations by title as user types', async () => {
    const convs = [
      makeConv({ title: 'Budget planning' }),
      makeConv({ title: 'Grocery list' }),
      makeConv({ title: 'Budget review' }),
    ]
    renderFlyout(convs)

    await waitFor(() => {
      expect(screen.getByText('Budget planning')).toBeInTheDocument()
    })

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'budget' } })

    expect(screen.getByText('Budget planning')).toBeInTheDocument()
    expect(screen.getByText('Budget review')).toBeInTheDocument()
    expect(screen.queryByText('Grocery list')).not.toBeInTheDocument()
  })

  it('shows no-results state when filter has no matches', async () => {
    renderFlyout([makeConv({ title: 'Hello world' })])

    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'xyzzy' } })

    expect(screen.getByText(/no results/i)).toBeInTheDocument()
    expect(screen.queryByText('Hello world')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Select sets active conversation
// ---------------------------------------------------------------------------
describe('HistoryFlyout — select sets active', () => {
  it('calls setActiveConversation and onClose when a conversation is selected', async () => {
    const conv = makeConv({ id: 'selected-conv-id', title: 'My thread' })
    renderFlyout([conv])

    await waitFor(() => {
      expect(screen.getByText('My thread')).toBeInTheDocument()
    })

    await act(async () => {
      screen.getByText('My thread').click()
    })

    // localStorage should have the new active id
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('selected-conv-id')
    // Flyout should close
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('visually indicates the currently active conversation', async () => {
    const conv = makeConv({ id: 'active-conv', title: 'Active thread' })
    // Pre-seed the active conv id in localStorage so the provider picks it up
    localStorage.setItem(ACTIVE_CONV_KEY, 'active-conv')

    renderFlyout([conv])

    await waitFor(() => {
      const option = screen.getByRole('option', { name: /active thread/i })
      expect(option).toHaveAttribute('aria-selected', 'true')
    })
  })
})

// ---------------------------------------------------------------------------
// Esc closes
// ---------------------------------------------------------------------------
describe('HistoryFlyout — keyboard', () => {
  it('closes when Escape is pressed', async () => {
    renderFlyout([makeConv({ title: 'Some chat' })])

    await waitFor(() => {
      expect(screen.getByText('Some chat')).toBeInTheDocument()
    })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked', async () => {
    renderFlyout([])

    // The backdrop is the fixed inset-0 div with aria-hidden
    await waitFor(() => {
      // flyout header should be visible
      expect(screen.getByText('Conversation history')).toBeInTheDocument()
    })

    // Click the backdrop (aria-hidden div)
    const backdrop = document.querySelector('[aria-hidden="true"].fixed.inset-0')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Dialog a11y
// ---------------------------------------------------------------------------
describe('HistoryFlyout — accessibility', () => {
  it('has role="dialog" and aria-modal="true"', async () => {
    renderFlyout([])

    const dialog = screen.getByRole('dialog', { name: /conversation history/i })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })
})
