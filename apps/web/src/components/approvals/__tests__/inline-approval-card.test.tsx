// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/approvals', () => ({
  getApproval: vi.fn(),
  approveAction: vi.fn(),
  cancelAction: vi.fn(),
  approveWithModifiedPayload: vi.fn(),
}))

vi.mock('@/components/providers/timezone-provider', () => ({
  useTimezone: () => 'America/Chicago',
}))

vi.mock('@/lib/utils/timezone', () => ({
  formatInTimezone: (_date: string, _tz: string, _opts: unknown) => '2026-07-11',
}))

// lucide-react stubs
vi.mock('lucide-react', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  Zap: () => null,
  CheckCircle2: () => null,
  XCircle: () => null,
  Activity: () => null,
  LayoutDashboard: () => null,
  CheckSquare: () => null,
  Target: () => null,
  Mail: () => null,
  Settings: () => null,
}))

import { InlineApprovalCard } from '../inline-approval-card'
import { getApproval, approveAction, cancelAction } from '@/app/actions/approvals'

const mockGetApproval = vi.mocked(getApproval)
const mockApproveAction = vi.mocked(approveAction)
const mockCancelAction = vi.mocked(cancelAction)

const PENDING_APPROVAL = {
  id: 'approval-1',
  action_type: 'send_email',
  provider: 'gmail',
  payload: { to: 'alice@example.com', subject: 'Hello', body: 'Hi Alice' },
  ai_summary: 'Send an email to Alice',
  status: 'pending',
  created_at: '2026-07-11T10:00:00Z',
}

const RESOLVED_APPROVAL = {
  ...PENDING_APPROVAL,
  status: 'executed',
}

describe('InlineApprovalCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state while fetching', () => {
    // Never resolve the promise
    mockGetApproval.mockReturnValue(new Promise(() => {}))

    render(<InlineApprovalCard approvalId="approval-1" />)

    expect(screen.getByText(/loading approval/i)).toBeInTheDocument()
  })

  it('renders pending card with Approve / Modify / Cancel buttons', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)

    render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument()
    })

    expect(screen.getByText('Modify')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('shows raw payload as primary content (ADR-013)', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)

    render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(screen.getByText(/raw action payload/i)).toBeInTheDocument()
    })

    // Raw payload text is present (preformatted JSON)
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument()
  })

  it('shows AI summary as labeled secondary content (ADR-013)', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)

    render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(screen.getByText(/AI summary/i)).toBeInTheDocument()
    })

    expect(screen.getByText('Send an email to Alice')).toBeInTheDocument()
  })

  it('renders compact resolved state for non-pending status', async () => {
    mockGetApproval.mockResolvedValue(RESOLVED_APPROVAL)

    render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(screen.getByText('executed')).toBeInTheDocument()
    })

    // No action buttons
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
  })

  it('shows error state when getApproval fails', async () => {
    mockGetApproval.mockResolvedValue({ error: 'Approval not found or access denied' })

    render(<InlineApprovalCard approvalId="bad-id" />)

    await waitFor(() => {
      expect(screen.getByText(/not found|access denied/i)).toBeInTheDocument()
    })
  })

  it('calls approveAction when Approve is clicked', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)
    mockApproveAction.mockResolvedValue({})

    const { getByText } = render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(getByText('Approve')).toBeInTheDocument()
    })

    getByText('Approve').click()

    await waitFor(() => {
      expect(mockApproveAction).toHaveBeenCalledWith('approval-1')
    })
  })

  it('calls cancelAction when Cancel is clicked', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)
    mockCancelAction.mockResolvedValue({})

    const { getByText } = render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(getByText('Cancel')).toBeInTheDocument()
    })

    getByText('Cancel').click()

    await waitFor(() => {
      expect(mockCancelAction).toHaveBeenCalledWith('approval-1')
    })
  })

  it('shows action error when approveAction returns error', async () => {
    mockGetApproval.mockResolvedValue(PENDING_APPROVAL)
    mockApproveAction.mockResolvedValue({ error: 'Failed to approve' })

    const { getByText } = render(<InlineApprovalCard approvalId="approval-1" />)

    await waitFor(() => {
      expect(getByText('Approve')).toBeInTheDocument()
    })

    getByText('Approve').click()

    await waitFor(() => {
      expect(screen.getByText('Failed to approve')).toBeInTheDocument()
    })
  })
})

// ---------------------------------------------------------------------------
// parseApprovalId logic — tested indirectly via message.tsx tests
// (the function is not exported; we trust the component tests cover the path)
// ---------------------------------------------------------------------------
