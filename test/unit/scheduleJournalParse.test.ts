// D119 catch burn-down: stored corruption refuses under one fixed
// reason with the parse failure as its cause. The parser fails for
// real below.
import { describe, expect, it } from 'vitest'
import { parseScheduleStoredJson } from '../../src/core/schedules/journal'

describe('stored schedule JSON parse', () => {
  it('reads valid stored text', () => {
    expect(parseScheduleStoredJson('{"revision":1}')).toEqual({ revision: 1 })
  })

  it('refuses malformed text with the parse failure as its cause', () => {
    try {
      parseScheduleStoredJson('{oops')
      expect.unreachable('malformed stored text must refuse')
    } catch (error) {
      if (!(error instanceof Error)) throw new Error('expected a refusal', { cause: error })
      expect(error.message).toBe('scheduleStoredJsonInvalid')
      expect(error.cause).toBeInstanceOf(SyntaxError)
    }
  })
})
