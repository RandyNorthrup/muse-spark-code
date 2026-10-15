import { describe, expect, it } from 'vitest'
import {
  ObservationPack,
  type RecallOutcome,
} from '../../src/core/backends/modelapi/observationPack'
import { retainedHead, retainNote, shellOutcome } from '../../src/core/backends/modelapi/tools'
import {
  OBS_PACK_PAGE_CHARS,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_ELIDED_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../src/shared/constants'

// B3 (limits-output): a clipped tool output stays reachable through
// recall_output. Pure logic through the real modules: text in, kept pages
// and notes out.
function kept(pack: ObservationPack, tool: string) {
  return {
    keep: (fullText: string, name: string): string | undefined => pack.retain(fullText, name),
    tool,
  }
}

function pageText(outcome: RecallOutcome): string {
  expect(outcome.failureReason).toBeUndefined()
  return outcome.output
}

describe('retained clipped outputs', () => {
  it('retains under a recallable id and pages back by offset', () => {
    const pack = new ObservationPack()
    const id = pack.retain('a'.repeat(OBS_PACK_PAGE_CHARS + 10), 'shell')
    expect(id).toBe('retained-1')
    expect(pack.has(id)).toBe(true)
    expect(pack.has('retained-2')).toBe(false)
    const first = pack.recall(JSON.stringify({ id, offset: 0 }))
    expect(pageText(first)).toContain('a'.repeat(100))
    expect(first.output).toContain(`offset ${String(OBS_PACK_PAGE_CHARS)}`)
    const second = pack.recall(JSON.stringify({ id, offset: OBS_PACK_PAGE_CHARS }))
    expect(pageText(second)).toContain('end of output')
    const missing = pack.recall(JSON.stringify({ id: 'retained-9', offset: 0 }))
    expect(missing.failureReason).toBeDefined()
  })

  it('names the id and resume offset in the clip note', () => {
    expect(retainNote('retained-3', 1200)).toBe(
      '[the rest is kept: call recall_output with id "retained-3" and offset 1200 for the rest]',
    )
  })

  it('keeps an elided shell middle with a note that resumes at the elision', () => {
    const pack = new ObservationPack()
    const result = {
      stdout: `s${'x'.repeat(100_000)}e`,
      stderr: '',
      exitCode: 0 as const,
      isTimedOut: false,
      isCancelled: false,
    }
    const outcome = shellOutcome(result, 120_000, TOOL_OUTPUT_MAX_CHARS, false, kept(pack, 'bash'))
    expect(outcome.output).toContain(TOOL_OUTPUT_ELIDED_MARKER)
    const id = 'retained-1'
    expect(outcome.output).toContain(`call recall_output with id "${id}"`)
    expect(outcome.output.endsWith('[exit code 0]')).toBe(false)
    const at = outcome.output.indexOf(TOOL_OUTPUT_ELIDED_MARKER)
    expect(outcome.output).toContain(`offset ${String(at)}`)
    // The kept whole pages back from the note's offset.
    const recalled = pack.recall(JSON.stringify({ id, offset: at }))
    expect(pageText(recalled)).toContain('x'.repeat(100))
  })

  it('leaves a fitting shell result and a storeless clip alone', () => {
    const pack = new ObservationPack()
    const small = {
      stdout: 'ok',
      stderr: '',
      exitCode: 0 as const,
      isTimedOut: false,
      isCancelled: false,
    }
    const outcome = shellOutcome(small, 120_000, TOOL_OUTPUT_MAX_CHARS, false, kept(pack, 'bash'))
    expect(outcome.output).toBe('ok\n[exit code 0]')
    expect(pack.size).toBe(0)
    const keptText = retainedHead(
      'y'.repeat(TOOL_OUTPUT_MAX_CHARS + 5),
      TOOL_OUTPUT_MAX_CHARS,
      undefined,
      'bash',
    )
    expect(keptText.endsWith(TOOL_OUTPUT_CLIP_MARKER)).toBe(true)
    expect(keptText).not.toContain('recall_output')
  })
})
