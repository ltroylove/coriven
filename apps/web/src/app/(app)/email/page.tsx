import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { groupByCategory, CATEGORY_LABELS } from '@/lib/email/inbox'
import { EmailRow } from '@/components/email/email-row'
import { FollowUpRow } from '@/components/email/followup-row'
import type { FollowUpCandidate } from '@/components/email/followup-row'

export default async function EmailPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/?next=/email')

  // Check whether user has any email integrations connected
  const { data: integrations } = await supabase
    .from('integrations')
    .select('provider')
    .eq('user_id', user.id)
    .in('provider', ['gmail', 'outlook'])

  const hasEmailProviders = (integrations ?? []).length > 0

  // Fetch follow-up candidates: undismissed, uncleared, oldest-waiting first
  const { data: candidates } = await supabase
    .from('followup_candidates')
    .select('*')
    .eq('user_id', user.id)
    .eq('dismissed', false)
    .is('cleared_at', null)
    .order('last_sent_at', { ascending: true })

  const followUpCandidates: FollowUpCandidate[] = candidates ?? []

  // Fetch up to 100 most recent triaged emails for this user
  const { data: emails, error } = await supabase
    .from('email_metadata')
    .select('*')
    .eq('user_id', user.id)
    .order('received_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[email] metadata fetch failed', error)
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Email</h1>
        </div>
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center max-w-md">
          <p className="text-sm text-gray-400">
            Couldn&apos;t load your inbox. Try refreshing.
          </p>
        </div>
      </div>
    )
  }

  const groups = groupByCategory(emails ?? [])
  const totalCount = emails?.length ?? 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Email</h1>
        <p className="text-sm text-gray-500 mt-0.5">Triaged inbox across your connected accounts</p>
      </div>

      {/* Waiting on replies section — shown only when there are active candidates */}
      {followUpCandidates.length > 0 && (
        <section
          aria-label="Waiting on replies"
          className="mb-8 max-w-3xl"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-amber-500">
              Waiting on replies
            </h2>
            <span className="text-xs text-gray-600">{followUpCandidates.length}</span>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            Threads where you sent the last message more than 3 days ago with no reply.
          </p>
          <div className="space-y-2">
            {followUpCandidates.map((candidate) => (
              <FollowUpRow key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </section>
      )}

      {/* No connected providers */}
      {!hasEmailProviders && (
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center max-w-md">
          <p className="text-sm text-gray-400 mb-3">
            No email accounts connected yet.
          </p>
          <Link
            href="/settings/integrations"
            className="text-sm text-blue-500 hover:text-blue-400 transition-colors"
          >
            Connect Gmail or Outlook in Settings
          </Link>
        </div>
      )}

      {/* Connected but no mail fetched yet */}
      {hasEmailProviders && totalCount === 0 && (
        <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center max-w-md">
          <p className="text-sm text-gray-400 mb-1">No triaged messages yet.</p>
          <p className="text-xs text-gray-600">
            Coriven polls for new mail periodically. Check back soon.
          </p>
        </div>
      )}

      {/* Grouped inbox */}
      {groups.length > 0 && (
        <div className="space-y-8 max-w-3xl">
          {groups.map(({ category, emails: groupEmails }) => (
            <section key={category} aria-label={CATEGORY_LABELS[category]}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-gray-300">
                  {CATEGORY_LABELS[category]}
                </h2>
                <span className="text-xs text-gray-600">{groupEmails.length}</span>
              </div>

              <div className="space-y-1.5">
                {groupEmails.map((email) => (
                  <EmailRow key={email.id} email={email} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
