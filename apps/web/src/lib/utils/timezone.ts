/**
 * Format an ISO timestamp in a specific IANA timezone.
 * Returns '—' for invalid dates or unrecognised timezone strings.
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
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: timezone }).format(d)
  } catch (e) {
    if (e instanceof RangeError) return '—'
    throw e
  }
}

/**
 * Convert a UTC ISO string to a datetime-local input value ("YYYY-MM-DDTHH:MM")
 * expressed in the given IANA timezone. Returns '' for invalid dates or timezones.
 */
export function utcToLocalDatetime(isoString: string, timezone: string): string {
  const d = new Date(isoString)
  if (isNaN(d.getTime())) return ''
  try {
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
  } catch (e) {
    if (e instanceof RangeError) return ''
    throw e
  }
}

/**
 * Convert a datetime-local input value ("YYYY-MM-DDTHH:MM") — interpreted as a
 * time in the given IANA timezone — to a UTC ISO string for storage.
 *
 * Uses a two-pass offset correction so DST-transition times (spring-forward gaps,
 * fall-back folds) are handled correctly. Throws for malformed input or invalid
 * timezone strings so callers can surface a meaningful error.
 */
export function localDatetimeToUtc(localStr: string, timezone: string): string {
  const fakeUtc = new Date(localStr + ':00.000Z')
  if (isNaN(fakeUtc.getTime())) throw new Error(`Invalid datetime value: ${localStr}`)

  try {
    const tzFormat = (d: Date) =>
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .format(d)
        .replace(' ', 'T')

    // First pass: correct using the offset observed at the naive UTC instant.
    const tzStr1 = tzFormat(fakeUtc)
    const tzClockMs1 = new Date(tzStr1 + '.000Z').getTime()
    const corrected1 = new Date(fakeUtc.getTime() + (fakeUtc.getTime() - tzClockMs1))

    // Second pass: verify the corrected instant formats back to the input time.
    // A mismatch means we landed on the wrong side of a DST boundary (spring-forward
    // gaps produce a result 1 hour late; fall-back folds are stable on first pass).
    const tzStr2 = tzFormat(corrected1)
    if (tzStr2.slice(0, 16) === localStr.slice(0, 16)) return corrected1.toISOString()

    // Re-apply correction using the offset observed at corrected1.
    const tzClockMs2 = new Date(tzStr2 + '.000Z').getTime()
    return new Date(corrected1.getTime() + (fakeUtc.getTime() - tzClockMs2)).toISOString()
  } catch (e) {
    if (e instanceof RangeError) throw new Error(`Invalid timezone: ${timezone}`)
    throw e
  }
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
