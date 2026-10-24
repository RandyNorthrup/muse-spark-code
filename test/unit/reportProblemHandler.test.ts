// The report-only message handler (M93): every failure reaches the dialog
// in fixed words and the record by kind, through the real builder and the
// real export paths.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildProblemReportDraft,
  enrichProblemReportFacts,
  isSealedDraftCurrent,
  type ProblemReportInput,
} from '../../src/core/support/problemReport'
import {
  createReportProblemHandler,
  type ReportDataSource,
  type ReportProblemHandlerDeps,
  type ReportProblemMessage,
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
import { captureLog } from './helpers/captureLog'
import {
  REPORT_FACTS as FACTS,
  validReportSource as validSource,
  workingReportIo as workingIo,
} from './helpers/reportFixtures'

const MISSING = path.join('temp', 'report-problem-never-written.json')

const NOW_MS = 1_769_000_000_000

/**
Five stored records: two the builder carries (a tool failure 45 seconds
old, a backend exit 2 minutes old) and three it counts invalid (an unknown
kind, an off-allowlist field, a frame outside the shipped package).
*/
const EVENTS: readonly unknown[] = [
  { kind: 'toolCallFailed', code: 'TypeError', frames: [], ageMs: 45_000 },
  {
    kind: 'backendExit',
    code: 'ECONNRESET',
    frames: [{ path: 'dist/extension.js', line: 12, column: 4 }],
    ageMs: 120_000,
  },
  { kind: 'notAKind', code: 'x', frames: [], ageMs: 1000 },
  { kind: 'toolCallFailed', code: 'E', frames: [], ageMs: 1000, prompt: 'ignore me' },
  {
    kind: 'backendExit',
    code: 'E',
    frames: [{ path: '/etc/shadow', line: 1, column: 1 }],
    ageMs: 1000,
  },
]

interface Captured {
  readonly posted: HostToWebviewMessage[]
  readonly notices: string[]
  readonly logLines: string[]
}

function makeDeps(overrides?: Partial<ReportProblemHandlerDeps>): {
  deps: ReportProblemHandlerDeps
  captured: Captured
} {
  const posted: HostToWebviewMessage[] = []
  const notices: string[] = []
  const { logger, lines: logLines } = captureLog()
  const deps: ReportProblemHandlerDeps = {
    post: (message) => {
      posted.push(message)
    },
    noticeError: (text) => {
      notices.push(text)
    },
    log: logger,
    source: validSource(),
    io: workingIo(),
    onReportWebviewError: () => undefined,
    ...overrides,
  }
  return { deps, captured: { posted, notices, logLines } }
}

/** Opens with overrides and answers the posted draft's seal for export. */
async function openForExport(overrides?: Partial<ReportProblemHandlerDeps>): Promise<{
  handle: (message: ReportProblemMessage) => Promise<void>
  hash: string
  captured: Captured
}> {
  const { deps, captured } = makeDeps(overrides)
  const { handle } = createReportProblemHandler(deps)
  await handle({ type: 'openReport' })
  const draft = captured.posted[0]
  expect(draft?.type).toBe('reportDraft')
  if (draft?.type !== 'reportDraft') throw new Error('the open posted no draft')
  return { handle, hash: draft.hash, captured }
}

/** Opens the dialog against `source`, from a recorded event when `ref` names one. */
async function openDialog(
  source: ReportDataSource = validSource(),
  ref?: ReportEventRef,
): Promise<{
  deps: ReportProblemHandlerDeps
  captured: Captured
  handle: (message: ReportProblemMessage) => Promise<void>
}> {
  const { deps, captured } = makeDeps({ source })
  const { handle } = createReportProblemHandler(deps)
  await handle(ref === undefined ? { type: 'openReport' } : { type: 'openReport', ref })
  return { deps, captured, handle }
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

/** A source with the carried records and a fixed clock. */
function eventsSource(overrides?: Partial<ReportDataSource>): ReportDataSource {
  return validSource({
    readJournal: () => Promise.resolve({ entries: EVENTS, recordingUnavailable: false }),
    nowMs: () => NOW_MS,
    ...overrides,
  })
}

describe('createReportProblemHandler', () => {
  it('opens a draft built from real validated facts', async () => {
    const { deps, captured } = makeDeps()
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    expect(captured.posted).toHaveLength(1)
    const draft = captured.posted[0]
    expect(draft?.type).toBe('reportDraft')
    expect(captured.notices).toEqual([])
  })

  it('opens session 1 with the sealed draft and exactly the records it carries', async () => {
    const { captured } = await openDialog(eventsSource(), { kind: 'backendExit', entryIndex: 1 })
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]
    expect(draft).toMatchObject({ session: 1, revision: 0, canUseVscodeReporter: true })
    expect(draft?.recordingUnavailable).toBe(false)
    // The facts and the two records the builder keeps; the three it drops
    // (unknown kind, extra field, outside frame) list no item.
    expect(draft?.items).toEqual([
      { kind: 'facts', label: 'Support Facts' },
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
    // The preview is exactly what the builder makes from the same inputs:
    // the two carried records, the journal's three drops beside them, and
    // the reported event marked.
    const input: ProblemReportInput = {
      description: '',
      includeFacts: true,
      includeEvents: true,
      facts: enrichProblemReportFacts(FACTS, EVENTS),
      events: [EVENTS[0], EVENTS[1]],
      recordingUnavailable: false,
      reportedKind: 'backendExit',
      droppedEvents: { invalid: 3, tooOld: 0, overCap: 0 },
      nowMs: NOW_MS,
      scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
    }
    const sealed = buildProblemReportDraft(input)
    expect(draft?.title).toBe(sealed.title)
    expect(draft?.text).toBe(sealed.text)
    expect(draft?.text).toContain('Recent events (2):')
    // The same facts for the same state: no panel named, the backend
    // unresolved for want of a key, and nothing able to connect.
    expect(draft?.text).toContain('panel: not recorded')
    expect(draft?.text).toContain('backend resolution: noneNoKey')
    expect(draft?.connectHint).toBe(true)
    expect(
      isSealedDraftCurrent({
        title: draft?.title ?? '',
        text: draft?.text ?? '',
        hash: draft?.hash ?? '',
      }),
    ).toBe(true)
  })

  it('numbers each open as a new session', async () => {
    const { captured, handle } = await openDialog()
    await handle({ type: 'openReport' })
    expect(draftsOf(captured.posted).map((draft) => draft.session)).toEqual([1, 2])
  })

  it('carries the panel state and offers help when nothing can connect', async () => {
    const { captured, handle } = await openDialog(
      validSource({
        readFacts: () =>
          Promise.resolve({
            ...FACTS,
            cliFound: true,
            cliSignIn: false,
            hasStoredApiKey: false,
            hasEnvironmentApiKey: false,
          }),
      }),
    )
    await handle({ type: 'openReport', panelState: 'landingSignedOut' })
    const draft = draftsOf(captured.posted)[1]
    expect(draft?.text).toContain('panel: landingSignedOut')
    expect(draft?.text).toContain('backend resolution: noneNoKey')
    expect(draft?.connectHint).toBe(true)
  })

  it('tells the dialog the wait is over when the builder refuses the facts', async () => {
    const { deps, captured } = makeDeps({
      source: validSource({
        // Off-allowlist facts: the real builder refuses with ReportBuildError.
        readFacts: () => Promise.resolve({}),
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    // No draft, but the dialog's wait is over: the failure notice fired and
    // the reportFailed message clears the working state.
    expect(draftsOf(captured.posted)).toHaveLength(0)
    expect(captured.posted).toEqual([{ type: 'reportFailed' }])
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report rebuild failed'))).toBe(
      true,
    )
    expect(captured.logLines.some((line) => line.includes('ReportBuildError'))).toBe(true)
  })

  it('opens with unknown facts when the facts read threw, logging its class only', async () => {
    const { deps, captured } = makeDeps({
      source: validSource({
        // A real refusal whose message names a path: the system's own ENOENT.
        readFacts: async () => {
          await readFile(path.join(path.sep, 'home', 'someone', 'secret'), 'utf8')
          return FACTS
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    // A facts read that throws unknowns every fact instead of losing the
    // report: the dialog still opens.
    await handle({ type: 'openReport' })
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toContain('extension: unknown')
    expect(drafts[0]?.text).toContain('platform: unknown')
    expect(captured.notices).toEqual([])
    expect(captured.logLines.join('\n')).toContain('problem report facts unavailable (Error)')
    expect(captured.logLines.join('\n')).not.toContain('someone')
  })

  it('opens without events when the journal read threw', async () => {
    const { captured } = await openDialog(
      validSource({
        // A real refusal: the journal read fails with a genuine ENOENT.
        readJournal: async () => {
          await readFile(MISSING, 'utf8')
          return { entries: [], recordingUnavailable: false }
        },
      }),
    )
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toContain('event recording was unavailable (unknown)')
    expect(captured.logLines.join('\n')).toContain('problem report journal unavailable (Error)')
    expect(captured.logLines.join('\n')).not.toContain('report-problem-never-written')
  })

  it('opens without the reporter button when its check threw', async () => {
    const { captured } = await openDialog(
      validSource({
        canUseVscodeReporter: async () => {
          await readFile(MISSING, 'utf8')
          return true
        },
      }),
    )
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.canUseVscodeReporter).toBe(false)
  })

  it('lists no more items than the draft carries, within the transport bound (RVM93W 5)', async () => {
    const many = Array.from({ length: REPORT_RECENT_EVENT_COUNT + 1 }, (_, index) => ({
      kind: 'backendExit',
      code: 'unknown',
      frames: [],
      ageMs: (REPORT_RECENT_EVENT_COUNT + 1 - index) * 1000,
    }))
    const { captured } = await openDialog(
      validSource({
        readJournal: () => Promise.resolve({ entries: many, recordingUnavailable: false }),
      }),
    )
    const draft = draftsOf(captured.posted)[0]
    // The facts plus the last 50 records: index 0 (the oldest) is not carried.
    expect(draft?.items).toHaveLength(REPORT_RECENT_EVENT_COUNT + 1)
    expect(draft?.items.some((item) => item.eventIndex === 0)).toBe(false)
    expect(draft?.text).toContain(`Recent events (${String(REPORT_RECENT_EVENT_COUNT)}):`)
    // The host's message is one the webview accepts.
    expect(parseHostToWebviewMessage(draft).ok).toBe(true)
  })

  it('lists no record while recent events are left out (RVM93W 5)', async () => {
    const { captured, handle } = await openDialog(eventsSource())
    await handle({
      type: 'updateReport',
      revision: 1,
      description: '',
      includeFacts: true,
      includeEvents: false,
      removedEventIndexes: [],
    })
    const draft = draftsOf(captured.posted)[1]
    expect(draft?.items).toEqual([{ kind: 'facts', label: 'Support Facts' }])
    expect(draft?.text).not.toContain('Recent events')
  })

  it('labels ages in the installed language while the draft stays English (RVM93W 10)', async () => {
    const japanese = { ...EN, reportEventItem: '{kind}・{age}', reportFactsItem: 'サポート情報' }
    setUiText(japanese, 'ja')
    try {
      const { captured } = await openDialog(eventsSource())
      const draft = draftsOf(captured.posted)[0]
      expect(draft?.items[0]?.label).toBe('サポート情報')
      expect(draft?.items[1]?.label).toBe(
        fill(japanese.reportEventItem, { kind: 'toolCallFailed', age: age(45, 'second') }),
      )
      expect(draft?.items[1]?.label).not.toContain('45s ago')
      expect(draft?.text).toContain('- 45s ago toolCallFailed TypeError')
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('waits for the reported write before the snapshot, bounded', async () => {
    const gate = Promise.withResolvers<undefined>()
    const seen = { hasWritten: false, hasFlushStarted: false }
    const source = eventsSource({
      readJournal: () => {
        seen.hasWritten = true
        return Promise.resolve({ entries: EVENTS, recordingUnavailable: false })
      },
      flushJournal: () => {
        seen.hasFlushStarted = true
        return gate.promise
      },
    })
    const { deps, captured } = makeDeps({ source })
    const { handle } = createReportProblemHandler(deps)
    const opened = handle({ type: 'openReport', ref: { kind: 'backendExit', entryIndex: 7 } })
    // The snapshot waits for the write: the journal is untouched until the
    // write lands.
    for (let waited = 0; waited < 1000 && !seen.hasFlushStarted; waited += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(seen.hasFlushStarted).toBe(true)
    expect(seen.hasWritten).toBe(false)
    gate.resolve(undefined)
    await opened
    expect(seen.hasWritten).toBe(true)
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toContain('Reported event: backendExit ECONNRESET (2m ago)')
  })

  it('rebuilds on every change and echoes the choice it answers', async () => {
    const { captured, handle } = await openDialog(eventsSource())
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
    const drafts = draftsOf(captured.posted)
    expect(drafts.map((draft) => [draft.session, draft.revision])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
    ])
    expect(drafts[1]?.text).toContain('The panel went blank.')
    // A rebuild that builds marks no failure and tells nobody.
    expect(drafts[1]?.rebuildFailed).not.toBe(true)
    expect(captured.notices).toEqual([])
    // The facts section and the first event are gone from text and items.
    expect(drafts[2]?.text).not.toContain('Support Facts:')
    expect(drafts[2]?.text).not.toContain('toolCallFailed')
    expect(drafts[2]?.text).toContain('backendExit')
    expect(drafts[2]?.items.map((item) => item.eventIndex)).toEqual([1])
    // Removing a record changes the draft; its item goes with it.
    expect(drafts[2]?.hash).not.toBe(drafts[1]?.hash)
  })

  it('answers a refused reporter open in fixed words and records it', async () => {
    const { handle, hash, captured } = await openForExport({
      io: workingIo({
        // A real refusal: the reporter open fails with a genuine ENOENT.
        openIssueReporter: async () => {
          await readFile(MISSING, 'utf8')
        },
      }),
    })
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash })
    const answer = captured.posted[1]
    expect(answer).toMatchObject({ type: 'reportExported', ok: false, reason: 'reporterFailed' })
    expect(
      captured.logLines.some((line) => line.includes('Report export (vscodeReporter) failed')),
    ).toBe(true)
  })

  it('tells the dialog and records the kind when the export scrub fails', async () => {
    // The open scrubs the title and the text; the export scrubs them again.
    // The scrub holds for the open's two calls, then fails for real with a
    // genuine ENOENT, reaching the export's own failure path.
    let scrubs = 0
    const { handle, hash, captured } = await openForExport({
      vaultScrub: {
        scrub: async (text: string) => {
          scrubs += 1
          if (scrubs > 2) {
            await readFile(MISSING, 'utf8')
          }
          return text
        },
      },
    })
    await handle({ type: 'exportReport', via: 'copy', hash })
    expect(captured.posted).toHaveLength(1)
    expect(captured.notices).toEqual([UI_TEXT.actionFailed])
    expect(captured.logLines.some((line) => line.includes('problem report scrub failed'))).toBe(
      true,
    )
  })

  it('copies exactly the previewed draft, and names the draft it answers', async () => {
    const copied: string[] = []
    const { handle, hash, captured } = await openForExport({
      io: workingIo({
        writeClipboard: (text) => {
          copied.push(text)
          return Promise.resolve(undefined)
        },
      }),
    })
    const draft = draftsOf(captured.posted)[0]
    await handle({ type: 'exportReport', via: 'copy', hash })
    expect(copied).toEqual([draft?.text])
    expect(exportedOf(captured.posted)).toEqual([answerFor(draft, { via: 'copy', ok: true })])
  })

  it('answers an export for the draft it exported, not the one shown later (RVM93W 7)', async () => {
    const held = Promise.withResolvers<undefined>()
    const { deps, captured } = makeDeps({
      io: workingIo({
        writeClipboard: () => held.promise,
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const first = draftsOf(captured.posted)[0]
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
    const second = draftsOf(captured.posted)[1]
    expect(second?.hash).not.toBe(first?.hash)
    // The answer names the copied draft's seal: the webview drops it, since
    // the dialog now shows the second draft.
    expect(exportedOf(captured.posted)).toEqual([answerFor(first, { via: 'copy', ok: true })])
  })

  it('refuses a stale seal with no side effect and re-previews instead', async () => {
    const copied: string[] = []
    const { deps, captured } = makeDeps({
      io: workingIo({
        writeClipboard: (text) => {
          copied.push(text)
          return Promise.resolve(undefined)
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    await handle({ type: 'exportReport', via: 'copy', hash: 'f'.repeat(64) })
    expect(copied).toEqual([])
    const drafts = draftsOf(captured.posted)
    expect(drafts).toHaveLength(2)
    expect(drafts[1]).toEqual(drafts[0])
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(drafts[1], { via: 'copy', ok: false, reason: 'stale' }),
    ])
  })

  it('states a refused clipboard and a cancelled save plainly', async () => {
    const { deps, captured } = makeDeps({
      io: workingIo({
        writeClipboard: async () => {
          await readFile(MISSING, 'utf8')
        },
        saveText: () => Promise.resolve(false),
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = draftsOf(captured.posted)[0]
    const hash = draft?.hash ?? ''
    await handle({ type: 'exportReport', via: 'copy', hash })
    await handle({ type: 'exportReport', via: 'save', hash })
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'copy', ok: false, reason: 'copyFailed' }),
      answerFor(draft, { via: 'save', ok: false, reason: 'cancelled' }),
    ])
  })

  it('opens the prefilled issue page, and copies when the page runs over-long', async () => {
    const opened: string[] = []
    const copied: string[] = []
    const { deps, captured } = makeDeps({
      io: workingIo({
        writeClipboard: (text) => {
          copied.push(text)
          return Promise.resolve(undefined)
        },
        openExternal: (url) => {
          opened.push(url)
          return Promise.resolve(true)
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const short = draftsOf(captured.posted)[0]
    await handle({ type: 'exportReport', via: 'issue', hash: short?.hash ?? '' })
    expect(String(opened[0])).toContain('issues/new?title=')
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(short, { via: 'issue', ok: true, issueFallback: false }),
    ])
    // A draft past the encoded-URL cap is copied instead, and the unfilled
    // form opens with the paste instruction.
    await handle({
      type: 'updateReport',
      revision: 1,
      description: 'x'.repeat(REPORT_DESCRIPTION_MAX_CHARS),
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    const long = draftsOf(captured.posted)[1]
    await handle({ type: 'exportReport', via: 'issue', hash: long?.hash ?? '' })
    expect(copied).toEqual([long?.text])
    expect(String(opened[1])).not.toContain('issues/new?title=')
    expect(exportedOf(captured.posted)[1]).toEqual(
      answerFor(long, { via: 'issue', ok: true, issueFallback: true }),
    )
  })

  it('files the issue page and the reporter with an empty description', async () => {
    // No description is refused anywhere: the host never gates an export on
    // one (D121/D208), and the dialog's hint list guides instead.
    const opened: string[] = []
    const reported: unknown[] = []
    const { deps, captured } = makeDeps({
      io: workingIo({
        openExternal: (url) => {
          opened.push(url)
          return Promise.resolve(true)
        },
        openIssueReporter: (prefill) => {
          reported.push(prefill)
          return Promise.resolve(undefined)
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = draftsOf(captured.posted)[0]
    expect(draft?.description).toBe('')
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash: draft?.hash ?? '' })
    expect(opened).toHaveLength(1)
    expect(reported).toHaveLength(1)
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'issue', ok: true, issueFallback: false }),
      answerFor(draft, { via: 'vscodeReporter', ok: true }),
    ])
  })

  it('answers a browser that refused or threw in a fixed word (RVM93W 8)', async () => {
    let calls = 0
    const { deps, captured } = makeDeps({
      io: workingIo({
        // The first call fails for real, with a message that names a path;
        // the second is a browser that answers it did not open.
        openExternal: async () => {
          calls += 1
          if (calls === 1) {
            await readFile(path.join(path.sep, 'home', 'someone', 'browser'), 'utf8')
          }
          return false
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = draftsOf(captured.posted)[0]
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    await handle({ type: 'exportReport', via: 'issue', hash: draft?.hash ?? '' })
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'issue', ok: false, reason: 'openFailed' }),
      answerFor(draft, { via: 'issue', ok: false, reason: 'openFailed' }),
    ])
    expect(JSON.stringify(captured.posted)).not.toContain('someone')
  })

  it('answers an export path that threw instead of leaving the dialog waiting', async () => {
    const { handle, hash, captured } = await openForExport({
      io: workingIo({
        // A real failure: the save fails with a genuine ENOENT.
        saveText: async () => {
          await readFile(MISSING, 'utf8')
          return true
        },
      }),
    })
    const draft = draftsOf(captured.posted)[0]
    await handle({ type: 'exportReport', via: 'save', hash })
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'save', ok: false, reason: 'saveFailed' }),
    ])
    expect(JSON.stringify(captured.posted)).not.toContain('report-problem-never-written')
  })

  it('uses the VS Code reporter with the supported fields only', async () => {
    const reported: unknown[] = []
    const { handle, hash, captured } = await openForExport({
      io: workingIo({
        openIssueReporter: (prefill) => {
          reported.push(prefill)
          return Promise.resolve(undefined)
        },
      }),
    })
    const draft = draftsOf(captured.posted)[0]
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash })
    expect(reported).toEqual([
      {
        extensionId: EXTENSION_QUALIFIED_ID,
        issueTitle: draft?.title,
        issueBody: draft?.text,
      },
    ])
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'vscodeReporter', ok: true }),
    ])
  })

  it('states a failed reporter launch and hides its action when the command is missing', async () => {
    const { deps, captured } = makeDeps({
      source: validSource({ canUseVscodeReporter: () => Promise.resolve(false) }),
      io: workingIo({
        openIssueReporter: async () => {
          await readFile(MISSING, 'utf8')
        },
      }),
    })
    const { handle } = createReportProblemHandler(deps)
    await handle({ type: 'openReport' })
    const draft = draftsOf(captured.posted)[0]
    expect(draft?.canUseVscodeReporter).toBe(false)
    await handle({ type: 'exportReport', via: 'vscodeReporter', hash: draft?.hash ?? '' })
    expect(exportedOf(captured.posted)).toEqual([
      answerFor(draft, { via: 'vscodeReporter', ok: false, reason: 'reporterFailed' }),
    ])
  })

  it('forwards the scrubbed webview failure to its sink, with no raw text', async () => {
    const received: unknown[] = []
    const { deps } = makeDeps({
      onReportWebviewError: (error) => {
        received.push(error)
      },
    })
    const { handle } = createReportProblemHandler(deps)
    let thrown: unknown
    try {
      throw new TypeError('secret-looking prompt text sk-1234')
    } catch (error: unknown) {
      thrown = error
    }
    await handle(
      reportWebviewErrorMessage('reactBoundary', 'render', thrown, 'https://test.invalid/main.js'),
    )
    expect(received).toHaveLength(1)
    const [first] = received
    expect(first).toMatchObject({
      type: 'reportWebviewError',
      kind: 'reactBoundary',
      source: 'render',
      code: 'TypeError',
    })
    expect(JSON.stringify(first)).not.toContain('secret-looking')
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
      reportWebviewErrorMessage('windowError', 'window', new Error('kept out'), 'test-script-url'),
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
