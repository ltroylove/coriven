import { createAuthServerClient } from '@/lib/supabase/auth-server'
import { createServiceClient } from '@/lib/supabase/server'
import { ALL_TOOL_NAMES } from '@/lib/chat/tools/registry'
import { ToolPermissionsClient } from './tool-permissions-client'
import { BriefingSettingsClient } from './briefing-settings-client'
import type { ToolName } from '@personal-assistant/types'

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

async function getBriefingSettings(userId: string) {
  const db = createServiceClient()
  const { data } = await db
    .from('profiles')
    .select('timezone, briefing_time')
    .eq('id', userId)
    .single()

  return {
    timezone: data?.timezone ?? 'America/Chicago',
    briefingTime: data?.briefing_time ?? '07:00',
  }
}

export default async function SettingsPage() {
  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const permissions = user ? await getToolPermissions(user.id) : []
  const briefingSettings = user ? await getBriefingSettings(user.id) : { timezone: 'America/Chicago', briefingTime: '07:00' }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-white mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-8">Control what the AI assistant can do on your behalf.</p>

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

      <section>
        <h2 className="text-xs font-medium uppercase tracking-widest text-gray-500 mb-3">
          Briefing
        </h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
          <BriefingSettingsClient
            initialTimezone={briefingSettings.timezone}
            initialBriefingTime={briefingSettings.briefingTime}
          />
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Your daily briefing summarises active goals, upcoming tasks, and stalled goals.
          It is assembled automatically in the 30-minute window around your chosen time.
        </p>
      </section>
    </div>
  )
}
