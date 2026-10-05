// The report-only message handler (M93 lane W, PLAN.md D72). It owns the
// preview dialog's side of the conversation: opening, rebuilding and
// exporting lane P's sealed draft. The dialog shows only what the host
// builds here; the webview sends back choices and bounded identifiers, never
// report content or raw error text. Every export goes through lane P's
// export paths with the seal of the draft on screen, so any change since
// the preview refuses instead of sending stale words.
//
// The journal and the facts come through `ReportDataSource`, which lane I
// wires to the recorder and the activation's gathered facts. Until then the
// controller runs without one, and opening the dialog says plainly that it
// did not work. A dialog session snapshots the journal at open: removals
// name journal indexes, so later appends cannot shift what the preview
// lists while it is open.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import {
  buildProblemReportDraft,
  formatReportAge,
  isSealedDraftCurrent,
  issueLinkForDraft,
  ReportBuildError,
  type ReportScrubContext,
  type SealedReportDraft,
} from '../../core/support/report'
import { EXTENSION_QUALIFIED_ID, REPORT_EVENT_KINDS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
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
} from '../support/reportProblem'

/** The stored fact records a dialog session builds from, oldest first. */
export interface ReportJournalSource {
  readonly entries: readonly unknown[]
  /** The recorder never ran: the report says so instead of carrying events. */
  readonly recordingUnavailable: boolean
}

/** Where the dialog's facts, journal and scrub context come from (wired by lane I). */
export interface ReportDataSource {
  /** Allowlisted support facts for lane P's builder. */
  readFacts(): unknown
  readJournal(): ReportJournalSource
  /** Roots, home and names for lane P's second scrub. */
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
  /** Absent until lane I wires the recorder and the facts. */
  readonly source: ReportDataSource | undefined
  /** The scrubbed webview failure goes here; lane R replaces the log line with the journal. */
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

/**
 * What an item label may show: a fixed kind and a relative age, never a
 * code or a path. A plain object (extras stripped): this reads a subset of
 * the stored record for display only — inclusion stays lane P's build.
 */
const reportItemEventSchema = z.object({
  kind: z.enum(REPORT_EVENT_KINDS),
  ageMs: z.int().check(z.gte(0)),
})

/** The default scrubbed-error sink until lane R wires the journal: one host-log line of identifiers. */
export function logReportWebviewError(log: Logger, error: ReportWebviewError): void {
  log.error(
    `Report webview error (${error.kind}/${error.source}): ${error.code} (${String(error.frames.length)} frames)`,
  )
}

/** The VS Code issue reporter after our preview (D72): supported fields only, never `data`. */
async function openVscodeReporter(
  draft: SealedReportDraft,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: 'reporterFailed' }> {
  try {
    await vscode.commands.executeCommand(VSCODE_ISSUE_REPORTER_COMMAND, {
      extensionId: EXTENSION_QUALIFIED_ID,
      issueTitle: draft.title,
      issueBody: draft.text,
    })
  } catch {
    const message = UI_TEXT.reportVscodeReporterFailed
    await vscode.window.showErrorMessage(message)
    return { ok: false, reason: 'reporterFailed' }
  }
  return { ok: true }
}

/** The snapshot one dialog builds from: facts, journal events, scrub and clock, frozen at open. */
interface ReportData {
  readonly facts: unknown
  readonly events: readonly unknown[]
  readonly scrub: ReportScrubContext
  readonly nowMs: number
}

/** The dialog's whole choice: what the preview builds and the export seals. */
interface ReportChoice {
  readonly description: string
  readonly isFactsIncluded: boolean
  readonly isEventsIncluded: boolean
  readonly removed: ReadonlySet<number>
  readonly isRecordingUnavailable: boolean
}

/**
 * One place builds lane P's input from a snapshot and a choice (open,
 * update, stale rebuild): the preview always matches the sealed draft.
 */
function buildChoiceDraft(data: ReportData, choice: ReportChoice): SealedReportDraft {
  return buildProblemReportDraft({
    description: choice.description,
    includeFacts: choice.isFactsIncluded,
    includeEvents: choice.isEventsIncluded,
    facts: data.facts,
    events: data.events.filter((_, index) => !choice.removed.has(index)),
    recordingUnavailable: choice.isRecordingUnavailable,
    nowMs: data.nowMs,
    scrub: data.scrub,
  })
}

/**
 * One removable row per included section and per labelled event. Labels
 * carry a fixed kind and a relative age only (lane P's `formatReportAge`):
 * records lane P skips still list while their kind parses, and removing
 * one then rebuilds to the same draft. Event identity is the journal index,
 * frozen for the session.
 */
function draftItems(data: ReportData, choice: ReportChoice): ReportDraftItem[] {
  const items: ReportDraftItem[] = []
  if (choice.isFactsIncluded) {
    items.push({ kind: 'facts', label: UI_TEXT.reportFactsItem })
  }
  for (const [index, candidate] of data.events.entries()) {
    if (choice.removed.has(index)) {
      continue
    }
    const parsed = reportItemEventSchema.safeParse(candidate)
    if (!parsed.success) {
      continue
    }
    items.push({
      kind: 'event',
      eventIndex: index,
      label: fill(UI_TEXT.reportEventItem, {
        kind: parsed.data.kind,
        age: formatReportAge(parsed.data.ageMs),
      }),
    })
  }
  return items
}

function reportDraftMessage(
  data: ReportData,
  choice: ReportChoice,
  draft: SealedReportDraft,
  canUseVscodeReporter: boolean,
): HostToWebviewMessage {
  return {
    type: 'reportDraft',
    description: choice.description,
    includeFacts: choice.isFactsIncluded,
    includeEvents: choice.isEventsIncluded,
    items: draftItems(data, choice),
    title: draft.title,
    text: draft.text,
    hash: draft.hash,
    canUseVscodeReporter,
    recordingUnavailable: choice.isRecordingUnavailable,
  }
}

function exportedMessage(
  via: ReportExportChannel,
  isOk: boolean,
  reason?: ReportExportReason,
  isIssueFallback?: boolean,
): HostToWebviewMessage {
  return {
    type: 'reportExported',
    via,
    ok: isOk,
    ...(isIssueFallback !== undefined && { issueFallback: isIssueFallback }),
    ...(reason !== undefined && { reason }),
  }
}

interface ReportSession {
  readonly data: ReportData
  readonly choice: ReportChoice
  readonly draft: SealedReportDraft
}

/** Creates the report-only message handler for one conversation surface. */
export function createReportProblemHandler(deps: ReportProblemHandlerDeps): {
  handle: (message: ReportProblemMessage) => Promise<void>
} {
  let session: ReportSession | undefined
  let canUseVscodeReporter = false

  function buildFails(error: unknown): void {
    // ReportBuildError names the field and the reason, never the refused
    // value, so the log line carries no secret.
    deps.log.error(
      error instanceof ReportBuildError ? error.message : `problem report failed: ${String(error)}`,
    )
    deps.noticeError(UI_TEXT.actionFailed)
  }

  function preview(current: ReportSession): void {
    deps.post(reportDraftMessage(current.data, current.choice, current.draft, canUseVscodeReporter))
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
      deps.log.warn('Report a problem is not wired to a report source yet')
      deps.noticeError(UI_TEXT.actionFailed)
      return
    }
    let facts: unknown
    try {
      facts = deps.source.readFacts()
    } catch (error: unknown) {
      session = undefined
      buildFails(error)
      return
    }
    const journal = deps.source.readJournal()
    const events = [...journal.entries]
    if (ref !== undefined && ref.entryIndex >= events.length) {
      // The entry pruned between the row and the click: the same workflow
      // opens over the journal as it stands.
      deps.log.warn('Report opened with a journal reference past the journal end')
    }
    canUseVscodeReporter = await deps.source.canUseVscodeReporter()
    const data: ReportData = {
      facts,
      events,
      scrub: deps.source.readScrub(),
      nowMs: deps.source.nowMs(),
    }
    const choice: ReportChoice = {
      description: '',
      isFactsIncluded: true,
      isEventsIncluded: true,
      removed: new Set(),
      isRecordingUnavailable: journal.recordingUnavailable,
    }
    const draft = rebuild(data, choice)
    if (draft === undefined) {
      session = undefined
      return
    }
    const current: ReportSession = { data, choice, draft }
    session = current
    preview(current)
  }

  function update(message: Extract<WebviewToHostMessage, { type: 'updateReport' }>): void {
    const current = session
    if (current === undefined || deps.source === undefined) {
      deps.log.warn('Report preview updated with no open dialog')
      return
    }
    const choice: ReportChoice = {
      description: message.description,
      isFactsIncluded: message.includeFacts,
      isEventsIncluded: message.includeEvents,
      removed: new Set(message.removedEventIndexes),
      isRecordingUnavailable: current.choice.isRecordingUnavailable,
    }
    const draft = rebuild(current.data, choice)
    if (draft === undefined) {
      return
    }
    const next: ReportSession = { data: current.data, choice, draft }
    session = next
    preview(next)
  }

  async function exportDraft(
    message: Extract<WebviewToHostMessage, { type: 'exportReport' }>,
  ): Promise<void> {
    const current = session
    if (current === undefined || deps.source === undefined) {
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
      // Any change since the preview: rebuild from the session and
      // re-preview; nothing is exported on a broken seal.
      const draft = rebuild(current.data, current.choice)
      if (draft === undefined) {
        return
      }
      const next: ReportSession = { ...current, draft }
      session = next
      preview(next)
      deps.post(exportedMessage(message.via, false, 'stale'))
      return
    }
    if (message.via === 'vscodeReporter') {
      const outcome = await openVscodeReporter(current.draft)
      deps.post(
        outcome.ok
          ? exportedMessage(message.via, true)
          : exportedMessage(message.via, false, outcome.reason),
      )
      return
    }
    let outcome: Awaited<ReturnType<typeof copyProblemReport>>
    if (message.via === 'copy') {
      outcome = await copyProblemReport(current.draft)
    } else if (message.via === 'issue') {
      outcome = await openProblemReportIssue(current.draft)
    } else {
      outcome = await saveProblemReport(current.draft)
    }
    if (!outcome.ok) {
      deps.post(exportedMessage(message.via, false, outcome.reason))
      return
    }
    // Lane P answers ok for both the prefilled page and the over-long
    // fallback (copied with a paste note): recompute which opened, so the
    // dialog states the fallback plainly.
    const isIssueFallback =
      message.via === 'issue'
        ? issueLinkForDraft(current.draft.title, current.draft.text).kind === 'fallback'
        : undefined
    deps.post(exportedMessage(message.via, true, undefined, isIssueFallback))
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
