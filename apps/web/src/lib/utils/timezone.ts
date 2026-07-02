/**
 * Returns true if `now` falls within `windowMinutes` of the user's configured
 * briefing time in their local timezone.
 */
export function isInBriefingWindow(
  timezone: string,
  briefingTime: string, // "HH:MM"
  now: Date,
  windowMinutes: number,
): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const localHour = parseInt(parts.find(p => p.type === 'hour')!.value)
  const localMinute = parseInt(parts.find(p => p.type === 'minute')!.value)
  const localTotalMinutes = localHour * 60 + localMinute

  const [bHour, bMinute] = briefingTime.split(':').map(Number)
  const briefingTotalMinutes = bHour * 60 + bMinute

  const diff = Math.abs(localTotalMinutes - briefingTotalMinutes)
  return diff <= windowMinutes
}

/**
 * Returns the current date in YYYY-MM-DD format for the given IANA timezone.
 * Uses the en-CA locale which formats as YYYY-MM-DD natively.
 */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}
