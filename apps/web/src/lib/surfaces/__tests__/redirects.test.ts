/**
 * Redirect conformance tests — Wave 9.1.3
 *
 * Verifies the five permanent redirects are declared in next.config.ts with
 * correct sources, destinations, and permanent:true flag.
 */

import { describe, it, expect } from 'vitest'
import nextConfig from '../../../../next.config'

describe('next.config.ts permanent redirects', () => {
  it('exports a redirects() function', () => {
    expect(typeof nextConfig.redirects).toBe('function')
  })

  it('has all five C5 permanent redirects', async () => {
    const redirects = await nextConfig.redirects!()

    const map = Object.fromEntries(
      redirects.map((r) => [r.source, r]),
    )

    const five: Array<{ source: string; destination: string }> = [
      { source: '/chat',        destination: '/' },
      { source: '/today',       destination: '/' },
      { source: '/approvals',   destination: '/activity' },
      { source: '/memory',      destination: '/settings/memory' },
      { source: '/constraints', destination: '/settings/constraints' },
    ]

    for (const { source, destination } of five) {
      const entry = map[source]
      expect(entry, `redirect for ${source} must exist`).toBeDefined()
      expect(entry.destination).toBe(destination)
      expect(entry.permanent).toBe(true)
    }
  })

  it('has exactly five redirects (no extras)', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects).toHaveLength(5)
  })
})
