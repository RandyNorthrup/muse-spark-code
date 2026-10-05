// Report a problem (M93, PLAN.md D72): the report-only message handler in
// src/host/conversation/reportProblemHandler.ts. Opening, rebuilding and
// exporting all go through the builder and the export paths; the preview the
// dialog shows is byte-identical to what an export carries, its item list is
// exactly the builder's selection, a broken seal re-previews instead of
// exporting, every answer names its session and draft, and the
// webview-to-host transport rejects any forged raw-text field.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, env, Uri, window, workspace } from 'vscode'
import {
  buildProblemReportDraft,
  isSealedDraftCurrent,
  type ProblemReportInput,
} from '../../src/core/support/problemReport'
import {
  createReportProblemHandler,
  type ReportDataSource,
  type ReportProblemHandlerDeps,
} from '../../src/host/conversation/reportProblemHandler'
import {
  EXTENSION_QUALIFIED_ID,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_RECENT_EVENT_COUNT,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, formatRelativeTime, setUiText } from '../../src/shared/l10n/text'
import {
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
  type HostToWebviewMessage,
  type ReportEventRef,
} from '../../src/shared/protocol'
import { reportWebviewErrorMessage } from '../../src/webview/errorReport'
import type { Logger } from '../../src/host/logger'

const FACTS = {
  extensionVersion: '0.12.1',
  vscodeVersion: '1.99.0',
  nodeVersion: '22.20.4',
  platform: 'linux',
  backend: 'auto',
  sandbox: 'auto',
  cliFound: true,
  cliVersion: '1.4.2',
  cliSignIn: true,
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  settingNames: ['museSpark.backend'],
} as const

const EVENTS: readonly unknown[] = [
  {
    kind: 'toolCallFailed',
    code: 'TypeError',
    frames: [{ path: 'dist/extension.js', line: 2, column: 41_723 }],
    ageMs: 45_000,
  },
  { kind: 'backendExit', code: 'unknown', frames: [], ageMs: 120_000 },
  // Off the allowlist: the builder skips it, so no item lists it either.
  { kind: 'modelSaid', code: 'x', frames: [], ageMs: 1 },
  // A valid kind with an extra field: skipped by the builder, never listed.
  { kind: 'errorNotice', code: 'unknown', frames: [], ageMs: 5, note: 'raw' },
  // A frame outside the package: skipped, never listed.
  {
    kind: 'errorNotice',
    code: 'unknown',
    frames: [{ path: 'src/elsewhere.ts', line: 1, column: 0 }],
    ageMs: 5,
  },
]

const NOW_MS = 1_769_000_000_000
const SCRUB = { workspaceRoots: [], homeDir: '', extraLiterals: [] } as const

function sourceWith(overrides: Partial<ReportDataSource> = {}): ReportDataSource {
  return {
    readFacts: () => Promise.resolve(FACTS),
    readJournal: () => Promise.resolve({ entries: EVENTS, recordingUnavailable: false }),
    readScrub: () => SCRUB,
    nowMs: () => NOW_MS,
    canUseVscodeReporter: () => Promise.resolve(true),
    ...overrides,
  }
}

function depsWith(source: ReportDataSource | undefined): {
  deps: ReportProblemHandlerDeps
  posted: HostToWebviewMessage[]
  log: Logger & { errors: string[]; warnings: string[]; infos: string[] }
} {
  const posted: HostToWebviewMessage[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const log: Logger & { errors: string[]; warnings: string[]; infos: string[] } = {
    errors,
    warnings,
    infos,
    trace: () => undefined,
    info: (message) => {
      infos.push(message)
    },
    warn: (message) => {
      warnings.push(message)
    },
    error: (message) => {
      errors.push(message)
    },
  }
  return {
    posted,
    log,
    deps: {
      post: (message) => {
        posted.push(message)
      },
      noticeError: vi.fn(),
      log,
      source,
      onReportWebviewError: vi.fn(),
    },
  }
}

/** An opened dialog: its handler, what it posted, and its deps. */
async function openDialog(source: ReportDataSource = sourceWith(), ref?: ReportEventRef) {
  const { deps, posted, log } = depsWith(source)
  const { handle } = createReportProblemHandler(deps)
  await handle(ref === undefined ? { type: 'openReport' } : { type: 'openReport', ref })
  return { deps, posted, log, handle }
}

type DraftMessage = Extract<HostToWebviewMessage, { type: 'reportDraft' }>
type ExportedMessage = Extract<HostToWebviewMessage, { type: 'reportExported' }>

function draftsOf(posted: HostToWebviewMessage[]): DraftMessage[] {
  return posted.filter((message): message is DraftMessage => message.type === 'reportDraft')
}

function exportedOf(posted: HostToWebviewMessage[]): ExportedMessage[] {
  return posted.filter((message): message is ExportedMessage => message.type === 'reportExported')
}

/** The answer the handler posts for `draft`, with the fields the test names. */
function answerFor(
  draft: DraftMessage | undefined,
  fields: Partial<ExportedMessage> & Pick<ExportedMessage, 'via' | 'ok'>,
): ExportedMessage {
  return {
    type: 'reportExported',
    session: draft?.session ?? 0,
    hash: draft?.hash ?? '',
    ...fields,
  }
}

/** An item's age as the installed language says it. */
function age(value: number, unit: 'second' | 'minute'): string {
  return formatRelativeTime(-value, unit)
}

/** The clipboard, opener, dialogs, files and commands start each test uncalled and resolving. */
function resetReportVscodeMocks(): void {
  const mocks = [
    vi.mocked(env.clipboard.writeText),
    vi.mocked(env.openExternal),
    vi.mocked(window.showSaveDialog),
    vi.mocked(window.showInformationMessage),
    vi.mocked(window.showErrorMessage),
    vi.mocked(workspace.fs.writeFile),
    vi.mocked(commands.executeCommand),
  ]
  for (const mock of mocks) {
    mock.mockReset()
  }
  vi.mocked(env.clipboard.writeText).mockResolvedValue(undefined)
  vi.mocked(env.openExternal).mockResolvedValue(true)
  vi.mocked(commands.executeCommand).mockResolvedValue(undefined)
}

beforeEach(() => {
  setUiText(EN, 'en')
  resetReportVscodeMocks()
})

describe('reportProblemHandler', () => {
  it('opens session 1 with the sealed draft and exactly the records it carries', async () => {
    const { posted, log } = await openDialog(sourceWith(), { kind: 'backendExit', entryIndex: 1 })
    const drafts = draftsOf(posted)
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]
    expect(draft).toMatchObject({ session: 1, revision: 0, canUseVscodeReporter: true })
    expect(draft?.recordingUnavailable).toBe(false)
    // The facts and the two records the builder keeps; the three it skips
    // (unknown kind, extra field, outside frame) list no item.
    expect(draft?.items).toEqual([
      { kind: 'facts', label: 'Support facts' },
      {
        kind: 'event',
        eventIndex: 0,
        label: fill(UI_TEXT.reportEventItem, { kind: 'toolCallFailed', age: age(45, 'second') }),
      },
      {
        kind: 'event',
        eventIndex: 1,
        label: fill(UI_TEXT.reportEventItem, { kind: 'backendExit', age: age(2, 'minute') }),
      },
    ])
    // The preview is exactly what the builder makes from the same inputs.
    const input: ProblemReportInput = {
      description: '',
      includeFacts: true,
      includeEvents: true,
      facts: FACTS,
      events: EVENTS,
      recordingUnavailable: false,
      nowMs: NOW_MS,
      scrub: SCRUB,
    }
    const sealed = buildProblemReportDraft(input)
    expect(draft?.title).toBe(sealed.title)
    expect(draft?.text).toBe(sealed.text)
    expect(draft?.text).toContain('Recent events (2):')
    expect(
      isSealedDraftCurrent({
        title: draft?.title ?? '',
        text: draft?.text ?? '',
        hash: draft?.hash ?? '',
      }),
    ).toBe(true)
    // The reference names a kind only; the log line says nothing more.
    expect(log.infos).toEqual(['Report opened from a recorded backendExit'])
  })

  it('numbers each open as a new session', async () => {
    const { posted, handle } = await openDialog()
    await handle({ type: 'openReport' })
    expect(draftsOf(posted).map((draft) => draft.session)).toEqual([1, 2])
  })

  it('lists no more items than the draft carries, within the transport bound (RVM93W 5)', async () => {
    const many = Array.from({ length: REPORT_RECENT_EVENT_COUNT + 1 }, (_, index) => ({
      kind: 'backendExit',
      code: 'unknown',
      frames: [],
      ageMs: (REPORT_RECENT_EVENT_COUNT + 1 - index) * 1000,
    }))
    const { posted } = await openDialog(
      sourceWith({
        readJournal: () => Promise.resolve({ entries: many, recordingUnavailable: false }),
      }),
    )
    const draft = draftsOf(posted)[0]
    // The facts plus the last 50 records: index 0 (the oldest) is not carried.
    expect(draft?.items).toHaveLength(REPORT_RECENT_EVENT_COUNT + 1)
    expect(draft?.items.some((item) => item.eventIndex === 0)).toBe(false)
    expect(draft?.text).toContain(`Recent events (${String(REPORT_RECENT_EVENT_COUNT)}):`)
    // The host's message is one the webview accepts.
    expect(parseHostToWebviewMessage(draft).ok).toBe(true)
  })

  it('lists no record while recent events are left out (RVM93W 5)', async () => {
    const { posted, handle } = await openDialog()
    await handle({
      type: 'updateReport',
      revision: 1,
      description: '',
      includeFacts: true,
      includeEvents: false,
      removedEventIndexes: [],
    })
    const draft = draftsOf(posted)[1]
    expect(draft?.items).toEqual([{ kind: 'facts', label: 'Support facts' }])
    expect(draft?.text).not.toContain('Recent events')
  })

  it('labels ages in the installed language while the draft stays English (RVM93W 10)', async () => {
    const japanese = { ...EN, reportEventItem: '{kind}・{age}', reportFactsItem: 'サポート情報' }
    setUiText(japanese, 'ja')
    const { posted } = await openDialog()
    const draft = draftsOf(posted)[0]
    expect(draft?.items[0]?.label).toBe('サポート情報')
    expect(draft?.items[1]?.label).toBe(
      fill(japanese.reportEventItem, { kind: 'toolCallFailed', age: age(45, 'second') }),
    )
    expect(draft?.items[1]?.label).not.toContain('45s ago')
    expect(draft?.text).toContain('- 45s ago toolCallFailed TypeError')
  })

  it('says plainly that it did not work with no wired source', async () => {
    const { deps, posted } = depsWith(undefined)
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(posted).toEqual([])
    expect(vi.mocked(deps.noticeError)).toHaveBeenCalledWith(UI_TEXT.actionFailed)
  })

  it('says a failed fact read plainly, logging its class only', async () => {
    const { deps, posted, log } = depsWith(
      sourceWith({ readFacts: () => Promise.reject(new Error('/home/someone/secret')) }),
    )
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(posted).toEqual([])
    expect(vi.mocked(deps.noticeError)).toHaveBeenCalledWith(UI_TEXT.actionFailed)
    expect(log.errors.join('\n')).not.toContain('someone')
  })

  it('rebuilds on every change and echoes the choice it answers', async () => {
    const { posted, handle } = await openDialog()
    await handle({
      type: 'updateReport',
      revision: 1,
      description: 'The panel went blank.',
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    await handle({
      type: 'updateReport',
      revision: 2,
      description: 'The panel went blank.',
      includeFacts: false,
      includeEvents: true,
      removedEventIndexes: [0],
    })
    const drafts = draftsOf(posted)
    expect(drafts.map((draft) => [draft.session, draft.revision])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
    ])
    expect(drafts[1]?.text).toContain('The panel went blank.')
    // The facts section and the first event are gone from text and items.
    expect(drafts[2]?.text).not.toContain('Support facts:')
    expect(drafts[2]?.text).not.toContain('toolCallFailed')
    expect(drafts[2]?.text).toContain('backendExit')
    expect(drafts[2]?.items.map((item) => item.eventIndex)).toEqual([1])
    // Removing a record changes the draft; its item goes with it.
    expect(drafts[2]?.hash).not.toBe(drafts[1]?.hash)
  })

  it('copies exactly the previewed draft, and names the draft it answers', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    await handle({ type: 'exportReport', via: 'copy', hash: draft?.hash ?? '' })
    expect(vi.mocked(env.clipboard.writeText)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(env.clipboard.writeText)).toHaveBeenCalledWith(draft?.text)
    expect(exportedOf(posted)).toEqual([answerFor(draft, { via: 'copy', ok: true })])
    // No notification waits on the user: the dialog's status line says it.
    expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
  })

  it('answers an export for the draft it exported, not the one shown later (RVM93W 7)', async () => {
    const { posted, handle } = await openDialog()
    const first = draftsOf(posted)[0]
    const held = Promise.withResolvers<undefined>()
    vi.mocked(env.clipboard.writeText).mockImplementationOnce(() => held.promise)
    const copying = handle({ type: 'exportReport', via: 'copy', hash: first?.hash ?? '' })
    await handle({
      type: 'updateReport',
      revision: 1,
      description: 'Changed while copying.',
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    held.resolve(undefined)
    await copying
    const second = draftsOf(posted)[1]
    expect(second?.hash).not.toBe(first?.hash)
    // The answer names the copied draft's seal: the webview drops it, since
    // the dialog now shows the second draft.
    expect(exportedOf(posted)).toEqual([answerFor(first, { via: 'copy', ok: true })])
  })

  it('refuses a stale seal with no side effect and re-previews instead', async () => {
    const { posted, handle } = await openDialog()
    await handle({ type: 'exportReport', via: 'copy', hash: 'f'.repeat(64) })
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    const drafts = draftsOf(posted)
    expect(drafts).toHaveLength(2)
    expect(drafts[1]).toEqual(drafts[0])
    expect(exportedOf(posted)).toEqual([
      answerFor(drafts[1], { via: 'copy', ok: false, reason: 'stale' }),
    ])
  })

  it('states a refused clipboard and a cancelled save plainly', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    const hash = draft?.hash ?? ''
    vi.mocked(env.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    await handle({ type: 'exportReport', via: 'copy', hash })
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(undefined)
    await handle({ type: 'exportReport', via: 'save', hash })
    expect(exportedOf(posted)).toEqual([
      answerFor(draft, { via: 'copy', ok: false, reason: 'copyFailed' }),
      answerFor(draft, { via: 'save', ok: false, reason: 'cancelled' }),
    ])
  })

  it('opens the prefilled issue page, and flags the over-long fallback', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    const opened = vi.mocked(env.openExternal).mock.calls[0]?.[0]
    expect(String(opened)).toContain('issues/new?title=')
    expect(exportedOf(posted)).toEqual([
      answerFor(draft, { via: 'issue', ok: true, issueFallback: false }),
    ])
  })

  it('answers a browser that refused or threw in a fixed word (RVM93W 8)', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    vi.mocked(env.openExternal).mockRejectedValueOnce(new Error('/home/someone/browser'))
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    vi.mocked(env.openExternal).mockResolvedValueOnce(false)
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    expect(exportedOf(posted)).toEqual([
      answerFor(draft, { via: 'issue', ok: false, reason: 'openFailed' }),
      answerFor(draft, { via: 'issue', ok: false, reason: 'openFailed' }),
    ])
    expect(JSON.stringify(posted)).not.toContain('someone')
  })

  it('answers an export path that threw instead of leaving the dialog waiting', async () => {
    const { posted, handle, log } = await openDialog()
    const draft = draftsOf(posted)[0]
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(Uri.file('/tmp/report.md'))
    vi.mocked(workspace.fs.writeFile).mockImplementationOnce(() => {
      throw new Error('/home/someone/disk')
    })
    await handle({ type: 'exportReport', via: 'save', hash: draft?.hash ?? '' })
    expect(exportedOf(posted)).toEqual([
      answerFor(draft, { via: 'save', ok: false, reason: 'saveFailed' }),
    ])
    expect(log.warnings.join('\n')).not.toContain('someone')
  })

  it('uses the VS Code reporter with the supported fields only', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash: draft?.hash ?? '' })
    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledTimes(1)
    const [command, args] = vi.mocked(commands.executeCommand).mock.calls[0] ?? []
    expect(command).toBe('workbench.action.openIssueReporter')
    expect(args).toEqual({
      extensionId: EXTENSION_QUALIFIED_ID,
      issueTitle: draft?.title,
      issueBody: draft?.text,
    })
    expect(exportedOf(posted)).toEqual([answerFor(draft, { via: 'vscodeReporter', ok: true })])
  })

  it('states a failed reporter launch and hides its action when the command is missing', async () => {
    const { posted, handle } = await openDialog(
      sourceWith({ canUseVscodeReporter: () => Promise.resolve(false) }),
    )
    const draft = draftsOf(posted)[0]
    expect(draft?.canUseVscodeReporter).toBe(false)
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error('no such command'))
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash: draft?.hash ?? '' })
    expect(exportedOf(posted)).toEqual([
      answerFor(draft, { via: 'vscodeReporter', ok: false, reason: 'reporterFailed' }),
    ])
  })

  it('forwards the scrubbed webview failure to its sink, with no raw text', async () => {
    const { deps } = depsWith(sourceWith())
    const onError = vi.mocked(deps.onReportWebviewError)
    const { handle } = createReportProblemHandler(deps)
    const error = errorWithStack(
      'secret-looking prompt text sk-1234',
      `TypeError: secret-looking prompt text sk-1234
    at render (${SCRIPT_URL}:100:20)
    at hopeful (https://elsewhere.example/x.js:1:2)`,
      TypeError,
    )
    await handle(reportWebviewErrorMessage('reactBoundary', 'render', error, SCRIPT_URL))
    expect(onError).toHaveBeenCalledTimes(1)
    const received = onError.mock.calls[0]![0]
    expect(received).toEqual({
      type: 'reportWebviewError',
      kind: 'reactBoundary',
      source: 'render',
      code: 'TypeError',
      frames: [{ path: 'dist/webview/main.js', line: 100, column: 20 }],
    })
    expect(JSON.stringify(received)).not.toContain('secret-looking')
  })
})

describe('report transport strictness', () => {
  it('rejects any forged raw-text field on the dialog messages', () => {
    const forged = [
      { type: 'openReport', ref: { kind: 'backendExit', entryIndex: 1 }, message: 'raw' },
      {
        type: 'updateReport',
        revision: 1,
        description: '',
        includeFacts: true,
        includeEvents: true,
        removedEventIndexes: [],
        text: 'raw',
      },
      { type: 'exportReport', via: 'copy', hash: '0'.repeat(64), stack: 'raw' },
      {
        type: 'reportWebviewError',
        kind: 'windowError',
        source: 'window',
        code: 'unknown',
        frames: [],
        message: 'raw',
      },
    ]
    for (const message of forged) {
      expect(parseWebviewToHostMessage(message).ok).toBe(false)
    }
  })

  it('accepts the dialog messages and the scrubbed error at their bounds', () => {
    const valid = [
      { type: 'openReport' },
      { type: 'openReport', ref: { kind: 'windowError', entryIndex: 0 } },
      {
        type: 'updateReport',
        revision: 1,
        description: 'x'.repeat(REPORT_DESCRIPTION_MAX_CHARS),
        includeFacts: false,
        includeEvents: false,
        removedEventIndexes: [0],
      },
      { type: 'exportReport', via: 'save', hash: 'a'.repeat(64) },
      reportWebviewErrorMessage('windowError', 'window', new Error('kept out'), SCRIPT_URL),
    ]
    for (const message of valid) {
      expect(parseWebviewToHostMessage(message)).toEqual({ ok: true, message })
    }
    // Past the bounds fails instead of truncating; a choice has a revision.
    expect(
      parseWebviewToHostMessage({
        type: 'updateReport',
        revision: 1,
        description: 'x'.repeat(REPORT_DESCRIPTION_MAX_CHARS + 1),
        includeFacts: true,
        includeEvents: true,
        removedEventIndexes: [],
      }).ok,
    ).toBe(false)
    expect(
      parseWebviewToHostMessage({
        type: 'updateReport',
        description: '',
        includeFacts: true,
        includeEvents: true,
        removedEventIndexes: [],
      }).ok,
    ).toBe(false)
    expect(parseWebviewToHostMessage({ type: 'exportReport', via: 'copy', hash: 'short' }).ok).toBe(
      false,
    )
  })
})

/** The webview bundle's own resolved URL, as a webview sees it (it holds the install folder). */
const SCRIPT_URL =
  'https://file+.vscode-resource.vscode-cdn.net/home/someone/.vscode/extensions/x/dist/webview/main.js'

/** An error class the recorder does not know: its name never becomes a code. */
class PrivateCustomName extends Error {
  public override readonly name = 'PrivateCustomName'
}

/** An error of `kind` with a controlled stack, without assigning to `stack` itself. */
function errorWithStack(
  message: string,
  stack: string,
  kind: new (text: string) => Error = Error,
): Error {
  const error = new kind(message)
  Object.defineProperty(error, 'stack', { value: stack })
  return error
}

describe('reportWebviewErrorMessage', () => {
  it('posts no raw text as a frame path (RVM93W 1)', () => {
    // The review's probe: an error message shaped like a frame.
    const probe = reportWebviewErrorMessage(
      'windowError',
      'window',
      new Error('PRIVATE_PROMPT:7:9'),
      SCRIPT_URL,
    )
    expect(probe.frames).toEqual([])
    const forged = errorWithStack(
      'PRIVATE_PROMPT:7:9',
      [
        'Error: PRIVATE_PROMPT:7:9',
        'PRIVATE_LINE:1:2',
        '    at render (/home/someone/project/src/App.tsx:10:2)',
        String.raw`    at C:\Users\someone\x.js:4:5`,
        '    at fetch (https://elsewhere.example/x.js?token=abc:1:2)',
        '    at wrapped (vscode-webview://host/dist/webview/main.js:4242:18)',
        '    at PRIVATE_FUNCTION_NAME (src/x.ts:3:4)',
      ].join('\n'),
    )
    const message = reportWebviewErrorMessage('reactBoundary', 'render', forged, SCRIPT_URL)
    // The class is a known word (Error); the message, lines and URLs are gone.
    expect(message).toEqual({
      type: 'reportWebviewError',
      kind: 'reactBoundary',
      source: 'render',
      code: 'Error',
      frames: [],
    })
    expect(JSON.stringify(message)).not.toMatch(/PRIVATE|someone|elsewhere|token/)
  })

  it('keeps frames inside its own bundle, named by the package path', () => {
    const error = errorWithStack(
      'the model said sk-abcdef',
      [
        'RangeError: the model said sk-abcdef',
        `    at render (${SCRIPT_URL}:10:2)`,
        `    at ${SCRIPT_URL}:4242:18`,
        `    at async load (${SCRIPT_URL}:7:1)`,
        '    at nonsense',
        `    at zero (${SCRIPT_URL}:0:5)`,
      ].join('\n'),
      RangeError,
    )
    const message = reportWebviewErrorMessage('reactBoundary', 'render', error, SCRIPT_URL)
    expect(message).toEqual({
      type: 'reportWebviewError',
      kind: 'reactBoundary',
      source: 'render',
      code: 'RangeError',
      frames: [
        { path: 'dist/webview/main.js', line: 10, column: 2 },
        { path: 'dist/webview/main.js', line: 4242, column: 18 },
        { path: 'dist/webview/main.js', line: 7, column: 1 },
      ],
    })
    expect(JSON.stringify(message)).not.toMatch(/model said|someone|vscode-cdn/)
  })

  it('keeps no frame without its own script URL, and drops an unknown class name', () => {
    const error = errorWithStack('x', `Error: x\n    at f (${SCRIPT_URL}:1:1)`, PrivateCustomName)
    expect(reportWebviewErrorMessage('windowError', 'window', error, undefined)).toMatchObject({
      code: 'unknown',
      frames: [],
    })
  })

  it('caps frames and drops non-errors to an empty frame list', () => {
    const lines = Array.from(
      { length: 20 },
      (_, index) => `    at f${String(index)} (${SCRIPT_URL}:${String(index + 1)}:1)`,
    )
    const error = errorWithStack('boom', `Error: boom\n${lines.join('\n')}`)
    const capped = reportWebviewErrorMessage('windowError', 'window', error, SCRIPT_URL)
    expect(capped.frames).toHaveLength(16)
    expect(
      reportWebviewErrorMessage('unhandledRejection', 'promise', 'a raw string reason', SCRIPT_URL),
    ).toEqual({
      type: 'reportWebviewError',
      kind: 'unhandledRejection',
      source: 'promise',
      code: 'unknown',
      frames: [],
    })
  })
})
