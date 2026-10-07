import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('M101 P2 release claims (RVM101P2 F7)', () => {
  it('separates pending provider retry binding from the shipped P2 improvements', () => {
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const unreleased = changelog.split('## [Unreleased]\n', 2)[1]?.split('\n## [', 1)[0]
    const released = changelog.split('## [0.15.0]', 2)[1]?.split('\n## [', 1)[0]
    expect(unreleased?.replaceAll(/\s+/g, ' ')).toContain(
      'Provider-specific retry-table binding remains pending for non-Meta transports',
    )
    expect(unreleased).toContain('does not certify endpoint quota refusal')
    expect(released).toContain('coalesced session saves')
    expect(released).not.toContain('provider transport binding remains pending')
    expect(changelog).not.toContain('quota errors are never retried on any')
  })
})
