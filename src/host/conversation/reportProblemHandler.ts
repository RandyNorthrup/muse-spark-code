import type { SecretScrubPort } from '../../shared/redact'
// The report-only message handler (M93, PLAN.md D72). It owns the preview
// dialog's side of the conversation: opening, rebuilding and exporting the
// sealed draft. The dialog shows only what the host builds here; the webview
// sends back choices and bounded identifiers, never report content or raw
// error text. Every export goes through the export paths with the seal of
// the draft on screen, so any change since the preview refuses instead of
// sending stale words.
//
// The journal and the facts come through `ReportDataSource`, which the
// activation wires to the flight recorder and the local facts. A dialog
// session snapshots both at open: the records the draft can carry are
// selected once (the builder's own validation and cap), removals name those
// records' indexes, and later appends cannot shift what the preview lists
// while it is open. Each session has its own number and each draft answers
// one of the dialog's choices (its revision), so a late reply is told apart
// from the current one on the webview's side.
//
// Every source read has its own bound (lane REPORTFLOW R2): a source that
// throws or does not answer in REPORT_SNAPSHOT_TIMEOUT_MS becomes the word
// `unknown` for its facts (or an empty journal with its reason), and the
// report still opens. The whole snapshot shares that deadline.

import {
  buildVaultProblemReportDraft,
  enrichProblemReportFacts,
  isSealedDraftCurrent,
  sealReportDraft,
  ReportBuildError,
  problemReportEventSelection,
  reportAge,
  type ReportEventDropCounts,
  type ReportScrubContext,
  type SealedReportDraft,
  type SelectedReportEvent,
} from '../../core/support/problemReport'
import { failureForLog } from '../../core/backends/musecode/logText'
import { shouldShowConnectHint } from '../../core/support/reportContext'
import {
  EXTENSION_QUALIFIED_ID,
  REPORT_JOURNAL_FLUSH_TIMEOUT_MS,
  REPORT_SNAPSHOT_TIMEOUT_MS,
  REPORT_UNKNOWN_ERROR_CODE,
  UI_TEXT,
  type ReportPanelState,
} from '../../shared/constants'
import type { ReportEventKind } from '../../shared/constants'
import {
  readBounded,
  reportError,
  ReportTimeoutError,
  withReportTimeout,
} from '../support/reportTimeout'
import { fill, formatRelativeTime } from '../../shared/l10n/text'
import type {
  HostToWebviewMessage,
  ReportDraftItem,
  ReportEventRef,
  ReportExportChannel,
  ReportExportReason,
  ReportWebviewError,
  WebviewToHostMessage,
} from '../../shared/protocol'
import type { Logger } from '../logger'
import {
  copyProblemReport,
  openProblemReportIssue,
  saveProblemReport,
  type ReportEditorIo,
  type ReportExportOutcome,
} from '../support/reportProblem'

/** The stored fact records a dialog session builds from, oldest first. */
export interface ReportJournalSource {
  readonly entries: readonly unknown[]
  /** The recorder could not run or read: the report says so instead of carrying events. */
  readonly recordingUnavailable: boolean
  /**
  Why recording is unavailable, in the recorder's vocabulary (lane
  REPORTFLOW R2): `unknown` until the capture side provides its reason.
  */
  readonly unavailableReason?: string
  /** Records the minute's budget dropped before the journal (lane REPORTFLOW R2). */
  readonly rateLimitedDrops?: number
}

/** Where the dialog's facts, journal and scrub context come from (wired at activation). */
export interface ReportDataSource {
  /** Allowlisted support facts for the builder; gathered locally, nothing started. */
  readFacts(): Promise<unknown>
  readJournal(): Promise<ReportJournalSource>
  /** Roots, home and names for the second scrub. */
  readScrub(): ReportScrubContext
  /** The epoch the relative ages render against. */
  nowMs(): number
  /** Whether the VS Code issue-reporter command exists for the reporter action. */
  canUseVscodeReporter(): Promise<boolean>
  /**
  Waits for queued journal writes to land, up to `timeoutMs` (lane
  REPORTFLOW R2): "Report This" waits for its event before the snapshot.
  Absent where the recorder has no queue; never throws for a slow journal.
  */
  flushJournal?: (timeoutMs: number) => Promise<void>
}

export interface ReportProblemHandlerDeps {
  readonly vaultScrub?: SecretScrubPort
  /** Posts to the surface that owns this dialog session. */
  readonly post: (message: HostToWebviewMessage) => void
  /** Says a build failure in the panel (the log already has the detail). */
  readonly noticeError: (text: string) => void
  readonly log: Logger
  readonly source: ReportDataSource
  /** The editor's clipboard, browser, save picker and issue reporter (reportEditorIo.ts in VS Code). */
  readonly io: ReportEditorIo
  /** The scrubbed webview failure goes here: the flight recorder's journal. */
  readonly onReportWebviewError: (error: ReportWebviewError) => void
}

export type ReportProblemMessage = Extract<
  WebviewToHostMessage,
  | { type: 'openReport' }
  | { type: 'updateReport' }
  | { type: 'exportReport' }
  | { type: 'reportWebviewError' }
>

/** What an export that threw reads as, per channel: a fixed word, never the error. */
const THROWN_EXPORT_REASON: Readonly<Record<ReportExportChannel, ReportExportReason>> = {
  copy: 'copyFailed',
  issue: 'openFailed',
  save: 'saveFailed',
  vscodeReporter: 'reporterFailed',
}

type ExportAnswer =
  ReportExportOutcome | { readonly ok: false; readonly reason: ReportExportReason }

/**
The VS Code issue reporter after our preview (D72): supported fields only,
never `data`. A refused open throws to `run`, which answers the dialog in
its fixed word and records the failure's kind.
*/
async function openVscodeReporter(
  draft: SealedReportDraft,
  io: ReportEditorIo,
): Promise<ExportAnswer> {
  await io.openIssueReporter({
    extensionId: EXTENSION_QUALIFIED_ID,
    issueTitle: draft.title,
    issueBody: draft.text,
  })
  return { ok: true }
}

/** The snapshot one dialog builds from: facts, the selected records, scrub and clock, frozen at open. */
interface ReportData {
  readonly facts: unknown
  /** The records the draft can carry: the builder's validated, capped selection. */
  readonly events: readonly SelectedReportEvent[]
  /** What the journal left out: the draft counts it beside the carried events. */
  readonly dropped: ReportEventDropCounts
  readonly scrub: ReportScrubContext
  readonly nowMs: number
  readonly isRecordingUnavailable: boolean
  /** Why recording is unavailable, in the recorder's vocabulary. */
  readonly recordingReason: string | undefined
  /** Records the minute's budget dropped before the journal. */
  readonly rateLimitedDrops: number
  readonly canUseVscodeReporter: boolean
}

/** The dialog's whole choice: what the preview builds and the export seals. */
interface ReportChoice {
  /** The dialog's count of choices this answers; 0 is the opening draft. */
  readonly revision: number
  readonly description: string
  readonly isFactsIncluded: boolean
  readonly isEventsIncluded: boolean
  readonly removed: ReadonlySet<number>
}

/** The records a choice keeps: the selection minus what the user removed. */
function keptEvents(data: ReportData, choice: ReportChoice): readonly SelectedReportEvent[] {
  return data.events.filter((selected) => !choice.removed.has(selected.index))
}

/**
One place builds the builder's input from a snapshot and a choice (open,
update, stale re-preview): the preview always matches the sealed draft.
*/
async function buildChoiceDraft(
  data: ReportData,
  choice: ReportChoice,
  reportedKind: ReportEventKind | undefined,
  vaultScrub?: SecretScrubPort,
): Promise<SealedReportDraft> {
  // The builder sees exactly the listed records minus what the user removed,
  // plus the left-out counts taken at selection: removing a listed record
  // never pulls an older, unlisted one into the draft, and the preview
  // matches the sealed draft byte for byte.
  return await buildVaultProblemReportDraft(
    {
      description: choice.description,
      includeFacts: choice.isFactsIncluded,
      includeEvents: choice.isEventsIncluded,
      facts: data.facts,
      events: keptEvents(data, choice).map((selected) => selected.event),
      recordingUnavailable: data.isRecordingUnavailable,
      ...(data.recordingReason !== undefined && { recordingReason: data.recordingReason }),
      ...(reportedKind !== undefined && { reportedKind }),
      rateLimitedDrops: data.rateLimitedDrops,
      droppedEvents: data.dropped,
      nowMs: data.nowMs,
      scrub: data.scrub,
    },
    vaultScrub,
  )
}

/** An item's age in the installed language (the draft itself stays English, like its headings). */
function localizedAge(ageMs: number): string {
  const age = reportAge(ageMs)
  return formatRelativeTime(-age.value, age.unit)
}

/**
One removable row per included section and per record the draft carries:
exactly the builder's selection, never a record it would skip. Labels
carry a fixed kind and a relative age only, never a code or a path.
*/
function draftItems(data: ReportData, choice: ReportChoice): ReportDraftItem[] {
  const items: ReportDraftItem[] = []
  if (choice.isFactsIncluded) {
    items.push({ kind: 'facts', label: UI_TEXT.reportFactsItem })
  }
  if (!choice.isEventsIncluded || data.isRecordingUnavailable) {
    return items
  }
  for (const selected of keptEvents(data, choice)) {
    items.push({
      kind: 'event',
      eventIndex: selected.index,
      label: fill(UI_TEXT.reportEventItem, {
        kind: selected.event.kind,
        age: localizedAge(selected.event.ageMs),
      }),
    })
  }
  return items
}

interface ReportSession {
  readonly id: number
  readonly data: ReportData
  readonly choice: ReportChoice
  readonly draft: SealedReportDraft
  /** Which recorded event the person meant (the open's handoff kind, if any). */
  readonly reportedKind: ReportEventKind | undefined
}

function reportDraftMessage(current: ReportSession, isRebuildFailed = false): HostToWebviewMessage {
  return {
    type: 'reportDraft',
    session: current.id,
    revision: current.choice.revision,
    description: current.choice.description,
    includeFacts: current.choice.isFactsIncluded,
    includeEvents: current.choice.isEventsIncluded,
    items: draftItems(current.data, current.choice),
    title: current.draft.title,
    text: current.draft.text,
    hash: current.draft.hash,
    canUseVscodeReporter: current.data.canUseVscodeReporter,
    recordingUnavailable: current.data.isRecordingUnavailable,
    connectHint: shouldShowConnectHint(current.data.facts),
    ...(isRebuildFailed && { rebuildFailed: true }),
  }
}

function exportedMessage(
  current: ReportSession,
  via: ReportExportChannel,
  answer: ExportAnswer,
): HostToWebviewMessage {
  return {
    type: 'reportExported',
    session: current.id,
    hash: current.draft.hash,
    via,
    ok: answer.ok,
    ...('isIssueFallback' in answer && { issueFallback: answer.isIssueFallback }),
    ...(!answer.ok && { reason: answer.reason }),
  }
}

/**
The facts when the facts read itself threw or hung (lane REPORTFLOW R2):
every fact unknown, so the report still opens. The failure is logged where
it happened; the draft carries no reason for a read that never answered.
*/
const UNKNOWN_SNAPSHOT_FACTS = {
  extensionVersion: REPORT_UNKNOWN_ERROR_CODE,
  nodeVersion: REPORT_UNKNOWN_ERROR_CODE,
} as const

/** The scrub context when even the local reads fail: nothing to stand in for. */
const EMPTY_SCRUB: ReportScrubContext = {
  workspaceRoots: [],
  homeDir: '',
  extraLiterals: [],
}

/** One dialog's snapshot: the facts, the selected records, the scrub context and the clock. */
async function snapshot(
  source: ReportDataSource,
  panelState: ReportPanelState | undefined,
  log: Logger,
): Promise<ReportData> {
  // A read that threw or hung keeps the report: facts unknown, the journal
  // unavailable, the reporter button hidden. The log keeps the fixed reason.
  const [facts, journal, canUseVscodeReporter] = await Promise.all([
    readBounded<unknown>(
      log,
      'facts',
      () => source.readFacts(),
      REPORT_SNAPSHOT_TIMEOUT_MS,
      UNKNOWN_SNAPSHOT_FACTS,
    ),
    readBounded<ReportJournalSource>(
      log,
      'journal',
      () => source.readJournal(),
      REPORT_SNAPSHOT_TIMEOUT_MS,
      { entries: [], recordingUnavailable: true, unavailableReason: 'unknown' },
    ),
    readBounded(
      log,
      'reporter check',
      () => source.canUseVscodeReporter(),
      REPORT_SNAPSHOT_TIMEOUT_MS,
      false,
    ),
  ])
  let scrub: ReportScrubContext
  let nowMs: number
  try {
    scrub = source.readScrub()
    nowMs = source.nowMs()
  } catch (error: unknown) {
    reportError(log, 'clock or scrub unavailable', error)
    scrub = EMPTY_SCRUB
    nowMs = Date.now()
  }
  // The selection once: the preview lists exactly these records while the
  // draft counts what the journal left out (lane REPORTFLOW R2).
  const selection = problemReportEventSelection(journal.entries)
  return {
    // Where the person was, the last notice and sign-in, and how the
    // backend choice resolved (lane REPORTFLOW): the same facts for the
    // same state on every host, validated again by the builder.
    facts: enrichProblemReportFacts(facts, journal.entries, panelState),
    events: selection.events,
    dropped: selection.dropped,
    scrub,
    nowMs,
    isRecordingUnavailable: journal.recordingUnavailable,
    recordingReason: journal.unavailableReason,
    rateLimitedDrops: journal.rateLimitedDrops ?? 0,
    canUseVscodeReporter,
  }
}

/** The class name of a failure, for the log: never its message, which can hold anything. */
function failureClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

/** Creates the report-only message handler for one conversation surface. */
export function createReportProblemHandler(deps: ReportProblemHandlerDeps): {
  handle: (message: ReportProblemMessage) => Promise<void>
} {
  let session: ReportSession | undefined
  let sessionCount = 0
  let revisionCount = 0

  function buildFails(error: unknown): void {
    // ReportBuildError names the field and the reason, never the refused
    // value; anything else is logged by its class name only.
    deps.log.error(
      error instanceof ReportBuildError
        ? error.message
        : `problem report failed (${failureClass(error)})`,
    )
    deps.noticeError(UI_TEXT.actionFailed)
  }

  /** The sealed draft for a snapshot and a choice; undefined when the build refused. */
  async function rebuild(
    data: ReportData,
    choice: ReportChoice,
    reportedKind: ReportEventKind | undefined,
  ): Promise<SealedReportDraft | undefined> {
    try {
      return await buildChoiceDraft(data, choice, reportedKind, deps.vaultScrub)
    } catch (error: unknown) {
      // The record keeps the failure's kind; buildFails below keeps its
      // detail and tells the dialog in fixed words.
      deps.log.error(`problem report rebuild failed: ${failureForLog(error)}`)
      buildFails(error)
      return undefined
    }
  }

  async function open(
    ref: ReportEventRef | undefined,
    panelState?: ReportPanelState,
  ): Promise<void> {
    sessionCount += 1
    const id = sessionCount
    session = undefined
    const reportedKind = ref?.kind
    if (ref !== undefined) {
      deps.log.info(`Report opened from a recorded ${ref.kind}`)
      // The reported event is in the journal before the draft is built
      // (lane REPORTFLOW R2, P3-7): recording is fire-and-forget, so an
      // immediate "Report This" waits for the write first, bounded. Past
      // the bound the draft builds from whatever the journal holds. The
      // bound is enforced here, not by the journal: a hanging flush never
      // hangs the dialog.
      try {
        await withReportTimeout(
          deps.source.flushJournal?.(REPORT_JOURNAL_FLUSH_TIMEOUT_MS) ?? Promise.resolve(),
          REPORT_JOURNAL_FLUSH_TIMEOUT_MS,
        )
      } catch (error: unknown) {
        if (error instanceof ReportTimeoutError) {
          // The bounded wait's own timeout is expected: the journal's
          // state speaks, and unavailable reads as unavailable.
        } else {
          // A flush that failed for another reason is logged; the draft
          // still builds from whatever the journal holds.
          reportError(deps.log, 'journal flush failed', error)
        }
      }
    }
    let data: ReportData
    try {
      data = await snapshot(deps.source, panelState, deps.log)
    } catch (error: unknown) {
      // The record keeps the failure's kind; buildFails below keeps its
      // detail and tells the dialog in fixed words.
      deps.log.error(`problem report snapshot failed: ${failureForLog(error)}`)
      buildFails(error)
      return
    }
    if (id !== sessionCount) {
      // A newer open started while this one gathered: that one answers.
      return
    }
    const choice: ReportChoice = {
      revision: 0,
      description: '',
      isFactsIncluded: true,
      isEventsIncluded: true,
      removed: new Set(),
    }
    const draft = await rebuild(data, choice, reportedKind)
    if (draft === undefined) {
      // The build refused: the notice already fired. Tell the dialog its
      // wait is over instead of leaving it working forever.
      deps.post({ type: 'reportFailed' })
      return
    }
    if (id !== sessionCount) {
      return
    }
    const current: ReportSession = { id, data, choice, draft, reportedKind }
    session = current
    deps.post(reportDraftMessage(current))
  }

  async function update(
    message: Extract<WebviewToHostMessage, { type: 'updateReport' }>,
  ): Promise<void> {
    const revision = ++revisionCount
    const current = session
    if (current === undefined) {
      deps.log.warn('Report preview updated with no open dialog')
      return
    }
    const choice: ReportChoice = {
      revision: message.revision,
      description: message.description,
      isFactsIncluded: message.includeFacts,
      isEventsIncluded: message.includeEvents,
      removed: new Set(message.removedEventIndexes),
    }
    // The snapshot open built from, so this cannot refuse where open did not.
    const draft = await rebuild(current.data, choice, current.reportedKind)
    if (session !== current || revision !== revisionCount) {
      return
    }
    if (draft === undefined) {
      // The rebuild refused after open allowed it: the transcript notice
      // already fired, behind the modal. Re-post the last good draft
      // stamped with this revision and marked failed, so the dialog's own
      // status line says the preview could not be updated; what stays on
      // screen is still that previous draft, and the next edit retries the
      // build (RVM109T 5, lane REPORTFLOW R2).
      const settled: ReportSession = {
        ...current,
        choice: { ...current.choice, revision: message.revision },
      }
      deps.post(reportDraftMessage(settled, true))
      return
    }
    const next: ReportSession = { ...current, choice, draft }
    session = next
    deps.post(reportDraftMessage(next))
  }

  async function run(via: ReportExportChannel, draft: SealedReportDraft): Promise<ExportAnswer> {
    try {
      switch (via) {
        case 'copy': {
          return await copyProblemReport(draft, deps.io)
        }
        case 'issue': {
          return await openProblemReportIssue(draft, deps.io)
        }
        case 'save': {
          return await saveProblemReport(draft, deps.io)
        }
        case 'vscodeReporter': {
          return await openVscodeReporter(draft, deps.io)
        }
      }
    } catch (error: unknown) {
      // An export path that threw still answers the dialog, in a fixed word;
      // the record keeps the failure's kind, never its message.
      deps.log.warn(`Report export (${via}) failed: ${failureForLog(error)}`)
      return { ok: false, reason: THROWN_EXPORT_REASON[via] }
    }
  }

  async function exportDraft(
    message: Extract<WebviewToHostMessage, { type: 'exportReport' }>,
  ): Promise<void> {
    const current = session
    if (current === undefined) {
      deps.log.warn('Report exported with no open dialog')
      return
    }
    if (
      !isSealedDraftCurrent({
        title: current.draft.title,
        text: current.draft.text,
        hash: message.hash,
      })
    ) {
      // Any change since the preview: re-preview the current draft and say
      // so beside it; nothing is exported on a broken seal.
      deps.post(reportDraftMessage(current))
      deps.post(exportedMessage(current, message.via, { ok: false, reason: 'stale' }))
      return
    }
    if (deps.vaultScrub !== undefined) {
      const revision = revisionCount
      try {
        const title = await deps.vaultScrub.scrub(current.draft.title)
        const text = await deps.vaultScrub.scrub(current.draft.text)
        if (session !== current || revision !== revisionCount) return
        if (title !== current.draft.title || text !== current.draft.text) {
          const next = { ...current, draft: sealReportDraft(title, text) }
          session = next
          deps.post(reportDraftMessage(next))
          deps.post(exportedMessage(next, message.via, { ok: false, reason: 'stale' }))
          return
        }
      } catch (error: unknown) {
        // The record keeps the failure's kind; buildFails below keeps its
        // detail and tells the dialog in fixed words.
        deps.log.error(`problem report scrub failed: ${failureForLog(error)}`)
        buildFails(error)
        return
      }
    }
    const answer = await run(message.via, current.draft)
    if (session !== current) {
      // The dialog reopened while the export ran: the answer belongs to a
      // draft no longer on screen, so the dialog drops it by session. Say
      // so in the log instead of answering into silence (lane REPORTFLOW
      // R2); the export itself already happened or failed as answered.
      deps.log.warn(`Report export (${message.via}) finished after the dialog reopened`)
    }
    deps.post(exportedMessage(current, message.via, answer))
  }

  return {
    async handle(message: ReportProblemMessage): Promise<void> {
      switch (message.type) {
        case 'openReport': {
          await open(message.ref, message.panelState)
          break
        }
        case 'updateReport': {
          await update(message)
          break
        }
        case 'exportReport': {
          await exportDraft(message)
          break
        }
        case 'reportWebviewError': {
          deps.onReportWebviewError(message)
          break
        }
      }
    },
  }
}
