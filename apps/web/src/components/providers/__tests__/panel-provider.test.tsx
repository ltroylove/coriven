// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { PanelProvider, usePanel, clampWidth } from '../panel-provider'

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------
const mockPush = vi.fn()
let mockPathname = '/tasks'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function TestConsumer({ label }: { label?: string }) {
  const panel = usePanel()
  return (
    <div>
      <span data-testid="surface">{panel.openSurface ?? 'null'}</span>
      <span data-testid="width">{panel.widthPct}</span>
      <button onClick={() => panel.openPanel('tasks')} data-testid="open-tasks">
        open tasks
      </button>
      <button onClick={() => panel.openPanel('goals', { focusId: 'g-1' })} data-testid="open-goals-focus">
        open goals with focus
      </button>
      <button onClick={() => panel.closePanel()} data-testid="close">
        close
      </button>
      <button onClick={() => panel.togglePanel()} data-testid="toggle">
        toggle
      </button>
      <button onClick={() => panel.setWidth(50)} data-testid="set-width">
        set width 50
      </button>
      {label && <span>{label}</span>}
    </div>
  )
}

function renderWithProvider(pathname = '/tasks') {
  mockPathname = pathname
  return render(
    <PanelProvider>
      <TestConsumer />
    </PanelProvider>,
  )
}

// ---------------------------------------------------------------------------
// clampWidth unit tests
// ---------------------------------------------------------------------------
describe('clampWidth', () => {
  it('returns value within 25–60 unchanged', () => {
    expect(clampWidth(38)).toBe(38)
    expect(clampWidth(25)).toBe(25)
    expect(clampWidth(60)).toBe(60)
  })
  it('clamps below 25 to 25', () => {
    expect(clampWidth(0)).toBe(25)
    expect(clampWidth(10)).toBe(25)
    expect(clampWidth(24)).toBe(25)
  })
  it('clamps above 60 to 60', () => {
    expect(clampWidth(61)).toBe(60)
    expect(clampWidth(80)).toBe(60)
    expect(clampWidth(100)).toBe(60)
  })
})

// ---------------------------------------------------------------------------
// PanelProvider — open/close/toggle state
// ---------------------------------------------------------------------------
describe('PanelProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockPathname = '/tasks'
  })

  it('derives openSurface from the URL pathname', () => {
    renderWithProvider('/tasks')
    expect(screen.getByTestId('surface').textContent).toBe('tasks')
  })

  it('openSurface is null for /chat', () => {
    renderWithProvider('/chat')
    expect(screen.getByTestId('surface').textContent).toBe('null')
  })

  it('openSurface is null for unknown route', () => {
    renderWithProvider('/unknown')
    expect(screen.getByTestId('surface').textContent).toBe('null')
  })

  it('closePanel sets openSurface to null without router.push', async () => {
    renderWithProvider('/tasks')
    expect(screen.getByTestId('surface').textContent).toBe('tasks')

    await act(async () => {
      screen.getByTestId('close').click()
    })

    expect(screen.getByTestId('surface').textContent).toBe('null')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('openPanel calls router.push to the surface route', async () => {
    renderWithProvider('/goals')
    await act(async () => {
      screen.getByTestId('open-tasks').click()
    })
    expect(mockPush).toHaveBeenCalledWith('/tasks')
  })

  it('openPanel with focusId appends ?focus= query param', async () => {
    renderWithProvider('/tasks')
    await act(async () => {
      screen.getByTestId('open-goals-focus').click()
    })
    expect(mockPush).toHaveBeenCalledWith('/goals?focus=g-1')
  })

  it('togglePanel closes when open', async () => {
    renderWithProvider('/tasks')
    expect(screen.getByTestId('surface').textContent).toBe('tasks')

    await act(async () => {
      screen.getByTestId('toggle').click()
    })

    expect(screen.getByTestId('surface').textContent).toBe('null')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('togglePanel reopens (clears manual-close) when already closed', async () => {
    renderWithProvider('/tasks')

    // First close
    await act(async () => {
      screen.getByTestId('close').click()
    })
    expect(screen.getByTestId('surface').textContent).toBe('null')

    // Then toggle to reopen
    await act(async () => {
      screen.getByTestId('toggle').click()
    })
    expect(screen.getByTestId('surface').textContent).toBe('tasks')
  })

  it('setWidth persists to localStorage clamped', async () => {
    renderWithProvider('/tasks')
    await act(async () => {
      screen.getByTestId('set-width').click()
    })
    expect(screen.getByTestId('width').textContent).toBe('50')
    expect(localStorage.getItem('panel-width-pct')).toBe('50')
  })

  it('reads persisted width from localStorage on mount', async () => {
    localStorage.setItem('panel-width-pct', '45')
    renderWithProvider('/tasks')
    // wait for useEffect
    await act(async () => {})
    expect(screen.getByTestId('width').textContent).toBe('45')
  })

  it('throws when usePanel used outside provider', () => {
    // suppress React error boundary output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TestConsumer />)).toThrow('usePanel must be used within a PanelProvider')
    spy.mockRestore()
  })
})
