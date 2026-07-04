import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { fetchEmailBody } from '@/lib/email/providers'
import { markEmailRead } from '@/app/actions/email'
import { URGENCY_STYLES, formatReceivedAt, extractSenderName } from '@/lib/email/inbox'
import type { Database } from '@/types/supabase'

type EmailUrgency = Database['public']['Enums']['email_urgency']

interface Props {
  params: Promise<{ id: string }>
}

export default async function EmailDetailPage({ params }: Props) {
  const { id } = await params

  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/email')

  // Load the metadata row — RLS enforces that the row belongs to this user
  const { data: email, error: metaError } = await supabase
    .from('email_metadata')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (metaError) {
    console.error('[email/detail] metadata fetch error', metaError)
  }

  if (!email) {
    notFound()
  }

  // Mark as read on view load (fire-and-forget — failure is non-fatal)
  if (!email.is_read) {
    await markEmailRead(id)
  }

  // Fetch the full body on demand from the provider
  let bodyText: string | null = null
  let bodyFetchError: string | null = null

  const provider = email.provider
  if (provider === 'gmail' || provider === 'outlook') {
    const result = await fetchEmailBody(user.id, provider, email.message_id)
    if (result) {
      bodyText = result.body_text
    } else {
      bodyFetchError =
        "Couldn't load message body. The provider may be disconnected or the token expired."
    }
  } else {
    bodyFetchError = `Unsupported provider: ${provider}`
  }

  const sender = extractSenderName(email.from_address)
  const receivedStr = formatReceivedAt(email.received_at)
  const urgencyStyles = URGENCY_STYLES[email.urgency as EmailUrgency]

  return (
    <div className="max-w-2xl">
      {/* Back navigation */}
      <div className="mb-6">
        <Link
          href="/email"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Back to Inbox
        </Link>
      </div>

      {/* Message header */}
      <div className="mb-6 space-y-3">
        <h1 className="text-xl font-semibold text-white leading-snug">
          {email.subject ?? 'No subject'}
        </h1>

        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <span className="font-medium text-gray-200">{sender}</span>
          <span className="text-gray-600">&middot;</span>
          <span>{receivedStr}</span>
          <span className="text-gray-600">&middot;</span>
          <span className="capitalize text-gray-500">{email.provider}</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${urgencyStyles.badge}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${urgencyStyles.dot}`}
              aria-hidden="true"
            />
            {email.urgency}
          </span>
          {email.category && (
            <span className="text-xs text-gray-600 capitalize">
              {email.category.replace('_', ' ')}
            </span>
          )}
        </div>

        {email.ai_summary && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
            <p className="text-xs text-gray-400">
              <span className="text-gray-500 font-medium">Summary: </span>
              {email.ai_summary}
            </p>
          </div>
        )}
      </div>

      {/* Security banner — always shown for any external content */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 mb-4">
        <p className="text-xs text-gray-600">
          External content — links are shown as text and never followed automatically.
        </p>
      </div>

      {/* Body area */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        {bodyFetchError ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-400">{bodyFetchError}</p>
            {email.ai_summary && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Stored summary
                </p>
                <p className="text-sm text-gray-300">{email.ai_summary}</p>
              </div>
            )}
            <div className="pt-2">
              <Link
                href="/settings/integrations"
                className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
              >
                Reconnect your email account in Settings
              </Link>
            </div>
          </div>
        ) : bodyText ? (
          /*
           * SECURITY: rendered as plain text only.
           * - No raw HTML injection — body text is placed as React text children of <pre>
           * - No markdown rendering
           * - Whitespace preserved with CSS
           * - URLs display as inert text — no <a> tags, no href
           * - Images are never fetched
           */
          <pre className="text-sm text-gray-200 whitespace-pre-wrap break-words font-sans leading-relaxed">
            {bodyText}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">No message body available.</p>
        )}
      </div>
    </div>
  )
}
