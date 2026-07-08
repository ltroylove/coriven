/**
 * Types for Wave 7.1.1 — Pattern Detection
 */

/** The four supported pattern types produced by the nightly detection job. */
export type PatternType = 'gym_days' | 'weekly_review_time' | 'stale_goal' | 'follow_up_needed'

/** A single detected behavioral pattern row. */
export interface DetectedPattern {
  id: string
  user_id: string
  pattern_type: PatternType
  description: string
  last_detected_at: string
  last_notified_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Return value from `runPatternDetection`. */
export interface PatternDetectionResult {
  userId: string
  patternsWritten: number
  patternsDeactivated: number
}

/** Summary returned by the cron endpoint after processing all users. */
export interface PatternDetectionCronSummary {
  usersProcessed: number
  patternsWritten: number
  patternsDeactivated: number
}
