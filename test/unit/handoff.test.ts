import { describe, expect, it } from 'vitest'
import { parseHandoffPrompt } from '../../src/shared/handoff'

describe('/handoff in the prompt (M74)', () => {
  it('reads the goal after the command, trimmed', () => {
    expect(parseHandoffPrompt('/handoff Ship it Friday')).toEqual({ goal: 'Ship it Friday' })
    expect(parseHandoffPrompt('  /handoff   Fix the leak  ')).toEqual({ goal: 'Fix the leak' })
    expect(parseHandoffPrompt('/handoff Fix it\nthen test it')).toEqual({
      goal: 'Fix it\nthen test it',
    })
  })

  it('leaves the goal undefined when none was typed', () => {
    expect(parseHandoffPrompt('/handoff')).toEqual({ goal: undefined })
    expect(parseHandoffPrompt('/handoff   ')).toEqual({ goal: undefined })
  })

  it('is any other text otherwise', () => {
    for (const text of ['/handoffs', '/handoffx y', 'run /handoff', 'handoff x', '/goal y']) {
      expect(parseHandoffPrompt(text), text).toBeUndefined()
    }
  })
})
