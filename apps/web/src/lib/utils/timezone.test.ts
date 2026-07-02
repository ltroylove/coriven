import { describe, it, expect } from 'vitest'
import { isInBriefingWindow } from './timezone'

// ---------------------------------------------------------------------------
// isInBriefingWindow
// Returns true when `now` is within `windowMinutes` of the user's briefing
// time in their local timezone.
// ---------------------------------------------------------------------------

describe('isInBriefingWindow', () => {
  // -------------------------------------------------------------------------
  // Case 1: America/Chicago, briefingTime '07:00', 7:15 local → in window
  // UTC offset: CDT = UTC-5, CST = UTC-6
  // Use a known CDT date: 2026-06-15 (summer, CDT = UTC-5)
  // 7:15 CDT = 12:15 UTC
  // -------------------------------------------------------------------------
  it('returns true when now is 7:15 local in America/Chicago with briefing at 07:00 (within 30 min)', () => {
    // 2026-06-15 12:15:00 UTC = 07:15 CDT
    const now = new Date('2026-06-15T12:15:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 2: Same timezone, now = 9:00 local → out of window (120 min diff)
  // 9:00 CDT = 14:00 UTC
  // -------------------------------------------------------------------------
  it('returns false when now is 9:00 local in America/Chicago with briefing at 07:00 (120 min apart)', () => {
    // 2026-06-15 14:00:00 UTC = 09:00 CDT
    const now = new Date('2026-06-15T14:00:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Case 3: Europe/London (BST = UTC+1 in summer), briefingTime '07:00'
  // now = 06:00 UTC = 07:00 BST → in window (diff = 0)
  // Use 2026-06-15 which is summer time (BST)
  // -------------------------------------------------------------------------
  it('returns true when now is 06:00 UTC (= 07:00 BST) with Europe/London briefing at 07:00', () => {
    const now = new Date('2026-06-15T06:00:00.000Z')
    expect(isInBriefingWindow('Europe/London', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 4: Boundary — exactly 30 min before briefingTime → in window
  // America/Chicago CDT: 06:30 CDT = 11:30 UTC; briefing = 07:00, diff = 30 → in
  // -------------------------------------------------------------------------
  it('returns true at exactly the 30-minute boundary before briefing time', () => {
    // 2026-06-15 11:30:00 UTC = 06:30 CDT (30 min before 07:00)
    const now = new Date('2026-06-15T11:30:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 5: Boundary — 31 min before briefingTime → out of window
  // 06:29 CDT = 11:29 UTC; briefing = 07:00, diff = 31 → out
  // -------------------------------------------------------------------------
  it('returns false at 31 minutes before briefing time', () => {
    // 2026-06-15 11:29:00 UTC = 06:29 CDT (31 min before 07:00)
    const now = new Date('2026-06-15T11:29:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Case 6: DST spring-forward — America/Chicago 2025-03-09
  // Before spring forward (02:00 → 03:00 CST→CDT):
  // At 01:59 CST (UTC-6), it's 07:59 UTC. After spring-forward it becomes CDT (UTC-5).
  // Test: 2025-03-09T13:00:00Z = 08:00 CDT (spring forward happened at 2am CST = 8am UTC)
  // Use a time post-spring-forward: 2025-03-09T12:00:00Z = 07:00 CDT → in window
  // -------------------------------------------------------------------------
  it('handles DST spring-forward in America/Chicago (2025-03-09, 07:00 CDT post-spring-forward)', () => {
    // On 2025-03-09, clocks spring forward at 2:00 AM CST → 3:00 AM CDT
    // 2025-03-09T12:00:00Z = 07:00 CDT (UTC-5, post spring-forward)
    const now = new Date('2025-03-09T12:00:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 7: UTC timezone — explicit UTC offset check
  // -------------------------------------------------------------------------
  it('works correctly with UTC timezone', () => {
    // 2026-06-15 07:00:00 UTC = 07:00 UTC (diff = 0)
    const now = new Date('2026-06-15T07:00:00.000Z')
    expect(isInBriefingWindow('UTC', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 8: 30 min AFTER briefing time → in window (diff = 30)
  // -------------------------------------------------------------------------
  it('returns true at exactly 30 minutes after briefing time', () => {
    // 2026-06-15 12:30:00 UTC = 07:30 CDT (30 min after 07:00)
    const now = new Date('2026-06-15T12:30:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Case 9: 31 min AFTER briefing time → out of window
  // -------------------------------------------------------------------------
  it('returns false at 31 minutes after briefing time', () => {
    // 2026-06-15 12:31:00 UTC = 07:31 CDT (31 min after 07:00)
    const now = new Date('2026-06-15T12:31:00.000Z')
    expect(isInBriefingWindow('America/Chicago', '07:00', now, 30)).toBe(false)
  })
})
