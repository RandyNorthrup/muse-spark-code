import { describe, expect, it } from 'vitest'
import { parseGoalPrompt, requiresObjective } from '../../src/shared/goalCommand'

describe('/goal in the prompt (M45)', () => {
  it('reads the TUI verbs', () => {
    expect(parseGoalPrompt('/goal Make the parser tests pass')).toEqual({
      verb: 'set',
      objective: 'Make the parser tests pass',
    })
    expect(parseGoalPrompt('  /goal   pause  ')).toEqual({ verb: 'pause', objective: undefined })
    expect(parseGoalPrompt('/goal resume')).toEqual({ verb: 'resume', objective: undefined })
    expect(parseGoalPrompt('/goal clear')).toEqual({ verb: 'clear', objective: undefined })
    expect(parseGoalPrompt('/goal edit  Ship on Friday ')).toEqual({
      verb: 'edit',
      objective: 'Ship on Friday',
    })
  })

  it('takes a verb only as the whole argument, and keeps line breaks in an objective', () => {
    expect(parseGoalPrompt('/goal pause the build')).toEqual({
      verb: 'set',
      objective: 'pause the build',
    })
    expect(parseGoalPrompt('/goal Fix it\nthen test it')).toEqual({
      verb: 'set',
      objective: 'Fix it\nthen test it',
    })
    expect(parseGoalPrompt('/goal editing the docs')).toEqual({
      verb: 'set',
      objective: 'editing the docs',
    })
  })

  it('leaves a missing objective for the caller to refuse', () => {
    expect(parseGoalPrompt('/goal')).toEqual({ verb: 'set', objective: '' })
    expect(parseGoalPrompt('/goal edit')).toEqual({ verb: 'edit', objective: '' })
    expect(requiresObjective('set')).toBe(true)
    expect(requiresObjective('edit')).toBe(true)
    expect(requiresObjective('clear')).toBe(false)
  })

  it('is any other text otherwise', () => {
    for (const text of ['/goals', '/goalie x', 'set a /goal', 'goal x', '/compact']) {
      expect(parseGoalPrompt(text), text).toBeUndefined()
    }
  })
})
