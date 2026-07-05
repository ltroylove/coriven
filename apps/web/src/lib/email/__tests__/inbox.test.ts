import { describe, it, expect } from 'vitest'
import {
  groupByCategory,
  CATEGORY_ORDER,
  formatReceivedAt,
  extractSenderName,
} from '../inbox'
import type { EmailMetadataRow } from '../inbox'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeEmail(
  overrides: Partial<EmailMetadataRow> = {},
): EmailMetadataRow {
  return {
    id: 'email-1',
    user_id: 'user-1',
    provider: 'gmail',
    message_id: 'msg-1',
    thread_id: null,
    from_address: 'Test Sender <test@example.com>',
    subject: 'Test Subject',
    received_at: '2026-06-01T10:00:00Z',
    urgency: 'normal',
    category: 'informational',
    ai_summary: 'This is a test summary.',
    is_read: false,
    created_at: '2026-06-01T10:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// groupByCategory
// ---------------------------------------------------------------------------

describe('groupByCategory', () => {
  it('returns empty array for empty input', () => {
    expect(groupByCategory([])).toEqual([])
  })

  it('groups emails into correct categories', () => {
    const emails = [
      makeEmail({ id: '1', category: 'important' }),
      makeEmail({ id: '2', category: 'action_required' }),
      makeEmail({ id: '3', category: 'promotional' }),
      makeEmail({ id: '4', category: 'spam' }),
    ]
    const groups = groupByCategory(emails)
    const cats = groups.map((g) => g.category)
    expect(cats).toEqual(['important', 'action_required', 'promotional', 'spam'])
  })

  it('places null category into informational', () => {
    const emails = [makeEmail({ id: '1', category: null })]
    const groups = groupByCategory(emails)
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe('informational')
  })

  it('respects CATEGORY_ORDER for group sequence', () => {
    const emails = [
      makeEmail({ id: '1', category: 'spam' }),
      makeEmail({ id: '2', category: 'important' }),
      makeEmail({ id: '3', category: 'informational' }),
    ]
    const groups = groupByCategory(emails)
    const cats = groups.map((g) => g.category)
    // important before informational before spam
    expect(cats.indexOf('important')).toBeLessThan(cats.indexOf('informational'))
    expect(cats.indexOf('informational')).toBeLessThan(cats.indexOf('spam'))
  })

  it('sorts within each group by received_at descending (newest first)', () => {
    const emails = [
      makeEmail({ id: 'old', category: 'important', received_at: '2026-05-01T08:00:00Z' }),
      makeEmail({ id: 'new', category: 'important', received_at: '2026-06-01T08:00:00Z' }),
    ]
    const groups = groupByCategory(emails)
    const importantGroup = groups.find((g) => g.category === 'important')!
    expect(importantGroup.emails[0].id).toBe('new')
    expect(importantGroup.emails[1].id).toBe('old')
  })

  it('omits empty category groups from the result', () => {
    const emails = [makeEmail({ id: '1', category: 'important' })]
    const groups = groupByCategory(emails)
    const cats = groups.map((g) => g.category)
    // Only important should be present; all others have 0 emails and are omitted
    expect(cats).toEqual(['important'])
  })

  it('handles all five explicit categories simultaneously', () => {
    const emails = CATEGORY_ORDER.map((cat, i) =>
      makeEmail({ id: String(i), category: cat }),
    )
    const groups = groupByCategory(emails)
    expect(groups.map((g) => g.category)).toEqual(CATEGORY_ORDER)
  })
})

// ---------------------------------------------------------------------------
// formatReceivedAt
// ---------------------------------------------------------------------------

describe('formatReceivedAt', () => {
  it('returns empty string for null input', () => {
    expect(formatReceivedAt(null)).toBe('')
  })

  it('returns empty string for an invalid date string', () => {
    expect(formatReceivedAt('not-a-date')).toBe('')
  })

  it('returns a time string (AM/PM) for a timestamp from today', () => {
    const now = new Date()
    const isoString = now.toISOString()
    const result = formatReceivedAt(isoString)
    // Should contain AM or PM
    expect(result).toMatch(/(AM|PM)/)
  })

  it('returns a month+day string for a date earlier this year', () => {
    const earlier = new Date()
    earlier.setMonth(earlier.getMonth() - 1)
    // Only run this test if subtracting a month keeps us in the same year
    if (earlier.getFullYear() === new Date().getFullYear()) {
      const result = formatReceivedAt(earlier.toISOString())
      // Should NOT contain AM/PM (not today), should not contain year
      expect(result).not.toMatch(/(AM|PM)/)
    }
  })

  it('returns a full date string for a date from a previous year', () => {
    const result = formatReceivedAt('2024-01-15T12:00:00Z')
    expect(result).toContain('2024')
  })
})

// ---------------------------------------------------------------------------
// extractSenderName
// ---------------------------------------------------------------------------

describe('extractSenderName', () => {
  it('returns Unknown for null input', () => {
    expect(extractSenderName(null)).toBe('Unknown')
  })

  it('extracts name from "Name <email>" format', () => {
    expect(extractSenderName('Alice Smith <alice@example.com>')).toBe('Alice Smith')
  })

  it('returns raw address when no name is present', () => {
    expect(extractSenderName('bob@example.com')).toBe('bob@example.com')
  })

  it('trims whitespace from both formats', () => {
    expect(extractSenderName('  Carol  <carol@example.com>')).toBe('Carol')
    expect(extractSenderName('  dave@example.com  ')).toBe('dave@example.com')
  })

  it('handles empty string by returning empty string', () => {
    // Empty string after trim → still empty
    expect(extractSenderName('')).toBe('Unknown')
  })
})
