import Link from 'next/link'
import {
  type EmailMetadataRow,
  type EmailUrgency,
  URGENCY_STYLES,
  formatReceivedAt,
  extractSenderName,
} from '@/lib/email/inbox'

interface EmailRowProps {
  email: EmailMetadataRow
}

function UrgencyBadge({ urgency }: { urgency: EmailUrgency }) {
  const styles = URGENCY_STYLES[urgency]
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles.badge}`}
      aria-label={`Urgency: ${urgency}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} aria-hidden="true" />
      {urgency}
    </span>
  )
}

function ProviderChip({ provider }: { provider: string }) {
  const label = provider === 'gmail' ? 'Gmail' : provider === 'outlook' ? 'Outlook' : provider
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs text-gray-600 bg-gray-900 border border-gray-800">
      {label}
    </span>
  )
}

export function EmailRow({ email }: EmailRowProps) {
  const sender = extractSenderName(email.from_address)
  const receivedStr = formatReceivedAt(email.received_at)
  const isUnread = !email.is_read

  return (
    <Link
      href={`/email/${email.id}`}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 hover:border-gray-700 hover:bg-gray-900/60 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 motion-safe:transition-colors ${
        isUnread ? 'border-gray-700 bg-gray-900' : 'border-gray-800 bg-transparent'
      }`}
      aria-label={`${isUnread ? 'Unread: ' : ''}${email.subject ?? 'No subject'} from ${sender}`}
    >
      {/* Unread dot */}
      <span
        className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${
          isUnread ? 'bg-blue-500' : 'bg-transparent'
        }`}
        aria-hidden="true"
      />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span
            className={`text-sm truncate ${
              isUnread ? 'font-semibold text-white' : 'font-medium text-gray-300'
            }`}
          >
            {sender}
          </span>
          <span className="text-xs text-gray-600 flex-shrink-0">{receivedStr}</span>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-sm truncate ${
              isUnread ? 'text-gray-200' : 'text-gray-400'
            }`}
          >
            {email.subject ?? 'No subject'}
          </span>
        </div>

        {email.ai_summary && (
          <p className="text-xs text-gray-500 line-clamp-1">{email.ai_summary}</p>
        )}
      </div>

      {/* Right-side meta */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1.5 mt-0.5">
        <UrgencyBadge urgency={email.urgency} />
        <ProviderChip provider={email.provider} />
      </div>
    </Link>
  )
}
