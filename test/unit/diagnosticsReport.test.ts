import { describe, expect, it } from 'vitest'
import type { DiagnosticEntry } from '../../src/core/diagnostics'
import {
  clipText,
  DiagnosticsHistory,
  type EditedFile,
  type FileDiagnostics,
} from '../../src/core/verify/diagnosticsReport'
import { applyOffsetEdits } from '../../src/core/verify/textEdits'
import {
  MODEL_TEXT,
  TOOL_OUTPUT_CLIP_MARKER,
  VERIFY_DIAGNOSTICS_MAX_ENTRIES,
  VERIFY_NOTE_MAX_CHARS,
  VERIFY_SHOWN_FILES_MAX,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const A: EditedFile = { relative: 'src/a.ts', absolute: '/ws/src/a.ts' }
const B: EditedFile = { relative: 'src/b.ts', absolute: '/ws/src/b.ts' }
const OPTIONS = { maxChars: VERIFY_NOTE_MAX_CHARS }
// A character outside the Basic Multilingual Plane: two UTF-16 code units.
const GRINNING_FACE = String.fromCodePoint(0x1_f6_00)

function entry(
  severity: DiagnosticEntry['severity'],
  message: string,
  line = 1,
  source: string | undefined = 'ts',
): DiagnosticEntry {
  return { path: undefined, severity, line, column: 1, message, source }
}

/** A report whose reads become the baseline at once, as when the model has it. */
function delivered(history: DiagnosticsHistory, files: readonly FileDiagnostics[]) {
  const pending = history.report(files, OPTIONS)
  pending.commit()
  return pending.report
}

describe('DiagnosticsHistory', () => {
  it("counts each file's errors and warnings and lists them, leaving hints out", () => {
    const { report } = new DiagnosticsHistory().report(
      [
        {
          file: A,
          entries: [
            entry('error', 'bad', 3),
            entry('warning', 'unused', 1, 'eslint'),
            entry('hint', 'meh'),
            entry('information', 'fyi'),
          ],
        },
        { file: B, entries: [] },
      ],
      OPTIONS,
    )
    expect(report).toEqual({
      text: [
        MODEL_TEXT.verifyDiagnosticsHeading,
        'src/a.ts: errors 1, warnings 1',
        'src/b.ts: no errors or warnings',
        'src/a.ts:3:1: error: bad [ts]\nsrc/a.ts:1:1: warning: unused [eslint]',
      ].join('\n'),
      errors: 1,
      warnings: 1,
    })
  })

  it('says what changed since the previous check, matching by message, not line', () => {
    const history = new DiagnosticsHistory()
    delivered(history, [
      { file: A, entries: [entry('error', 'bad', 3), entry('error', 'worse', 9)] },
    ])
    // `bad` moved down a line and stays; `worse` is fixed; `new` is new.
    const second = delivered(history, [
      { file: A, entries: [entry('error', 'bad', 4), entry('warning', 'new', 1)] },
    ])
    expect(second.text.split('\n', 2)[1]).toBe(
      'src/a.ts: errors 1, warnings 1 (1 new, 1 fixed since the previous check)',
    )
    // Unchanged since then: no note.
    const third = delivered(history, [
      { file: A, entries: [entry('error', 'bad', 4), entry('warning', 'new', 1)] },
    ])
    expect(third.text.split('\n', 2)[1]).toBe('src/a.ts: errors 1, warnings 1')
    // All fixed: clean, with the count of what went.
    const fourth = delivered(history, [{ file: A, entries: [] }])
    expect(fourth.text).toBe(
      `${MODEL_TEXT.verifyDiagnosticsHeading}\nsrc/a.ts: no errors or warnings (0 new, 2 fixed since the previous check)`,
    )
  })

  it('calls a file it could not read "not checked" with the reason, never clean', () => {
    const { report } = new DiagnosticsHistory().report(
      [
        { file: A, entries: [], unchecked: 'noReport' },
        { file: B, entries: [], unchecked: 'codeLoading' },
        { file: A, entries: [], unchecked: 'tooMany' },
      ],
      { ...OPTIONS, codeFile: 'eslint.config.js' },
    )
    expect(report).toEqual({
      text: [
        MODEL_TEXT.verifyDiagnosticsHeading,
        fill(MODEL_TEXT.verifyFileUnchecked, {
          path: 'src/a.ts',
          reason: MODEL_TEXT.verifyUncheckedNoReport,
        }),
        fill(MODEL_TEXT.verifyFileUnchecked, {
          path: 'src/b.ts',
          reason: fill(MODEL_TEXT.verifyUncheckedCodeLoading, { file: 'eslint.config.js' }),
        }),
        fill(MODEL_TEXT.verifyFileUnchecked, {
          path: 'src/a.ts',
          reason: fill(MODEL_TEXT.verifyUncheckedTooMany, {
            count: String(VERIFY_SHOWN_FILES_MAX),
          }),
        }),
      ].join('\n'),
      unchecked: 3,
    })
    expect(report.text).not.toContain('no errors or warnings')
  })

  it('moves the baseline only when committed, and never for a file not read', () => {
    const history = new DiagnosticsHistory()
    delivered(history, [{ file: A, entries: [entry('error', 'bad')] }])
    // Read but never delivered (a Stop before the note): no baseline change.
    history.report([{ file: A, entries: [] }], OPTIONS)
    // Not read this time: the baseline stays too.
    delivered(history, [{ file: A, entries: [], unchecked: 'noReport' }])
    const next = delivered(history, [{ file: A, entries: [entry('error', 'bad')] }])
    expect(next.text.split('\n', 2)[1]).toBe('src/a.ts: errors 1, warnings 0')
  })

  it('caps the listed entries with a count, and the whole text at its share of the budget', () => {
    const flood = Array.from({ length: VERIFY_DIAGNOSTICS_MAX_ENTRIES + 3 }, (_, index) =>
      entry('error', `e${String(index)}`, index + 1),
    )
    const { report } = new DiagnosticsHistory().report([{ file: A, entries: flood }], OPTIONS)
    expect(report.errors).toBe(VERIFY_DIAGNOSTICS_MAX_ENTRIES + 3)
    expect(report.text.endsWith('… 3 more not shown')).toBe(true)
    const share = 200
    const clipped = new DiagnosticsHistory().report([{ file: A, entries: flood }], {
      maxChars: share,
    }).report
    expect(clipped.text.length).toBeLessThanOrEqual(share)
    expect(clipped.text.endsWith(TOOL_OUTPUT_CLIP_MARKER)).toBe(true)
  })
})

describe('clipText', () => {
  it('keeps short text, and never splits a surrogate pair when it cuts', () => {
    expect(clipText('short', 10)).toBe('short')
    const cut = TOOL_OUTPUT_CLIP_MARKER.length + 2
    expect(clipText(`a${GRINNING_FACE}${'z'.repeat(40)}`, cut)).toBe(`a${TOOL_OUTPUT_CLIP_MARKER}`)
  })
})

describe('applyOffsetEdits', () => {
  it('applies non-overlapping edits wherever they are listed', () => {
    expect(
      applyOffsetEdits('let  a=1', [
        { start: 6, end: 7, newText: ' = ' },
        { start: 3, end: 5, newText: ' ' },
      ]),
    ).toBe('let a = 1')
  })

  it('keeps insertions at one offset in their order', () => {
    expect(
      applyOffsetEdits('ab', [
        { start: 1, end: 1, newText: 'x' },
        { start: 1, end: 1, newText: 'y' },
      ]),
    ).toBe('axyb')
  })

  it('refuses edits that overlap or fall outside the text', () => {
    expect(
      applyOffsetEdits('abcdef', [
        { start: 1, end: 4, newText: '' },
        { start: 3, end: 5, newText: '' },
      ]),
    ).toBeUndefined()
    expect(applyOffsetEdits('abc', [{ start: 2, end: 9, newText: '' }])).toBeUndefined()
    expect(applyOffsetEdits('abc', [{ start: -1, end: 1, newText: '' }])).toBeUndefined()
    expect(applyOffsetEdits('abc', [{ start: 2, end: 1, newText: '' }])).toBeUndefined()
  })
})
