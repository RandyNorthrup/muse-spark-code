// Report a problem, lane W (M93, PLAN.md D72): the report-only message
// handler in src/host/conversation/reportProblemHandler.ts. Opening,
// rebuilding and exporting all go through lane P's builder and export
// paths; the preview the dialog shows is byte-identical to what an export
// carries, a broken seal re-previews instead of exporting, and the
// webview-to-host transport rejects any forged raw-text field.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, env, window, workspace } from 'vscode'
import {
  buildProblemReportDraft,
  isSealedDraftCurrent,
  type ProblemReportInput,
} from '../../src/core/support/report'
import {
  createReportProblemHandler,
  logReportWebviewError,
  type ReportDataSource,
  type ReportProblemHandlerDeps,
} from '../../src/host/conversation/reportProblemHandler'
import {
  EXTENSION_QUALIFIED_ID,
  REPORT_DESCRIPTION_MAX_CHARS,
  UI_TEXT,
} from '../../src/shared/constants'
import {
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
    code: 'exit1',
    frames: [{ path: 'src/host/conversation/conversationController.ts', line: 7420, column: 8 }],
    ageMs: 45_000,
  },
  { kind: 'backendExit', code: 'unknown', frames: [], ageMs: 120_000 },
  // Off the allowlist: lane P's builder skips it, never exports it.
  { kind: 'modelSaid', code: 'x', frames: [], ageMs: 1 },
]

const NOW_MS = 1_769_000_000_000

function sourceWith(overrides: Partial<ReportDataSource> = {}): ReportDataSource {
  return {
    readFacts: () => FACTS,
    readJournal: () => ({ entries: EVENTS, recordingUnavailable: false }),
    readScrub: () => ({ workspaceRoots: [], homeDir: '', extraLiterals: [] }),
    nowMs: () => NOW_MS,
    canUseVscodeReporter: () => Promise.resolve(true),
    ...overrides,
  }
}

function depsWith(source: ReportDataSource | undefined): {
  deps: ReportProblemHandlerDeps
  posted: HostToWebviewMessage[]
  log: Logger & { errors: string[]; warnings: string[] }
} {
  const posted: HostToWebviewMessage[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const log: Logger & { errors: string[]; warnings: string[] } = {
    errors,
    warnings,
    trace: () => undefined,
    info: () => undefined,
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

function draftsOf(
  posted: HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'reportDraft' }>[] {
  return posted.filter(
    (message): message is Extract<HostToWebviewMessage, { type: 'reportDraft' }> =>
      message.type === 'reportDraft',
  )
}

function exportedOf(
  posted: HostToWebviewMessage[],
): Extract<HostToWebviewMessage, { type: 'reportExported' }>[] {
  return posted.filter(
    (message): message is Extract<HostToWebviewMessage, { type: 'reportExported' }> =>
      message.type === 'reportExported',
  )
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
  vi.mocked(window.showInformationMessage).mockResolvedValue(undefined)
  vi.mocked(window.showErrorMessage).mockResolvedValue(undefined)
  vi.mocked(commands.executeCommand).mockResolvedValue(undefined)
}

beforeEach(() => {
  resetReportVscodeMocks()
})

describe('reportProblemHandler', () => {
  it('opens the dialog with lane P’s sealed draft and its removable items', async () => {
    const { deps, posted } = depsWith(sourceWith())
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport', ref: { kind: 'backendExit', entryIndex: 1 } })
    const drafts = draftsOf(posted)
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]
    expect(draft?.canUseVscodeReporter).toBe(true)
    expect(draft?.recordingUnavailable).toBe(false)
    // The facts section and the two allowlisted events; the off-allowlist
    // record lists no item.
    expect(draft?.items.map((item) => item.label)).toEqual([
      'Support facts',
      'toolCallFailed · 45s ago',
      'backendExit · 2m ago',
    ])
    expect(draft?.items[1]).toMatchObject({ kind: 'event', eventIndex: 0 })
    // The preview is exactly what lane P builds from the same inputs.
    const input: ProblemReportInput = {
      description: '',
      includeFacts: true,
      includeEvents: true,
      facts: FACTS,
      events: EVENTS,
      recordingUnavailable: false,
      nowMs: NOW_MS,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    }
    const sealed = buildProblemReportDraft(input)
    expect(draft?.title).toBe(sealed.title)
    expect(draft?.text).toBe(sealed.text)
    expect(
      isSealedDraftCurrent({
        title: draft?.title ?? '',
        text: draft?.text ?? '',
        hash: draft?.hash ?? '',
      }),
    ).toBe(true)
  })

  it('opens without a reference and past a pruned journal end', async () => {
    const { posted, log, handle } = await openDialog()
    expect(draftsOf(posted)).toHaveLength(1)
    await handle({ type: 'openReport' })
    expect(draftsOf(posted)).toHaveLength(2)
    await handle({ type: 'openReport', ref: { kind: 'backendExit', entryIndex: 99 } })
    expect(draftsOf(posted)).toHaveLength(3)
    expect(log.warnings.join('\n')).toContain('past the journal end')
  })

  it('says plainly that it did not work with no wired source', async () => {
    const { deps, posted } = depsWith(undefined)
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(posted).toEqual([])
    expect(vi.mocked(deps.noticeError)).toHaveBeenCalledWith(UI_TEXT.actionFailed)
  })

  it('rebuilds the preview on every description, switch and removal change', async () => {
    const { posted, handle } = await openDialog()
    await handle({
      type: 'updateReport',
      description: 'The panel went blank.',
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    await handle({
      type: 'updateReport',
      description: 'The panel went blank.',
      includeFacts: false,
      includeEvents: true,
      removedEventIndexes: [0],
    })
    const drafts = draftsOf(posted)
    expect(drafts).toHaveLength(3)
    expect(drafts[1]?.text).toContain('The panel went blank.')
    // The facts section and the first event are gone from text and items.
    expect(drafts[2]?.text).not.toContain('Support facts:')
    expect(drafts[2]?.text).not.toContain('toolCallFailed')
    expect(drafts[2]?.text).toContain('backendExit')
    expect(drafts[2]?.items.map((item) => item.label)).toEqual(['backendExit · 2m ago'])
    expect(
      isSealedDraftCurrent({
        title: drafts[2]?.title ?? '',
        text: drafts[2]?.text ?? '',
        hash: drafts[2]?.hash ?? '',
      }),
    ).toBe(true)
  })

  it('copies exactly the previewed draft, and answers it', async () => {
    const { posted, handle } = await openDialog()
    const draft = draftsOf(posted)[0]
    await handle({ type: 'exportReport', via: 'copy', hash: draft?.hash ?? '' })
    expect(vi.mocked(env.clipboard.writeText)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(env.clipboard.writeText)).toHaveBeenCalledWith(draft?.text)
    expect(exportedOf(posted)).toEqual([{ type: 'reportExported', via: 'copy', ok: true }])
  })

  it('refuses a stale seal with no side effect and re-previews instead', async () => {
    const { posted, handle } = await openDialog()
    await handle({
      type: 'exportReport',
      via: 'copy',
      hash: 'f'.repeat(64),
    })
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    expect(draftsOf(posted)).toHaveLength(2)
    expect(exportedOf(posted)).toEqual([
      { type: 'reportExported', via: 'copy', ok: false, reason: 'stale' },
    ])
  })

  it('states a refused clipboard and a cancelled save plainly', async () => {
    const { posted, handle } = await openDialog()
    const hash = draftsOf(posted)[0]?.hash ?? ''
    vi.mocked(env.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    await handle({ type: 'exportReport', via: 'copy', hash })
    expect(exportedOf(posted)).toEqual([
      { type: 'reportExported', via: 'copy', ok: false, reason: 'copyFailed' },
    ])
    vi.mocked(window.showSaveDialog).mockResolvedValueOnce(undefined)
    await handle({ type: 'exportReport', via: 'save', hash })
    expect(exportedOf(posted)[1]).toEqual({
      type: 'reportExported',
      via: 'save',
      ok: false,
      reason: 'cancelled',
    })
  })

  it('opens the prefilled issue page, and flags the over-long fallback', async () => {
    const { posted, handle } = await openDialog()
    const hash = draftsOf(posted)[0]?.hash ?? ''
    await handle({ type: 'exportReport', via: 'issue', hash })
    const opened = vi.mocked(env.openExternal).mock.calls[0]?.[0]
    expect(String(opened)).toContain('issues/new?title=')
    expect(exportedOf(posted)).toEqual([
      { type: 'reportExported', via: 'issue', ok: true, issueFallback: false },
    ])
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
    expect(exportedOf(posted)).toEqual([
      { type: 'reportExported', via: 'vscodeReporter', ok: true },
    ])
  })

  it('states a failed reporter launch and hides its action when the command is missing', async () => {
    const { deps, posted } = depsWith(
      sourceWith({ canUseVscodeReporter: () => Promise.resolve(false) }),
    )
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(draftsOf(posted)[0]?.canUseVscodeReporter).toBe(false)
    const hash = draftsOf(posted)[0]?.hash ?? ''
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error('no such command'))
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash })
    expect(exportedOf(posted)).toEqual([
      { type: 'reportExported', via: 'vscodeReporter', ok: false, reason: 'reporterFailed' },
    ])
    expect(vi.mocked(window.showErrorMessage)).toHaveBeenCalledWith(
      UI_TEXT.reportVscodeReporterFailed,
    )
  })

  it('forwards the scrubbed webview failure to its sink, with no raw text', async () => {
    const { deps } = depsWith(sourceWith())
    const onError = vi.mocked(deps.onReportWebviewError)
    const { handle } = createReportProblemHandler(deps)
    const error = errorWithStack(
      'secret-looking prompt text sk-1234',
      `Error: secret-looking prompt text sk-1234
    at render (vscode-webview://host/dist/webview/main.js:100:20)
    at hopeful (https://elsewhere.example/x.js:1:2)`,
    )
    await handle(reportWebviewErrorMessage('reactBoundary', 'render', error))
    expect(onError).toHaveBeenCalledTimes(1)
    const received = onError.mock.calls[0]![0]
    expect(received).toMatchObject({ kind: 'reactBoundary', source: 'render', code: 'unknown' })
    expect(JSON.stringify(received)).not.toContain('secret-looking')
    // The default sink logs identifiers only.
    const lines: string[] = []
    logReportWebviewError(
      {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message) => {
          lines.push(message)
        },
      },
      received,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('reactBoundary/render')
    expect(lines[0]).not.toContain('secret-looking')
  })
})

describe('report transport strictness', () => {
  it('rejects any forged raw-text field on the dialog messages', () => {
    const forged = [
      { type: 'openReport', ref: { kind: 'backendExit', entryIndex: 1 }, message: 'raw' },
      {
        type: 'updateReport',
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
        description: 'x'.repeat(REPORT_DESCRIPTION_MAX_CHARS),
        includeFacts: false,
        includeEvents: false,
        removedEventIndexes: [0],
      },
      { type: 'exportReport', via: 'save', hash: 'a'.repeat(64) },
      reportWebviewErrorMessage('windowError', 'window', new Error('kept out')),
    ]
    for (const message of valid) {
      expect(parseWebviewToHostMessage(message)).toEqual({ ok: true, message })
    }
    // Past the bounds fails instead of truncating.
    expect(
      parseWebviewToHostMessage({
        type: 'updateReport',
        description: 'x'.repeat(REPORT_DESCRIPTION_MAX_CHARS + 1),
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

/** An error with a controlled stack, without assigning to `stack` itself. */
function errorWithStack(message: string, stack: string): Error {
  const error = new Error(message)
  Object.defineProperty(error, 'stack', { value: stack })
  return error
}

describe('reportWebviewErrorMessage', () => {
  it('carries identifiers and structural frames only, never the error text', () => {
    const error = errorWithStack(
      'the model said sk-abcdef',
      [
        'Error: the model said sk-abcdef',
        '    at render (src/webview/App.tsx:10:2)',
        '    at wrapped (vscode-webview://host/dist/webview/main.js:4242:18)',
        '    at nonsense',
        '    at zero (src/x.ts:0:5)',
      ].join('\n'),
    )
    const message = reportWebviewErrorMessage('reactBoundary', 'render', error)
    expect(message).toEqual({
      type: 'reportWebviewError',
      kind: 'reactBoundary',
      source: 'render',
      code: 'unknown',
      frames: [
        { path: 'src/webview/App.tsx', line: 10, column: 2 },
        { path: 'vscode-webview://host/dist/webview/main.js', line: 4242, column: 18 },
      ],
    })
    expect(JSON.stringify(message)).not.toContain('the model said')
  })

  it('caps frames and drops non-errors to an empty frame list', () => {
    const lines = Array.from(
      { length: 20 },
      (_, index) => `    at f${String(index)} (src/a.ts:${String(index + 1)}:1)`,
    )
    const error = errorWithStack('boom', `Error: boom\n${lines.join('\n')}`)
    const capped = reportWebviewErrorMessage('windowError', 'window', error)
    expect(capped.type).toBe('reportWebviewError')
    expect(capped.frames).toHaveLength(16)
    expect(
      reportWebviewErrorMessage('unhandledRejection', 'promise', 'a raw string reason'),
    ).toEqual({
      type: 'reportWebviewError',
      kind: 'unhandledRejection',
      source: 'promise',
      code: 'unknown',
      frames: [],
    })
  })
})
