// Approval queue action types (extensible — new types slot in without modifying existing ones)
export type ApprovalActionType =
  | 'send_email'
  | 'create_calendar_event'
  | 'update_calendar_event'

// Provider values (mirrors integration_provider DB enum; text for forward-compat with long-tail)
export type ApprovalProvider =
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'outlook_calendar'

// Status lifecycle:
//   pending → approved | cancelled      (user decision)
//   approved → executed | failed        (Wave 5.3.2 executor)
//   cancelled, executed, failed         (terminal)
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'executed'
  | 'failed'

// ---------------------------------------------------------------------------
// Payload shapes — one per action type; validated at submit and after modify
// ---------------------------------------------------------------------------

export interface SendEmailPayload {
  to: string       // recipient email address
  subject: string  // email subject line
  body: string     // plain-text email body (no HTML)
}

export interface CreateCalendarEventPayload {
  title: string
  start: string    // ISO 8601 datetime
  end: string      // ISO 8601 datetime
  description?: string
  attendees?: string[]  // email addresses
}

export interface UpdateCalendarEventPayload {
  event_id: string
  title?: string
  start?: string
  end?: string
  description?: string
}

export type ApprovalPayload =
  | SendEmailPayload
  | CreateCalendarEventPayload
  | UpdateCalendarEventPayload

// ---------------------------------------------------------------------------
// Delegation chain shape (ADR-013 §Audit Trail)
// ---------------------------------------------------------------------------

export interface AuditDelegation {
  user: string          // user_id
  actor: 'coriven'
  connection: {
    provider: string    // e.g. 'gmail'
    nango_connection_id: string | null
  }
}

// ---------------------------------------------------------------------------
// Domain types matching the DB rows
// ---------------------------------------------------------------------------

export interface ApprovalQueueRow {
  id: string
  user_id: string
  action_type: ApprovalActionType
  provider: ApprovalProvider
  payload: ApprovalPayload
  ai_summary: string | null
  status: ApprovalStatus
  created_at: string
  reviewed_at: string | null
  executed_at: string | null
  error_code: string | null
}

export interface AuditLogRow {
  id: string
  user_id: string
  approval_id: string | null
  action_type: ApprovalActionType
  provider: ApprovalProvider
  status: string
  error_code: string | null
  delegation: AuditDelegation
  created_at: string
}

// ---------------------------------------------------------------------------
// Execution result — returned by executeApprovedAction
// ---------------------------------------------------------------------------

/** Stable error codes returned by executors. */
export type ExecutionErrorCode =
  | 'invalid_state'           // item was not in a state that permits execution
  | 'unknown_provider'        // provider not recognised by router
  | 'token_unavailable'       // Nango returned null — not connected or token revoked
  | 'provider_rejected'       // provider API returned a non-2xx response
  | 'network_error'           // fetch threw (timeout, DNS, etc.)
  | 'executor_error'          // unexpected executor-internal failure
  | 'constraint_blocked'      // a locked behavioral constraint matched the action
  | 'constraint_check_failed' // constraint evaluator threw or timed out (fail-closed)

export interface ExecutionResult {
  ok: boolean
  errorCode?: ExecutionErrorCode
  /** Provider-assigned event ID for calendar creates/updates, if available */
  providerRef?: string
}
