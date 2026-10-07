import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('M96 approved plan and change record', () => {
  it('retains the round-4 safety decisions when lanes 0 and R are merged', () => {
    const plan = readFileSync('PLAN.md', 'utf8').replaceAll(/\s+/gu, ' ')
    for (const decision of [
      'Round 4 (2026-10-04) answers Codex’s third review',
      "On Muse Code, team workers never use the conversation's `muse serve`",
      "to the entry's model and reads the current value back",
      'shutdown, and the retirement of every descendant are not the same. Only the last retires an attempt',
      'On macOS, and on Linux without a user scope, a detached grandchild could still write',
      'The old task keeps its id, its copy, its branch and its journal row, untouched.',
    ]) {
      expect(plan.replaceAll("'", '’')).toContain(decision.replaceAll("'", '’'))
    }
  })

  it('documents both shipped team lanes in 0.15.0', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    const released = changelog.split('## [0.15.0]', 2)[1]?.split('\n## [', 1)[0] ?? ''
    expect(released.toLowerCase()).toContain('agent roles')
    expect(released.toLowerCase()).toContain('teams')
  })
})
