// Report a problem, lane 0 (M93, PLAN.md D72): the report tunables in
// constants.ts and the report-message schemas in protocol.ts. The schemas
// carry no free-text event payload: fixed kinds, counts and bounded
// identifiers only, with strict objects so a forged extra field fails.
import { describe, expect, it } from 'vitest'
import {
  MILLISECONDS_PER_DAY,
  REPORT_ERROR_CODE_MAX_CHARS,
  REPORT_EVENT_KINDS,
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_ISSUE_URL_MAX_CHARS,
  REPORT_JOURNAL_ENTRY_MAX_BYTES,
  REPORT_JOURNAL_MAX_AGE_MS,
  REPORT_JOURNAL_MAX_BYTES,
  REPORT_JOURNAL_VERSION,
  REPORT_RECENT_EVENT_COUNT,
  REPORT_STACK_MAX_FRAMES,
  REPORT_UNKNOWN_ERROR_CODE,
  REPORT_WEBVIEW_ERROR_KINDS,
  type ReportEventKind,
  type ReportWebviewErrorKind,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  reportEventRefSchema,
  reportWebviewErrorSchema,
  type ReportEventRef,
  type ReportWebviewError,
} from '../../src/shared/protocol'

describe('report tunables', () => {
  it('bounds the journal to 7 days and 256 KiB with 4 KiB entries', () => {
    expect(REPORT_JOURNAL_VERSION).toBe(1)
    expect(REPORT_JOURNAL_MAX_AGE_MS).toBe(7 * MILLISECONDS_PER_DAY)
    expect(REPORT_JOURNAL_MAX_AGE_MS).toBe(604_800_000)
    expect(REPORT_JOURNAL_MAX_BYTES).toBe(256 * 1024)
    expect(REPORT_JOURNAL_ENTRY_MAX_BYTES).toBe(4 * 1024)
  })

  it('carries the last 50 entries and caps the encoded issue URL at 2,000 chars', () => {
    expect(REPORT_RECENT_EVENT_COUNT).toBe(50)
    expect(REPORT_ISSUE_URL_MAX_CHARS).toBe(2000)
  })

  it('fixes the journal event kinds and the webview-post subset', () => {
    expect([...REPORT_EVENT_KINDS]).toEqual([
      'activationFailed',
      'backendExit',
      'toolCallFailed',
      'windowError',
      'unhandledRejection',
      'reactBoundary',
      'errorNotice',
    ])
    expect([...REPORT_WEBVIEW_ERROR_KINDS]).toEqual([
      'windowError',
      'unhandledRejection',
      'reactBoundary',
    ])
    const kind: ReportEventKind = 'backendExit'
    const webviewKind: ReportWebviewErrorKind = 'reactBoundary'
    expect(kind).toBe('backendExit')
    expect(webviewKind).toBe('reactBoundary')
  })

  it('bounds codes and frames and names the unknown-code word', () => {
    expect(REPORT_UNKNOWN_ERROR_CODE).toBe('unknown')
    expect(REPORT_ERROR_CODE_MAX_CHARS).toBe(64)
    expect(REPORT_FRAME_PATH_MAX_CHARS).toBe(260)
    expect(REPORT_STACK_MAX_FRAMES).toBe(16)
  })
})

describe('reportEventRefSchema', () => {
  it('accepts a kind with its journal index', () => {
    const ref: ReportEventRef = { kind: 'toolCallFailed', entryIndex: 3 }
    expect(reportEventRefSchema.safeParse(ref)).toEqual({ success: true, data: ref })
  })

  it.each([
    ['an unknown kind', { kind: 'hearsay', entryIndex: 0 }],
    ['a host kind missing', { entryIndex: 0 }],
    ['a negative index', { kind: 'backendExit', entryIndex: -1 }],
    ['a fractional index', { kind: 'backendExit', entryIndex: 1.5 }],
    ['a missing index', { kind: 'backendExit' }],
  ])('rejects %s', (_label, input) => {
    expect(reportEventRefSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    ['a raw message', { kind: 'errorNotice', entryIndex: 0, message: 'boom' }],
    ['a raw stack', { kind: 'errorNotice', entryIndex: 0, stack: 'at x' }],
    ['row text', { kind: 'errorNotice', entryIndex: 0, text: 'row' }],
    ['a session id', { kind: 'errorNotice', entryIndex: 0, sessionId: 's1' }],
    ['any other extra field', { kind: 'errorNotice', entryIndex: 0, extra: 1 }],
  ])('rejects free text and unknown keys: %s', (_label, input) => {
    expect(reportEventRefSchema.safeParse(input).success).toBe(false)
  })
})

describe('reportWebviewErrorSchema', () => {
  const frame = { path: 'src/webview/App.tsx', line: 12, column: 4 }

  it('accepts a scrubbed webview failure', () => {
    const posted: ReportWebviewError = {
      kind: 'windowError',
      source: 'window',
      code: 'TypeError',
      frames: [frame],
    }
    expect(reportWebviewErrorSchema.safeParse(posted)).toEqual({ success: true, data: posted })
  })

  it('accepts the unknown-code word and an empty frame list', () => {
    const posted: ReportWebviewError = {
      kind: 'unhandledRejection',
      source: 'promise',
      code: REPORT_UNKNOWN_ERROR_CODE,
      frames: [],
    }
    expect(reportWebviewErrorSchema.safeParse(posted).success).toBe(true)
  })

  it('accepts a code and a stack at exactly their bounds', () => {
    const posted = {
      kind: 'reactBoundary',
      source: 'render',
      code: 'x'.repeat(REPORT_ERROR_CODE_MAX_CHARS),
      frames: Array.from({ length: REPORT_STACK_MAX_FRAMES }, () => ({ ...frame })),
    }
    expect(reportWebviewErrorSchema.safeParse(posted).success).toBe(true)
  })

  it.each([
    ['a host-only kind', { kind: 'backendExit', source: 'window', code: 'x', frames: [] }],
    ['an unknown kind', { kind: 'hearsay', source: 'window', code: 'x', frames: [] }],
    ['an unknown source', { kind: 'windowError', source: 'telemetry', code: 'x', frames: [] }],
    ['an empty code', { kind: 'windowError', source: 'window', code: '', frames: [] }],
    [
      'an oversize code',
      {
        kind: 'windowError',
        source: 'window',
        code: 'x'.repeat(REPORT_ERROR_CODE_MAX_CHARS + 1),
        frames: [],
      },
    ],
    [
      'an oversize path',
      {
        kind: 'windowError',
        source: 'window',
        code: 'x',
        frames: [{ path: `a/${'x'.repeat(REPORT_FRAME_PATH_MAX_CHARS)}`, line: 1, column: 0 }],
      },
    ],
    [
      'an empty path',
      { kind: 'windowError', source: 'window', code: 'x', frames: [{ ...frame, path: '' }] },
    ],
    [
      'line zero',
      { kind: 'windowError', source: 'window', code: 'x', frames: [{ ...frame, line: 0 }] },
    ],
    [
      'a negative column',
      { kind: 'windowError', source: 'window', code: 'x', frames: [{ ...frame, column: -1 }] },
    ],
    [
      'a frame past the bound',
      {
        kind: 'windowError',
        source: 'window',
        code: 'x',
        frames: Array.from({ length: REPORT_STACK_MAX_FRAMES + 1 }, () => ({ ...frame })),
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(reportWebviewErrorSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    ['a raw message', { kind: 'windowError', source: 'window', code: 'x', frames: [], message: 'boom' }],
    ['a raw stack', { kind: 'windowError', source: 'window', code: 'x', frames: [], stack: 'at x' }],
    ['a prompt', { kind: 'windowError', source: 'window', code: 'x', frames: [], prompt: 'hi' }],
    ['a forged frame field', { kind: 'windowError', source: 'window', code: 'x', frames: [{ ...frame, function: 'f' }] }],
  ])('rejects free text and unknown keys: %s', (_label, input) => {
    expect(reportWebviewErrorSchema.safeParse(input).success).toBe(false)
  })
})

const REPORT_UI_KEYS = [
  'reportCrashOffer',
  'reportCrashAction',
  'reportCrashDismiss',
  'reportThisAction',
  'reportTitle',
  'reportDescriptionLabel',
  'reportIncludeFacts',
  'reportIncludeEvents',
  'reportPreviewLabel',
  'reportCopyAction',
  'reportOpenIssueAction',
  'reportSaveAction',
  'reportVscodeReporterAction',
  'reportCancelAction',
  'reportCopied',
  'reportCopyFailed',
  'reportSaved',
  'reportSaveFailed',
  'reportUrlTooLong',
  'reportRecordingUnavailable',
  'reportDescriptionWarning',
  'reportVscodeReporterNote',
] as const

describe('report strings', () => {
  it.each([...REPORT_UI_KEYS])('has non-empty English for %s', (key) => {
    const text: string = EN[key]
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
