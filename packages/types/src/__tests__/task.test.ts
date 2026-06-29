import { describe, it, expect } from 'vitest'
import { getNextOccurrence } from '../task'

// All remind_at values are fixed noon UTC on known days to avoid DST ambiguity.
// 2026-06-29 is a Monday. We use this as the baseline weekday.

const noon = 'T12:00:00.000Z'

describe('getNextOccurrence', () => {
  describe("recurrence_type 'none'", () => {
    it('returns null', () => {
      expect(
        getNextOccurrence({
          remind_at: `2026-06-29${noon}`,
          recurrence_type: 'none',
          recurrence_end_at: null,
        }),
      ).toBeNull()
    })

    it('returns null even when recurrence_end_at is set', () => {
      expect(
        getNextOccurrence({
          remind_at: `2026-06-29${noon}`,
          recurrence_type: 'none',
          recurrence_end_at: '2099-01-01T00:00:00.000Z',
        }),
      ).toBeNull()
    })
  })

  describe("recurrence_type 'daily'", () => {
    it('returns the next day', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`, // Monday
        recurrence_type: 'daily',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      // 2026-06-30 at same time
      const expected = new Date(`2026-06-30${noon}`)
      expect(result!.toISOString()).toBe(expected.toISOString())
    })

    it('returns null when next date is past recurrence_end_at', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`,
        recurrence_type: 'daily',
        recurrence_end_at: `2026-06-29${noon}`, // end_at is same as remind_at — next would be June 30, which is past
      })
      expect(result).toBeNull()
    })

    it('returns a date when next date is exactly at recurrence_end_at boundary (inclusive)', () => {
      // next = 2026-06-30T12:00Z, end_at = 2026-06-30T12:00Z — they are equal so NOT > end_at
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`,
        recurrence_type: 'daily',
        recurrence_end_at: `2026-06-30${noon}`,
      })
      expect(result).not.toBeNull()
    })
  })

  describe("recurrence_type 'weekdays'", () => {
    it('Monday -> Tuesday (no skipping needed)', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`, // Monday
        recurrence_type: 'weekdays',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      const expected = new Date(`2026-06-30${noon}`) // Tuesday
      expect(result!.toISOString()).toBe(expected.toISOString())
    })

    it('Thursday -> Friday (no skipping)', () => {
      const result = getNextOccurrence({
        remind_at: `2026-07-02${noon}`, // Thursday
        recurrence_type: 'weekdays',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      const expected = new Date(`2026-07-03${noon}`) // Friday
      expect(result!.toISOString()).toBe(expected.toISOString())
    })

    it('Friday -> Monday (skips Saturday and Sunday)', () => {
      const result = getNextOccurrence({
        remind_at: `2026-07-03${noon}`, // Friday
        recurrence_type: 'weekdays',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      const expected = new Date(`2026-07-06${noon}`) // Monday
      expect(result!.toISOString()).toBe(expected.toISOString())
    })

    it('returns null when next weekday is past recurrence_end_at', () => {
      // Friday -> Monday, but end_at is Saturday — Monday is past end
      const result = getNextOccurrence({
        remind_at: `2026-07-03${noon}`, // Friday
        recurrence_type: 'weekdays',
        recurrence_end_at: `2026-07-04${noon}`, // Saturday (next weekday is Mon Jul 6)
      })
      expect(result).toBeNull()
    })
  })

  describe("recurrence_type 'weekly'", () => {
    it('returns 7 days later', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`, // Monday
        recurrence_type: 'weekly',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      const expected = new Date(`2026-07-06${noon}`) // next Monday
      expect(result!.toISOString()).toBe(expected.toISOString())
    })

    it('returns null when 7 days out is past recurrence_end_at', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`,
        recurrence_type: 'weekly',
        recurrence_end_at: `2026-07-05${noon}`, // one day before next occurrence
      })
      expect(result).toBeNull()
    })
  })

  describe("recurrence_type 'monthly'", () => {
    it('returns one month later on the same day', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-15${noon}`,
        recurrence_type: 'monthly',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      // setMonth(5+1) → July 15
      expect(result!.getUTCMonth()).toBe(6) // July (0-indexed)
      expect(result!.getUTCDate()).toBe(15)
    })

    it('returns null when next month is past recurrence_end_at', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-15${noon}`,
        recurrence_type: 'monthly',
        recurrence_end_at: `2026-06-30${noon}`, // before July 15
      })
      expect(result).toBeNull()
    })
  })

  describe("recurrence_type 'yearly'", () => {
    it('returns one year later', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-15${noon}`,
        recurrence_type: 'yearly',
        recurrence_end_at: null,
      })
      expect(result).not.toBeNull()
      expect(result!.getUTCFullYear()).toBe(2027)
      expect(result!.getUTCMonth()).toBe(5) // June
      expect(result!.getUTCDate()).toBe(15)
    })

    it('returns null when next year is past recurrence_end_at', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-15${noon}`,
        recurrence_type: 'yearly',
        recurrence_end_at: `2026-12-31${noon}`, // before June 2027
      })
      expect(result).toBeNull()
    })
  })

  describe('recurrence_end_at boundary', () => {
    it('returns null when next occurrence is strictly after recurrence_end_at', () => {
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`,
        recurrence_type: 'daily',
        recurrence_end_at: `2026-06-29T11:00:00.000Z`, // before the next occurrence
      })
      expect(result).toBeNull()
    })

    it('returns a value when next occurrence equals recurrence_end_at', () => {
      const nextDay = new Date(`2026-06-29${noon}`)
      nextDay.setDate(nextDay.getDate() + 1)
      const result = getNextOccurrence({
        remind_at: `2026-06-29${noon}`,
        recurrence_type: 'daily',
        recurrence_end_at: nextDay.toISOString(),
      })
      expect(result).not.toBeNull()
    })
  })
})
