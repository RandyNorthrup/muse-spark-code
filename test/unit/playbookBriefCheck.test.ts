// M116 (D212): the recordability check the team runner applies before a
// dispatch start, so one marked-up brief refuses its own task instead of
// failing the whole delegate. It agrees with the render exactly: whatever
// it rejects, recordBrief refuses, and whatever it accepts renders.
import { describe, expect, it } from 'vitest'
import {
  isRecordablePlaybookBrief,
  renderPlaybookBrief,
} from '../../src/core/orchestration/playbookBrief'

const brief = {
  objective: 'Rework the retry helper',
  scope: ['src/team/retry.ts'],
  acceptance: ['own-branch'],
  baseCommit: 'a'.repeat(40),
}

describe('isRecordablePlaybookBrief', () => {
  it('accepts a plain brief and renders it', () => {
    expect(isRecordablePlaybookBrief(brief)).toBe(true)
    expect(renderPlaybookBrief(brief).baseCommit).toBe('a'.repeat(40))
  })

  it('rejects an unfilled template marker anywhere, as the render does', () => {
    for (const marked of [
      { ...brief, objective: 'Rework {{the thing}}' },
      { ...brief, scope: ['src/{{dir}}/retry.ts'] },
      { ...brief, acceptance: ['{{done}}'] },
    ]) {
      expect(isRecordablePlaybookBrief(marked)).toBe(false)
      expect(() => renderPlaybookBrief(marked)).toThrow()
    }
  })

  it('rejects a schema-invalid brief, as the render does', () => {
    const invalid = { ...brief, scope: [] }
    expect(isRecordablePlaybookBrief(invalid)).toBe(false)
    expect(() => renderPlaybookBrief(invalid)).toThrow()
  })
})
