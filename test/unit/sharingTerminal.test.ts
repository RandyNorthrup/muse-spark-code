// Terminal sharing answers and flags through the real modules, with data
// passed in: y/yes confirms in any case, and --json is parsed everywhere.
import { describe, expect, it } from 'vitest'
import { parseSharingArgs } from '../../src/runtime/sharing/args'
import { isAffirmativeAnswer } from '../../src/runtime/sharing/sharingEntry'

describe('terminal sharing answers', () => {
  it.each(['y', 'Y', 'yes', 'YES', 'Yes', ' y ', 'yes\n'])('confirms on %j', (answer) => {
    expect(isAffirmativeAnswer(answer)).toBe(true)
  })
  it.each(['n', 'N', 'no', '', 'yep', undefined])('declines on %j', (answer) => {
    expect(isAffirmativeAnswer(answer)).toBe(false)
  })
})

describe('sharing --json flag', () => {
  it('defaults off and parses on for every share/prompts command', () => {
    expect(parseSharingArgs(['share', 'chat', 's1'])).toMatchObject({ json: false })
    expect(parseSharingArgs(['share', 'chat', 's1', '--json'])).toMatchObject({ json: true })
    expect(parseSharingArgs(['prompts', 'list', '--json'])).toMatchObject({ json: true })
    expect(parseSharingArgs(['prompts', 'list'])).toMatchObject({ json: false })
    expect(parseSharingArgs(['prompts', 'use', 'p1', '--json'])).toMatchObject({ json: true })
  })
})
