import { describe, it, expect } from 'vitest'
import { computeMomentum, isStale, shouldNudge } from '../momentum'

// ---------------------------------------------------------------------------
// computeMomentum
// Formula: score = (completed - created) / max(created, 1)
//   score > 0.2  → 'improving'
//   score < -0.2 → 'declining'
//   else         → 'stable'
// ---------------------------------------------------------------------------
describe('computeMomentum', () => {
  it('returns improving when score > 0.2 (5 completed, 3 created → score ≈ 0.67)', () => {
    expect(computeMomentum(5, 3)).toBe('improving')
  })

  it('returns declining when score < -0.2 (1 completed, 5 created → score = -0.8)', () => {
    expect(computeMomentum(1, 5)).toBe('declining')
  })

  it('returns stable when score is in the neutral band (4 completed, 5 created → score = -0.2, boundary)', () => {
    // (4 - 5) / max(5, 1) = -0.2 — exactly on boundary, not < -0.2, so 'stable'
    expect(computeMomentum(4, 5)).toBe('stable')
  })

  it('returns stable when both counts are 0 — score = 0/max(0,1) = 0', () => {
    expect(computeMomentum(0, 0)).toBe('stable')
  })

  it('returns improving when completed=1, created=0 — score = 1/max(0,1) = 1 > 0.2', () => {
    expect(computeMomentum(1, 0)).toBe('improving')
  })
})

// ---------------------------------------------------------------------------
// isStale
// A goal is stale if:
//   - lastActivityAt is set AND older than thresholdDays ago, OR
//   - lastActivityAt is null AND createdAt is older than thresholdDays ago
// Brand-new goals (null activity, recent creation) are NOT stale.
// ---------------------------------------------------------------------------
describe('isStale', () => {
  // Null lastActivityAt without createdAt → safe default: not stale
  it('returns false when lastActivityAt is null and no createdAt provided (safe default)', () => {
    expect(isStale(null, 14)).toBe(false)
  })

  // Null lastActivityAt + old createdAt → stale
  it('returns true when lastActivityAt is null and createdAt is 15 days ago', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    expect(isStale(null, 14, fifteenDaysAgo)).toBe(true)
  })

  // Null lastActivityAt + recent createdAt → NOT stale (brand-new goal)
  it('returns false when lastActivityAt is null and createdAt is 2 days ago (brand-new goal)', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    expect(isStale(null, 14, twoDaysAgo)).toBe(false)
  })

  it('returns true when lastActivityAt is 15 days ago (beyond 14-day threshold)', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    expect(isStale(fifteenDaysAgo, 14)).toBe(true)
  })

  it('returns false when lastActivityAt is 13 days ago (within 14-day threshold)', () => {
    const thirteenDaysAgo = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000)
    expect(isStale(thirteenDaysAgo, 14)).toBe(false)
  })

  it('returns false when lastActivityAt is right now', () => {
    expect(isStale(new Date(), 14)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// shouldNudge
// Returns true if lastNudgeAt is null OR older than cooldownDays days ago
// ---------------------------------------------------------------------------
describe('shouldNudge', () => {
  it('returns true when lastNudgeAt is null', () => {
    expect(shouldNudge(null, 7)).toBe(true)
  })

  it('returns false when lastNudgeAt is 3 days ago (within 7-day cooldown)', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    expect(shouldNudge(threeDaysAgo, 7)).toBe(false)
  })

  it('returns true when lastNudgeAt is 8 days ago (beyond 7-day cooldown)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    expect(shouldNudge(eightDaysAgo, 7)).toBe(true)
  })
})
