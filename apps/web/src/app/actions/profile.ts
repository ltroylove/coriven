'use server'

import { revalidatePath } from 'next/cache'
import { createAuthServerClient } from '@/lib/supabase/auth-server'

// ---------------------------------------------------------------------------
// Allowed IANA timezones — curated list for the settings UI
// ---------------------------------------------------------------------------

export const ALLOWED_TIMEZONES: readonly string[] = [
  // United States
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Adak',
  'Pacific/Honolulu',
  // Canada
  'America/Toronto',
  'America/Vancouver',
  // UTC
  'UTC',
  // Europe
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Helsinki',
  // Asia
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  // Australia / Pacific
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
] as const

// ---------------------------------------------------------------------------
// updateBriefingSettings Server Action
// ---------------------------------------------------------------------------

export async function updateBriefingSettings(
  timezone: string,
  briefingTime: string,
): Promise<{ success: boolean; error?: string }> {
  // Validate timezone
  if (!ALLOWED_TIMEZONES.includes(timezone)) {
    return { success: false, error: 'Invalid timezone selection.' }
  }

  // Validate briefingTime format HH:MM (00:00–23:59 only)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(briefingTime)) {
    return { success: false, error: 'Invalid briefing time format. Expected HH:MM.' }
  }

  const supabase = await createAuthServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Unauthorized.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ timezone, briefing_time: briefingTime })
    .eq('id', user.id)

  if (error) {
    console.error('[profile] updateBriefingSettings failed', error)
    return { success: false, error: 'Failed to save settings.' }
  }

  revalidatePath('/settings')
  return { success: true }
}
