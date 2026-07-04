/**
 * Pure helper utilities for the /email inbox UI.
 *
 * All functions are side-effect free and testable without any DB/network access.
 */

import type { Database } from '@/types/supabase'

export type EmailMetadataRow = Database['public']['Tables']['email_metadata']['Row']

export type EmailCategory = Database['public']['Enums']['email_category']
export type EmailUrgency = Database['public']['Enums']['email_urgency']

/** Display labels for each category (human-readable, title-cased). */
export const CATEGORY_LABELS: Record<EmailCategory, string> = {
  important: 'Important',
  action_required: 'Action Required',
  informational: 'Informational',
  promotional: 'Promotional',
  spam: 'Spam',
}

/**
 * Canonical display order for category groups.
 * More urgent categories appear first.
 */
export const CATEGORY_ORDER: EmailCategory[] = [
  'important',
  'action_required',
  'informational',
  'promotional',
  'spam',
]

/**
 * Urgency ordering weight for sorting (lower = more urgent).
 */
const URGENCY_WEIGHT: Record<EmailUrgency, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/**
 * Groups an array of email rows by category, preserving received_at desc order
 * within each group, and returns groups in CATEGORY_ORDER sequence.
 * Rows with a null category are placed in 'informational'.
 */
export function groupByCategory(
  rows: EmailMetadataRow[],
): Array<{ category: EmailCategory; emails: EmailMetadataRow[] }> {
  const buckets = new Map<EmailCategory, EmailMetadataRow[]>(
    CATEGORY_ORDER.map((cat) => [cat, []]),
  )

  for (const row of rows) {
    const cat: EmailCategory = row.category ?? 'informational'
    buckets.get(cat)!.push(row)
  }

  // Sort within each bucket: received_at desc, then urgency asc for ties
  for (const [, emails] of buckets) {
    emails.sort((a, b) => {
      const tA = a.received_at ? new Date(a.received_at).getTime() : 0
      const tB = b.received_at ? new Date(b.received_at).getTime() : 0
      if (tB !== tA) return tB - tA
      return URGENCY_WEIGHT[a.urgency] - URGENCY_WEIGHT[b.urgency]
    })
  }

  return CATEGORY_ORDER.map((category) => ({
    category,
    emails: buckets.get(category)!,
  })).filter(({ emails }) => emails.length > 0)
}

/** Tailwind class bundle for each urgency level. */
export const URGENCY_STYLES: Record<
  EmailUrgency,
  { badge: string; dot: string }
> = {
  critical: {
    badge: 'bg-red-500/20 text-red-400',
    dot: 'bg-red-500',
  },
  high: {
    badge: 'bg-amber-500/20 text-amber-400',
    dot: 'bg-amber-500',
  },
  normal: {
    badge: 'bg-gray-500/20 text-gray-400',
    dot: 'bg-gray-500',
  },
  low: {
    badge: 'bg-gray-800/50 text-gray-600',
    dot: 'bg-gray-700',
  },
}

/**
 * Format a received_at ISO string into a compact, human-friendly string.
 * - Today → "3:42 PM"
 * - This year → "Jun 12"
 * - Older → "Jun 12, 2025"
 */
export function formatReceivedAt(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return ''

  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const isThisYear = date.getFullYear() === now.getFullYear()
  if (isThisYear) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Extracts the display name / address from a raw from_address string.
 * e.g. "Alice Smith <alice@example.com>" → "Alice Smith"
 *      "bob@example.com" → "bob@example.com"
 */
export function extractSenderName(fromAddress: string | null): string {
  if (!fromAddress) return 'Unknown'
  const match = fromAddress.match(/^(.+?)\s*<[^>]+>$/)
  if (match) return match[1].trim()
  return fromAddress.trim()
}
