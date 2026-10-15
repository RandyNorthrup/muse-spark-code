import { describe, expect, it } from 'vitest'
import {
  judgeRetainedRecall,
  ObservationPack,
  type RecallAuthority,
  type RecallOutcome,
  type RetainedOrigin,
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
const CURRENT_REVISION = 'rev-current'

function currentAuthority(overrides?: Partial<RecallAuthority>): RecallAuthority {
  return {
    revision: CURRENT_REVISION,
    trusted: true,
    isDenied: () => false,
    extraRoots: [],
    ...overrides,
  }
}

/** The host's recall fence, bound to one authority: the real judge. */
function fence(authority: RecallAuthority) {
  return (origin: RetainedOrigin): ReturnType<typeof judgeRetainedRecall> =>
    judgeRetainedRecall(origin, authority)
}

function shellResult(stdout: string) {
  return { stdout, stderr: '', exitCode: 0 as const, isTimedOut: false, isCancelled: false }
}

function kept(pack: ObservationPack, tool: string, origin?: RetainedOrigin) {
  return {
    keep: (fullText: string, name: string): string | undefined =>
      pack.retain(
        fullText,
        name,
        origin ?? {
          tool: name,
          names: [],
          complete: false,
          revision: CURRENT_REVISION,
          wasTrusted: true,
        },
      ),
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
    const judge = fence(currentAuthority())
    const id = pack.retain('a'.repeat(OBS_PACK_PAGE_CHARS + 10), 'shell', {
      tool: 'shell',
      names: [],
      complete: false,
      revision: CURRENT_REVISION,
      wasTrusted: true,
    })
    // The id carries a per-store tag: a fresh store never reissues it.
    expect(id).toMatch(/^retained-[0-9a-f]+-1$/u)
    expect(new ObservationPack().has(id)).toBe(false)
    expect(pack.has(id)).toBe(true)
    expect(pack.has('retained-nonexistent')).toBe(false)
    const first = pack.recall(JSON.stringify({ id, offset: 0 }), judge)
    expect(pageText(first)).toContain('a'.repeat(100))
    expect(first.output).toContain(`offset ${String(OBS_PACK_PAGE_CHARS)}`)
    const second = pack.recall(JSON.stringify({ id, offset: OBS_PACK_PAGE_CHARS }), judge)
    expect(pageText(second)).toContain('end of output')
    const missing = pack.recall(JSON.stringify({ id: 'retained-nonexistent', offset: 0 }), judge)
    expect(missing.failureReason).toBeDefined()
  })

  it('never binds an old note to a fresh store’s unrelated output', () => {
    const first = new ObservationPack()
    const oldId = first.retain('old session text', 'shell')
    const second = new ObservationPack()
    const newId = second.retain('new session text', 'shell')
    expect(newId).not.toBe(oldId)
    // The old note names no output here: unknown in words, never the new text.
    const refused = second.recall(
      JSON.stringify({ id: oldId, offset: 0 }),
      fence(currentAuthority()),
    )
    expect(refused.failureReason).toBeDefined()
    expect(refused.output).not.toContain('new session text')
    expect(refused.output).not.toContain('old session text')
  })

  it('names the id and resume offset in the clip note', () => {
    expect(retainNote('retained-3', 1200)).toBe(
      '[the rest is kept: call recall_output with id "retained-3" and offset 1200 for the rest]',
    )
  })

  it('keeps an elided shell middle with a note that resumes at the elision', () => {
    const pack = new ObservationPack()
    const result = shellResult(`s${'x'.repeat(100_000)}e`)
    const outcome = shellOutcome(result, 120_000, TOOL_OUTPUT_MAX_CHARS, false, kept(pack, 'bash'))
    expect(outcome.output).toContain(TOOL_OUTPUT_ELIDED_MARKER)
    const id = /call recall_output with id "([^"]+)"/u.exec(outcome.output)?.[1]
    expect(id).toMatch(/^retained-[0-9a-f]+-1$/u)
    if (id === undefined) {
      throw new Error('the clip note names no kept id')
    }
    expect(outcome.output.endsWith('[exit code 0]')).toBe(false)
    const at = outcome.output.indexOf(TOOL_OUTPUT_ELIDED_MARKER)
    expect(outcome.output).toContain(`offset ${String(at)}`)
    // The kept whole pages back from the note's offset.
    const recalled = pack.recall(JSON.stringify({ id, offset: at }), fence(currentAuthority()))
    expect(pageText(recalled)).toContain('x'.repeat(100))
  })

  it('says a runner-dropped middle is not recoverable, with the way back', () => {
    const pack = new ObservationPack()
    const result = shellResult(
      `${'a'.repeat(40_000)}\n[12345 characters omitted]\n${'b'.repeat(40_000)}`,
    )
    const outcome = shellOutcome(result, 120_000, TOOL_OUTPUT_MAX_CHARS, false, kept(pack, 'bash'))
    expect(outcome.output).toContain(TOOL_OUTPUT_ELIDED_MARKER)
    expect(outcome.output).toContain('dropped the middle')
    expect(outcome.output).toContain('output to a file')
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

describe('recall fence (P1)', () => {
  const secretText = `project secret ${'s'.repeat(OBS_PACK_PAGE_CHARS)}`

  function searchKept(pack: ObservationPack): string {
    return pack.retain(secretText, 'search', {
      tool: 'search',
      names: ['notes/secret.md'],
      complete: true,
      revision: CURRENT_REVISION,
      wasTrusted: true,
    })
  }

  it('refuses a kept path the current settings now deny, in words', () => {
    const pack = new ObservationPack()
    const id = searchKept(pack)
    const denied = fence(
      currentAuthority({ isDenied: (names) => names.includes('notes/secret.md') }),
    )
    const refused = pack.recall(JSON.stringify({ id, offset: 0 }), denied)
    expect(refused.failureReason).toBeDefined()
    expect(refused.output).toContain('withheld')
    expect(refused.output).toContain('now refused')
    expect(refused.output).not.toContain('project secret')
    expect(refused.visibleOutput).toContain('nothing from it was sent to the model')
  })

  it('returns the same entry while its source is still allowed', () => {
    const pack = new ObservationPack()
    const id = searchKept(pack)
    const allowed = pack.recall(JSON.stringify({ id, offset: 0 }), fence(currentAuthority()))
    expect(allowed.failureReason).toBeUndefined()
    expect(allowed.output).toContain('project secret')
  })

  it('refuses a tainted entry once the workspace loses trust, in words', () => {
    const pack = new ObservationPack()
    const id = pack.retain(secretText, 'read_file', {
      tool: 'read_file',
      names: ['notes/secret.md'],
      complete: true,
      revision: CURRENT_REVISION,
      wasTrusted: true,
    })
    const untrusted = fence(currentAuthority({ trusted: false }))
    const refused = pack.recall(JSON.stringify({ id, offset: 0 }), untrusted)
    expect(refused.failureReason).toBeDefined()
    expect(refused.output).toContain('withheld')
    expect(refused.output).toContain('no longer trusted')
    expect(refused.output).not.toContain('project secret')
  })

  it('withholds opaque text the policy moved under, and keeps it while still', () => {
    const pack = new ObservationPack()
    const id = pack.retain(secretText, 'bash', {
      tool: 'bash',
      names: [],
      complete: false,
      revision: CURRENT_REVISION,
      wasTrusted: true,
    })
    const moved = fence(currentAuthority({ revision: 'rev-changed' }))
    const refused = pack.recall(JSON.stringify({ id, offset: 0 }), moved)
    expect(refused.failureReason).toBeDefined()
    expect(refused.output).toContain('withheld')
    expect(refused.output).not.toContain('project secret')
    const still = pack.recall(JSON.stringify({ id, offset: 0 }), fence(currentAuthority()))
    expect(still.failureReason).toBeUndefined()
    expect(still.output).toContain('project secret')
  })

  it('withholds an entry nobody recorded an origin for', () => {
    const pack = new ObservationPack()
    const id = pack.retain(secretText, 'bash')
    const refused = pack.recall(JSON.stringify({ id, offset: 0 }), fence(currentAuthority()))
    expect(refused.failureReason).toBeDefined()
    expect(refused.output).toContain('withheld')
    expect(refused.output).not.toContain('project secret')
  })
})
