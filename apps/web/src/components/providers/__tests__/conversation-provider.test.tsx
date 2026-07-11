// @vitest-environment jsdom
//
// Unit tests for ConversationProvider — Task 9.1.2.3.1 acceptance criteria.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import {
  ConversationProvider,
  useActiveConversation,
  ACTIVE_CONV_KEY,
} from '../conversation-provider'

// ---------------------------------------------------------------------------
// Test constants (the two legacy keys)
// ---------------------------------------------------------------------------
const LEGACY_PANEL_KEY = 'chat-panel-conversation-id'
const LEGACY_TAB_KEY = 'chat-tab-active-id'

// ---------------------------------------------------------------------------
// Helper: a minimal consumer that reads the context
// ---------------------------------------------------------------------------
function Consumer() {
  const { activeConversationId, newConversation, setActiveConversation } =
    useActiveConversation()
  return (
    <div>
      <span data-testid="active-id">{activeConversationId}</span>
      <button data-testid="new" onClick={newConversation}>
        New
      </button>
      <button
        data-testid="set"
        onClick={() => setActiveConversation('explicit-id-abc')}
      >
        Set
      </button>
    </div>
  )
}

function renderWithProvider() {
  return render(
    <ConversationProvider>
      <Consumer />
    </ConversationProvider>,
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Migration precedence (AC: panel key > tab key > new UUID)
// ---------------------------------------------------------------------------
describe('ConversationProvider — legacy-key migration', () => {
  it('adopts the panel key when both legacy keys are present (panel wins)', async () => {
    localStorage.setItem(LEGACY_PANEL_KEY, 'panel-uuid-aaa')
    localStorage.setItem(LEGACY_TAB_KEY, 'tab-uuid-bbb')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('active-id').textContent).toBe('panel-uuid-aaa')
    })
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('panel-uuid-aaa')
  })

  it('adopts the tab key when only the tab legacy key is present', async () => {
    localStorage.setItem(LEGACY_TAB_KEY, 'tab-uuid-only')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('active-id').textContent).toBe('tab-uuid-only')
    })
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('tab-uuid-only')
  })

  it('generates a new UUID when no legacy keys are present', async () => {
    renderWithProvider()

    await waitFor(() => {
      const id = screen.getByTestId('active-id').textContent ?? ''
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    })
  })

  it('deletes both legacy keys after adopting the panel key', async () => {
    localStorage.setItem(LEGACY_PANEL_KEY, 'panel-uuid-del')
    localStorage.setItem(LEGACY_TAB_KEY, 'tab-uuid-del')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('active-id').textContent).toBe('panel-uuid-del')
    })
    expect(localStorage.getItem(LEGACY_PANEL_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_TAB_KEY)).toBeNull()
  })

  it('deletes both legacy keys after adopting the tab key', async () => {
    localStorage.setItem(LEGACY_TAB_KEY, 'tab-uuid-only')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('active-id').textContent).toBe('tab-uuid-only')
    })
    expect(localStorage.getItem(LEGACY_PANEL_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_TAB_KEY)).toBeNull()
  })

  it('deletes both legacy keys even when neither exists', async () => {
    renderWithProvider()

    await waitFor(() => {
      const id = screen.getByTestId('active-id').textContent ?? ''
      expect(id.length).toBeGreaterThan(0)
    })
    expect(localStorage.getItem(LEGACY_PANEL_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_TAB_KEY)).toBeNull()
  })

  it('does not repeat migration if unified key already set', async () => {
    localStorage.setItem(ACTIVE_CONV_KEY, 'already-migrated-id')
    localStorage.setItem(LEGACY_PANEL_KEY, 'should-not-win')

    renderWithProvider()

    await waitFor(() => {
      expect(screen.getByTestId('active-id').textContent).toBe('already-migrated-id')
    })
  })
})

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
describe('ConversationProvider — state transitions', () => {
  it('newConversation generates a UUID and sets it active', async () => {
    renderWithProvider()

    // Wait for initial mount
    await waitFor(() => {
      const id = screen.getByTestId('active-id').textContent ?? ''
      expect(id.length).toBeGreaterThan(0)
    })

    const before = screen.getByTestId('active-id').textContent

    await act(async () => {
      screen.getByTestId('new').click()
    })

    const after = screen.getByTestId('active-id').textContent
    expect(after).not.toBe(before)
    expect(after).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe(after)
  })

  it('setActiveConversation persists the given id', async () => {
    renderWithProvider()

    await waitFor(() => {
      const id = screen.getByTestId('active-id').textContent ?? ''
      expect(id.length).toBeGreaterThan(0)
    })

    await act(async () => {
      screen.getByTestId('set').click()
    })

    expect(screen.getByTestId('active-id').textContent).toBe('explicit-id-abc')
    expect(localStorage.getItem(ACTIVE_CONV_KEY)).toBe('explicit-id-abc')
  })
})

// ---------------------------------------------------------------------------
// Error guard
// ---------------------------------------------------------------------------
describe('useActiveConversation', () => {
  it('throws when used outside ConversationProvider', () => {
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(
      'useActiveConversation must be used within a ConversationProvider',
    )
    spy.mockRestore()
  })
})
