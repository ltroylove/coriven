import Link from 'next/link'
import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import { ALL_TOOL_NAMES } from '@/lib/chat/tools/registry'
import { ToolPermissionsClient } from './tool-permissions-client'
import { BriefingSettingsClient } from './briefing-settings-client'
import { SentinelModeClient } from '@/components/settings/sentinel-mode-client'
import type { ToolName } from '@personal-assistant/types'

// Defaults used as fallback when data is unavailable
const DEFAULT_TIMEZONE = 'America/Chicago'
const DEFAULT_BRIEFING_TIME = '07:00'

async function getToolPermissions(userId: string) {
  const db = createServiceClient()
  const { data } = await db
    .from('tool_permissions')
    .select('tool_name, enabled')
    .eq('user_id', userId)

  const found = data ?? []
  const map = Object.fromEntries(found.map(r => [r.tool_name, r.enabled]))

  return ALL_TOOL_NAMES.map(name => ({
    tool_name: name,
    enabled: map[name] ?? false,
  })) as { tool_name: ToolName; enabled: boolean }[]
}

async function getProfileSettings() {
  // Use auth client (respects RLS) instead of service client for user-facing reads
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { timezone: DEFAULT_TIMEZONE, briefingTime: DEFAULT_BRIEFING_TIME, sentinelMode: 'async' as const }

  const { data, error } = await supabase
    .from('profiles')
    .select('timezone, briefing_time, sentinel_mode')
    .eq('id', user.id)
    .single()

  if (error) {
    console.error('[settings] getProfileSettings failed', error)
    return { timezone: DEFAULT_TIMEZONE, briefingTime: DEFAULT_BRIEFING_TIME, sentinelMode: 'async' as const }
  }

  return {
    timezone: data?.timezone ?? DEFAULT_TIMEZONE,
    briefingTime: data?.briefing_time ?? DEFAULT_BRIEFING_TIME,
    sentinelMode: (data?.sentinel_mode ?? 'async') as 'async' | 'sync',
  }
}

export default async function SettingsPage() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const permissions = user ? await getToolPermissions(user.id) : []
  const profileSettings = await getProfileSettings()

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-white mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-8">Control what the AI assistant can do on your behalf.</p>

      <section className="mb-8">
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Integrations
        </h2>
        <Link
          href="/settings/integrations"
          className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-800 bg-gray-900/60 hover:border-gray-700 hover:bg-gray-900 transition-colors group"
          aria-label="Manage connected accounts and OAuth integrations"
        >
          <div>
            <p className="text-sm font-medium text-gray-200">Connected accounts</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Gmail, Outlook, Google Calendar — manage OAuth connections
            </p>
          </div>
          <span className="text-gray-600 group-hover:text-gray-400 transition-colors" aria-hidden="true">
            &#8250;
          </span>
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Assistant permissions
        </h2>
        <ToolPermissionsClient initial={permissions} />
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Disabled tools are hidden from the assistant entirely. You can toggle them at any time.
          Changes take effect immediately on your next message.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Briefing
        </h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <BriefingSettingsClient
            initialTimezone={profileSettings.timezone}
            initialBriefingTime={profileSettings.briefingTime}
          />
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Your daily briefing summarises active goals, upcoming tasks, and stalled goals.
          It is assembled automatically in the 30-minute window around your chosen time.
        </p>
      </section>

      <section>
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Assistant intelligence
        </h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <SentinelModeClient initialMode={profileSettings.sentinelMode} />
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Controls when conversation context is built. Fast mode has near-zero overhead.
          Always current adds a brief pause before each response while your context is updated.
        </p>
      </section>
    </div>
  )
}
