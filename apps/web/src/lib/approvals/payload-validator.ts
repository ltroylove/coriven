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

function validateSendEmail(payload: Record<string, unknown>): ValidationResult {
  const errors: string[] = []
  if (!payload.to || typeof payload.to !== 'string' || !payload.to.trim()) {
    errors.push('send_email: "to" (recipient email) is required')
  }
  if (!payload.subject || typeof payload.subject !== 'string' || !payload.subject.trim()) {
    errors.push('send_email: "subject" is required')
  }
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
