/**
 * Payload validation for each approval action type.
 *
 * Pure functions — no side effects, no DB calls.
 * The same validators run at submit time and again after any user modification.
 * New action types add their own schema without modifying existing ones (open/closed).
 */

import type {
  ApprovalActionType,
  SendEmailPayload,
  CreateCalendarEventPayload,
  UpdateCalendarEventPayload,
  ApprovalPayload,
} from '@personal-assistant/types'

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

const KNOWN_ACTION_TYPES: ReadonlySet<string> = new Set([
  'send_email',
  'create_calendar_event',
  'update_calendar_event',
])

// ---------------------------------------------------------------------------
// Per-action validators
// ---------------------------------------------------------------------------

/**
 * RFC-5322-ish email address regex.
 * Accepts the vast majority of real addresses; rejects obviously invalid ones.
 * Does NOT attempt full RFC 5321 compliance — a simple heuristic is sufficient
 * here because the provider will ultimately validate deliverability.
 */
const EMAIL_REGEX = /^[^\s@<>()[\]\\,;:]+@[^\s@<>()[\]\\,;:]+\.[^\s@<>()[\]\\,;:]{2,}$/

/**
 * CRLF injection guard for email header fields (to, subject).
 *
 * HTTP header injection and RFC 2822 header injection both require a CR or LF
 * byte to start a new header line. The body is exempt — newlines are normal
 * content there.
 *
 * Returns true if the string contains \r or \n.
 */
function hasCRLF(value: string): boolean {
  return /[\r\n]/.test(value)
}

function validateSendEmail(payload: Record<string, unknown>): ValidationResult {
  const errors: string[] = []

  // --- "to" field ---
  if (!payload.to || typeof payload.to !== 'string' || !payload.to.trim()) {
    errors.push('send_email: "to" (recipient email) is required')
  } else {
    // H-1: CRLF injection guard
    if (hasCRLF(payload.to)) {
      errors.push('send_email: "to" must not contain CR or LF characters (CRLF injection)')
    }
    // L-1: basic email format validation
    if (!EMAIL_REGEX.test(payload.to.trim())) {
      errors.push('send_email: "to" must be a valid email address')
    }
  }

  // --- "subject" field ---
  if (!payload.subject || typeof payload.subject !== 'string' || !payload.subject.trim()) {
    errors.push('send_email: "subject" is required')
  } else {
    // H-1: CRLF injection guard (body is exempt — newlines are normal there)
    if (hasCRLF(payload.subject)) {
      errors.push('send_email: "subject" must not contain CR or LF characters (CRLF injection)')
    }
  }

  // --- "body" field — newlines are intentional content; no CRLF check here ---
  if (!payload.body || typeof payload.body !== 'string' || !payload.body.trim()) {
    errors.push('send_email: "body" is required')
  }

  return { valid: errors.length === 0, errors }
}

function validateCreateCalendarEvent(payload: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  if (!payload.title || typeof payload.title !== 'string' || !payload.title.trim()) {
    errors.push('create_calendar_event: "title" is required')
  }
  if (!payload.start || typeof payload.start !== 'string' || !payload.start.trim()) {
    errors.push('create_calendar_event: "start" (ISO 8601 datetime) is required')
  }
  if (!payload.end || typeof payload.end !== 'string' || !payload.end.trim()) {
    errors.push('create_calendar_event: "end" (ISO 8601 datetime) is required')
  }
  return { valid: errors.length === 0, errors }
}

function validateUpdateCalendarEvent(payload: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  if (!payload.event_id || typeof payload.event_id !== 'string' || !payload.event_id.trim()) {
    errors.push('update_calendar_event: "event_id" is required')
  }
  const hasAtLeastOneUpdateField =
    'title' in payload || 'start' in payload || 'end' in payload || 'description' in payload
  if (!hasAtLeastOneUpdateField) {
    errors.push('update_calendar_event: at least one field to update (title, start, end, description) is required')
  }
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate an action type + raw payload from the tool input or user modification.
 * Returns { valid: true } on success, or { valid: false, errors: [...] } with human-readable messages.
 */
export function validatePayload(
  actionType: string,
  payload: unknown,
): ValidationResult {
  if (!KNOWN_ACTION_TYPES.has(actionType)) {
    return {
      valid: false,
      errors: [`Unknown action type: "${actionType}". Supported types: ${[...KNOWN_ACTION_TYPES].join(', ')}`],
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be a non-null object'] }
  }

  const p = payload as Record<string, unknown>

  switch (actionType as ApprovalActionType) {
    case 'send_email':
      return validateSendEmail(p)
    case 'create_calendar_event':
      return validateCreateCalendarEvent(p)
    case 'update_calendar_event':
      return validateUpdateCalendarEvent(p)
    default:
      // TypeScript exhaustiveness guard — should never reach here
      return { valid: false, errors: [`Unhandled action type: "${actionType}"`] }
  }
}

/**
 * Type-narrow a validated payload to the concrete action payload type.
 * Only call this after validatePayload returns { valid: true }.
 */
export function castPayload(actionType: ApprovalActionType, payload: Record<string, unknown>): ApprovalPayload {
  switch (actionType) {
    case 'send_email':
      return payload as unknown as SendEmailPayload
    case 'create_calendar_event':
      return payload as unknown as CreateCalendarEventPayload
    case 'update_calendar_event':
      return payload as unknown as UpdateCalendarEventPayload
  }
}
