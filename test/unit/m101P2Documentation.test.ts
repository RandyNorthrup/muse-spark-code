import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('M101 P2 release claims (RVM101P2 F7)', () => {
  it('keeps the P2 entry under Unreleased and names the pending retry binding', () => {
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const unreleased = changelog.split('## [Unreleased]\n', 2)[1]?.split('\n## [', 1)[0]
    const released = changelog.slice(
      changelog.indexOf('\n## [', changelog.indexOf('## [Unreleased]') + 1),
    )
    expect(unreleased).toContain('- M101 lane P2 (Pi/SoL-Pi upstream sync):')
    expect(unreleased).toContain('provider transport binding remains pending')
    expect(released).not.toContain('- M101 lane P2 (Pi/SoL-Pi upstream sync):')
    expect(changelog).not.toContain('quota errors are never retried on any')
  })
})
