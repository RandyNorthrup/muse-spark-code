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

import * as vscode from 'vscode'
import {
  buildProblemReportDraft,
  isSealedDraftCurrent,
  ReportBuildError,
  reportAge,
  selectProblemReportEvents,
  type ReportScrubContext,
  type SealedReportDraft,
  type SelectedReportEvent,
} from '../../core/support/problemReport'
import { EXTENSION_QUALIFIED_ID, UI_TEXT } from '../../shared/constants'
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
  type ReportExportOutcome,
} from '../support/reportProblem'

/** The stored fact records a dialog session builds from, oldest first. */
export interface ReportJournalSource {
  readonly entries: readonly unknown[]
  /** The recorder could not run or read: the report says so instead of carrying events. */
  readonly recordingUnavailable: boolean
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
}

export interface ReportProblemHandlerDeps {
  /** Posts to the surface that owns this dialog session. */
  readonly post: (message: HostToWebviewMessage) => void
  /** Says a build failure in the panel (the log already has the detail). */
  readonly noticeError: (text: string) => void
  readonly log: Logger
  /** Absent where no recorder could be wired; opening then says it did not work. */
  readonly source: ReportDataSource | undefined
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

// VS Code 1.99's prefill for its own issue reporter (D72): the supported
// body/title fields only. `data` is deliberately never passed: it is absent
// from the documented option schema.
const VSCODE_ISSUE_REPORTER_COMMAND = 'workbench.action.openIssueReporter'

/** What an export that threw reads as, per channel: a fixed word, never the error. */
const THROWN_EXPORT_REASON: Readonly<Record<ReportExportChannel, ReportExportReason>> = {
  copy: 'copyFailed',
  issue: 'openFailed',
  save: 'saveFailed',
  vscodeReporter: 'reporterFailed',
}

type ExportAnswer =
  ReportExportOutcome | { readonly ok: false; readonly reason: ReportExportReason }

/** The VS Code issue reporter after our preview (D72): supported fields only, never `data`. */
async function openVscodeReporter(draft: SealedReportDraft): Promise<ExportAnswer> {
  try {
    await vscode.commands.executeCommand(VSCODE_ISSUE_REPORTER_COMMAND, {
      extensionId: EXTENSION_QUALIFIED_ID,
      issueTitle: draft.title,
      issueBody: draft.text,
    })
  } catch {
    return { ok: false, reason: 'reporterFailed' }
  }
  return { ok: true }
}

/** The snapshot one dialog builds from: facts, the selected records, scrub and clock, frozen at open. */
interface ReportData {
  readonly facts: unknown
  /** The records the draft can carry: the builder's validated, capped selection. */
  readonly events: readonly SelectedReportEvent[]
  readonly scrub: ReportScrubContext
  readonly nowMs: number
  readonly isRecordingUnavailable: boolean
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
 * One place builds the builder's input from a snapshot and a choice (open,
 * update, stale re-preview): the preview always matches the sealed draft.
 */
function buildChoiceDraft(data: ReportData, choice: ReportChoice): SealedReportDraft {
  return buildProblemReportDraft({
    description: choice.description,
    includeFacts: choice.isFactsIncluded,
    includeEvents: choice.isEventsIncluded,
    facts: data.facts,
    events: keptEvents(data, choice).map((selected) => selected.event),
    recordingUnavailable: data.isRecordingUnavailable,
    nowMs: data.nowMs,
    scrub: data.scrub,
  })
}

/** An item's age in the installed language (the draft itself stays English, like its headings). */
function localizedAge(ageMs: number): string {
  const age = reportAge(ageMs)
  return formatRelativeTime(-age.value, age.unit)
}

/**
 * One removable row per included section and per record the draft carries:
 * exactly the builder's selection, never a record it would skip. Labels
 * carry a fixed kind and a relative age only, never a code or a path.
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
}

function reportDraftMessage(current: ReportSession): HostToWebviewMessage {
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

/** One dialog's snapshot: the facts, the selected records, the scrub context and the clock. */
async function snapshot(source: ReportDataSource): Promise<ReportData> {
  const facts = await source.readFacts()
  const journal = await source.readJournal()
  const canUseVscodeReporter = await source.canUseVscodeReporter()
  return {
    facts,
    events: selectProblemReportEvents(journal.entries),
    scrub: source.readScrub(),
    nowMs: source.nowMs(),
    isRecordingUnavailable: journal.recordingUnavailable,
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
  function rebuild(data: ReportData, choice: ReportChoice): SealedReportDraft | undefined {
    try {
      return buildChoiceDraft(data, choice)
    } catch (error: unknown) {
      buildFails(error)
      return undefined
    }
  }

  async function open(ref: ReportEventRef | undefined): Promise<void> {
    if (deps.source === undefined) {
      deps.log.warn('Report a problem has no flight recorder in this window')
      deps.noticeError(UI_TEXT.actionFailed)
      return
    }
    sessionCount += 1
    const id = sessionCount
    session = undefined
    if (ref !== undefined) {
      deps.log.info(`Report opened from a recorded ${ref.kind}`)
    }
    let data: ReportData
    try {
      data = await snapshot(deps.source)
    } catch (error: unknown) {
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
    const draft = rebuild(data, choice)
    if (draft === undefined) {
      return
    }
    const current: ReportSession = { id, data, choice, draft }
    session = current
    deps.post(reportDraftMessage(current))
  }

  function update(message: Extract<WebviewToHostMessage, { type: 'updateReport' }>): void {
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
    const draft = rebuild(current.data, choice)
    if (draft === undefined) {
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
          return await copyProblemReport(draft)
        }
        case 'issue': {
          return await openProblemReportIssue(draft)
        }
        case 'save': {
          return await saveProblemReport(draft)
        }
        case 'vscodeReporter': {
          return await openVscodeReporter(draft)
        }
      }
    } catch (error: unknown) {
      // An export path that threw still answers the dialog, in a fixed word.
      deps.log.warn(`Report export (${via}) failed (${failureClass(error)})`)
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
    const answer = await run(message.via, current.draft)
    deps.post(exportedMessage(current, message.via, answer))
  }

  return {
    async handle(message: ReportProblemMessage): Promise<void> {
      switch (message.type) {
        case 'openReport': {
          await open(message.ref)
          break
        }
        case 'updateReport': {
          update(message)
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
