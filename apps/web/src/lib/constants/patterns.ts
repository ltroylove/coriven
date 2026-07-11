/**
 * Shared pattern-related constants.
 *
 * Kept in a dedicated module so they can be imported by both the API route layer
 * and the job layer without creating circular dependencies.  Next.js route files
 * must not export arbitrary named exports (only GET, POST, PUT, DELETE, etc.) —
 * this file is the canonical home for constants previously defined there.
 */

/** Frequency cap: do not re-notify the same pattern within this many days. */
export const NOTIFICATION_FREQUENCY_CAP_DAYS = 7
