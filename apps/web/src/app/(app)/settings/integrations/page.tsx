import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { ProviderRow } from '@/components/integrations/provider-row'
import Link from 'next/link'
import type { IntegrationProvider } from '@personal-assistant/types'

// The three user-facing providers shown on this page.
// outlook_calendar piggybacks on the Outlook OAuth connection and is omitted
// from this UI — it shares the same Nango connection as outlook.
const USER_FACING_PROVIDERS: {
  provider: IntegrationProvider
  label: string
  description: string
}[] = [
  {
    provider: 'gmail',
    label: 'Gmail',
    description: 'Read and send email via your Gmail account.',
  },
  {
    provider: 'outlook',
    label: 'Outlook',
    description:
      'Read and send email via your Microsoft Outlook account (includes Outlook Calendar).',
  },
  {
    provider: 'google_calendar',
    label: 'Google Calendar',
    description:
      'Read calendar events and (with approval) create or update them.',
  },
]

export default async function IntegrationsPage() {
  const supabase = await createAuthServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Fetch the user's integration rows (RLS-enforced — only own rows returned).
  // Selecting only non-sensitive display fields; nango_connection_id is excluded
  // from the page payload — it is an internal reference, not needed for display.
  const { data: rows } = user
    ? await supabase
        .from('integrations')
        .select('provider, scopes, connected_at')
        .eq('user_id', user.id)
    : { data: null }

  const integrationMap = new Map(
    (rows ?? []).map((r) => [r.provider, r]),
  )

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2 mb-1">
        <Link
          href="/settings"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          aria-label="Back to Settings"
        >
          Settings
        </Link>
        <span className="text-gray-700" aria-hidden="true">/</span>
        <h1 className="text-2xl font-semibold text-white">Integrations</h1>
      </div>
      <p className="text-sm text-gray-500 mb-8">
        Connect your accounts so Coriven can read and act on your behalf. OAuth
        tokens are managed securely by Nango and never stored in Coriven.
      </p>

      <section aria-label="Provider connections">
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Connected accounts
        </h2>
        <div className="space-y-3">
          {USER_FACING_PROVIDERS.map(({ provider, label, description }) => {
            const row = integrationMap.get(provider)

            return (
              <ProviderRow
                key={provider}
                provider={provider}
                label={label}
                description={description}
                isConnected={!!row}
                connectedAt={row?.connected_at ?? null}
                grantedScopes={row?.scopes ?? []}
              />
            )
          })}
        </div>
      </section>

      <p className="text-xs text-gray-600 mt-6 leading-relaxed">
        Disconnecting revokes Coriven&apos;s access at the provider level. You
        can reconnect at any time. Scopes shown are the minimum required for
        each integration to function.
      </p>
    </div>
  )
}
