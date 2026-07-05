/**
 * Shared email types for Wave 5.2.1.
 * Used by both the provider clients (apps/web/src/lib/email/) and the
 * get_email_thread tool handler.
 */

export type EmailUrgency = 'critical' | 'high' | 'normal' | 'low'

export type EmailCategory =
  | 'important'
  | 'action_required'
  | 'informational'
  | 'promotional'
  | 'spam'

/**
 * Normalized email header — the common shape produced by both Gmail and
 * Microsoft Graph provider clients.  No body content is included here.
 */
export interface EmailHeader {
  /** Provider-native message identifier */
  message_id: string
  /** Provider-native thread/conversation identifier (null if unavailable) */
  thread_id: string | null
  /** Sender address (may be a display-name+address string) */
  from_address: string
  /** Message subject */
  subject: string
  /** UTC receipt timestamp */
  received_at: string
}

/**
 * Per-message output from the Haiku triage batch call.
 */
export interface TriageResult {
  message_id: string
  urgency: EmailUrgency
  category: EmailCategory
  summary: string
}

/**
 * Full email body fetched on demand — never persisted.
 * All content must be framed as untrusted before being shown to a model.
 */
export interface EmailBody {
  subject: string
  from: string
  received_at: string
  /** Plain-text body; HTML stripped */
  body_text: string
}
