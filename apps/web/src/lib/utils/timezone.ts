/**
 * Format an ISO timestamp in a specific IANA timezone.
 * Wraps Intl.DateTimeFormat so callers never need to handle the timezone option themselves.
 */
export function formatInTimezone(
  isoString: string,
  timezone: string,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'> = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(d)
}

/**
 * Convert a UTC ISO string to a datetime-local input value ("YYYY-MM-DDTHH:MM")
 * expressed in the given IANA timezone. Used to pre-fill datetime-local inputs
 * so the user sees and edits the time in their configured timezone.
 */
export function utcToLocalDatetime(isoString: string, timezone: string): string {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  // sv-SE formats as "YYYY-MM-DD HH:MM" natively
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(' ', 'T')
}

/**
 * Convert a datetime-local input value ("YYYY-MM-DDTHH:MM") — interpreted as a
 * time in the given IANA timezone — to a UTC ISO string for storage.
 * Uses a single-pass offset correction via Intl; accurate for all non-DST-fold cases.
 */
export function localDatetimeToUtc(localStr: string, timezone: string): string {
  // Treat the input as a naive UTC instant first
  const fakeUtc = new Date(localStr + ':00.000Z')
  if (isNaN(fakeUtc.getTime())) return new Date(localStr).toISOString()
  // Find what clock time the target timezone shows for that naive instant
  const tzStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(fakeUtc)
    .replace(' ', 'T')
  const tzClockMs = new Date(tzStr + '.000Z').getTime()
  // Shift fakeUtc by (desired - tz clock) so the timezone shows the desired time
  return new Date(fakeUtc.getTime() + (fakeUtc.getTime() - tzClockMs)).toISOString()
}

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

  const absDiff = Math.abs(localTotalMinutes - briefingTotalMinutes)
  const diff = Math.min(absDiff, 1440 - absDiff)
  return diff <= windowMinutes
}

/**
 * Returns the current date in YYYY-MM-DD format for the given IANA timezone.
 * Uses the en-CA locale which formats as YYYY-MM-DD natively.
 */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}
