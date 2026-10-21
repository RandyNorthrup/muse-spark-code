// D119 catch burn-down: only malformed text refuses as not JSON. The
// JSON parser fails for real below.
import { describe, expect, it } from 'vitest'
import { parseTeamJson } from '../../src/core/team/teamConfig'

describe('team.json parse failures', () => {
  it('refuses malformed text as not JSON', () => {
    expect(parseTeamJson('{oops')).toEqual({ ok: false, reason: 'team.json is not JSON' })
  })

  it('still reads an empty object', () => {
    const parsed = parseTeamJson('{}')
    expect(parsed.ok).toBe(true)
  })
})
