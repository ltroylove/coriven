'use client'

import { useState } from 'react'
import { updateBriefingSettings, ALLOWED_TIMEZONES } from '@/app/actions/profile'

interface BriefingSettingsClientProps {
  initialTimezone: string
  initialBriefingTime: string
}

export function BriefingSettingsClient({ initialTimezone, initialBriefingTime }: BriefingSettingsClientProps) {
  const [timezone, setTimezone] = useState(initialTimezone)
  const [briefingTime, setBriefingTime] = useState(initialBriefingTime)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)

    const result = await updateBriefingSettings(timezone, briefingTime)

    if (!result.success) {
      setError(result.error ?? 'Failed to save settings.')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }

    setSaving(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="timezone" className="text-sm font-medium text-gray-300">
          Timezone
        </label>
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={e => setTimezone(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent"
        >
          {ALLOWED_TIMEZONES.map(tz => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="briefingTime" className="text-sm font-medium text-gray-300">
          Daily briefing time
        </label>
        <input
          id="briefingTime"
          name="briefingTime"
          type="time"
          value={briefingTime}
          onChange={e => setBriefingTime(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-transparent w-36"
        />
        <p className="text-xs text-gray-500">
          Your briefing is generated in a 30-minute window around this time.
        </p>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-sm font-medium text-white transition-colors"
      >
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save briefing settings'}
      </button>
    </form>
  )
}
