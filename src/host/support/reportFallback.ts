// The report's way out when the dialog cannot open (M93, lane REPORTFLOW
// R2): a native quick pick with Copy report, Save report and Open issue
// page, built by a minimal path that needs neither the webview nor the lazy
// report bundle. The Report command reaches it when no conversation surface
// becomes ready; an error row's "Report This" reaches it through the same
// fallback when the report entry cannot be loaded.
//
// Facts the snapshot cannot read become the word `unknown` for their fact
// (the snapshot's own bounds); the fallback never fails for lack of a fact.
// When even the unknown-facts build refuses, the pick still offers the blank
// issue page, so there is always a way out that does not need the thing that
// broke. Outcomes are said with the editor's own messages in the dialog's
// fixed words. This module ships as dist/reportFallback.js (not in
// activation, not in the report bundle) and reaches no `vscode` at all: the
// editor's own pick and messages arrive through deps, wired at activation.
// Portable host code (D60): only the adapter behind the port touches the
// editor.

import {
  buildProblemReportDraft,
  enrichProblemReportFacts,
  selectProblemReportEvents,
  type ReportScrubContext,
  type SealedReportDraft,
} from '../../core/support/problemReport'
import {
  REPORT_ISSUE_NEW_URL,
  REPORT_SNAPSHOT_TIMEOUT_MS,
  REPORT_UNKNOWN_ERROR_CODE,
  UI_TEXT,
  type ReportPanelState,
} from '../../shared/constants'
import type { ReportEventRef } from '../../shared/protocol'
import type { Logger } from '../logger'
import type { ReportDataSource, ReportJournalSource } from '../conversation/reportProblemHandler'
import {
  copyProblemReport,
  openProblemReportIssue,
  saveProblemReport,
  type ReportEditorIo,
  type ReportExportOutcome,
} from './reportProblem'
import { readBounded, reportError } from './reportTimeout'

/** Where the fallback's facts, journal and scrub context come from (wired at activation). */
export interface ReportFallbackDeps {
  readonly source: ReportDataSource
  readonly io: ReportEditorIo
  readonly window: ReportFallbackWindow
  readonly log: Logger
}

/**
The editor's own pick and messages behind the fallback (wired at
activation, VS Code's in reportEditorIo.ts): offering labels answers the
picked index, or undefined when the pick is dismissed.
*/
export interface ReportFallbackWindow {
  showQuickPick(labels: readonly string[], title: string): Promise<number | undefined>
  showInformationMessage(text: string): Promise<void>
  showErrorMessage(text: string): Promise<void>
}

/** What the fallback's quick pick offers: the sealed draft behind each action. */
export type FallbackAction = 'copy' | 'issue' | 'save'

interface FallbackPick {
  readonly label: string
  readonly action: FallbackAction
}

/** The facts when the facts read itself threw or hung: every fact unknown. */
const UNKNOWN_FALLBACK_FACTS = {
  extensionVersion: REPORT_UNKNOWN_ERROR_CODE,
  nodeVersion: REPORT_UNKNOWN_ERROR_CODE,
} as const

/** The scrub context when even the local reads fail: nothing to stand in for. */
const EMPTY_FALLBACK_SCRUB: ReportScrubContext = {
  workspaceRoots: [],
  homeDir: '',
  extraLiterals: [],
}

/** One dialog-free snapshot: the same bounds as the dialog's, never fatal. */
interface FallbackSnapshot {
  readonly facts: unknown
  readonly events: readonly unknown[]
  readonly recordingUnavailable: boolean
  readonly recordingReason: string | undefined
  readonly scrub: ReportScrubContext
  readonly nowMs: number
}

async function snapshotFallback(
  source: ReportDataSource,
  panelState: ReportPanelState | undefined,
  log: Logger,
): Promise<FallbackSnapshot> {
  const facts = await readBounded<unknown>(
    log,
    'fallback facts',
    () => source.readFacts(),
    REPORT_SNAPSHOT_TIMEOUT_MS,
    UNKNOWN_FALLBACK_FACTS,
  )
  const journal = await readBounded<ReportJournalSource>(
    log,
    'fallback journal',
    () => source.readJournal(),
    REPORT_SNAPSHOT_TIMEOUT_MS,
    { entries: [], recordingUnavailable: true, unavailableReason: 'unknown' },
  )
  let scrub: ReportScrubContext
  let nowMs: number
  try {
    scrub = source.readScrub()
    nowMs = source.nowMs()
  } catch (error: unknown) {
    reportError(log, 'fallback scrub unavailable', error)
    scrub = EMPTY_FALLBACK_SCRUB
    nowMs = Date.now()
  }
  return {
    facts: enrichProblemReportFacts(facts, journal.entries, panelState),
    events: selectProblemReportEvents(journal.entries).map((selected) => selected.event),
    recordingUnavailable: journal.recordingUnavailable,
    recordingReason: journal.unavailableReason,
    scrub,
    nowMs,
  }
}

/** The sealed draft, or undefined when even the unknown-facts build refused. */
function buildFallbackDraft(
  snapshot: FallbackSnapshot,
  log: Logger,
): SealedReportDraft | undefined {
  const input = {
    description: '',
    includeFacts: true,
    includeEvents: true,
    facts: snapshot.facts,
    events: snapshot.events,
    recordingUnavailable: snapshot.recordingUnavailable,
    ...(snapshot.recordingReason !== undefined && { recordingReason: snapshot.recordingReason }),
    nowMs: snapshot.nowMs,
    scrub: snapshot.scrub,
  }
  try {
    return buildProblemReportDraft(input)
  } catch (error: unknown) {
    reportError(log, 'fallback build refused', error)
  }
  try {
    return buildProblemReportDraft({ ...input, facts: UNKNOWN_FALLBACK_FACTS })
  } catch (error: unknown) {
    reportError(log, 'fallback unknown-facts build refused', error)
    return undefined
  }
}

/**
The editor-native way out (lane REPORTFLOW R2): the sealed draft behind
Copy, Save and the issue page. A dismissed pick ends quietly; every
outcome is said in the dialog's fixed words.
*/
export async function runReportFallback(
  deps: ReportFallbackDeps,
  ref: ReportEventRef | undefined,
  panelState: ReportPanelState | undefined,
): Promise<void> {
  if (ref !== undefined) {
    deps.log.info(`Report fallback opened from a recorded ${ref.kind}`)
  }
  const snapshot = await snapshotFallback(deps.source, panelState, deps.log)
  const draft = buildFallbackDraft(snapshot, deps.log)
  const picks: FallbackPick[] =
    draft === undefined
      ? [{ label: UI_TEXT.reportOpenIssueAction, action: 'issue' }]
      : [
          { label: UI_TEXT.reportCopyAction, action: 'copy' },
          { label: UI_TEXT.reportSaveAction, action: 'save' },
          { label: UI_TEXT.reportOpenIssueAction, action: 'issue' },
        ]
  const pickedIndex = await deps.window.showQuickPick(
    picks.map((pick) => pick.label),
    UI_TEXT.reportFallbackTitle,
  )
  const picked = pickedIndex === undefined ? undefined : picks[pickedIndex]
  if (picked === undefined) {
    return
  }
  await runFallbackAction(deps, draft, picked.action)
}

/**
One fallback action behind the pick (exported for its tests): the sealed
draft through Copy, Save or the issue page. Without a draft only the
blank issue page is a way out.
*/
export async function runFallbackAction(
  deps: ReportFallbackDeps,
  draft: SealedReportDraft | undefined,
  action: FallbackAction,
): Promise<void> {
  if (draft === undefined) {
    // No draft could be built: the blank issue page is still a way out.
    await openBlankIssue(deps)
    return
  }
  switch (action) {
    case 'copy': {
      const answer = await copyProblemReport(draft, deps.io)
      await sayCopy(deps.window, answer.ok)
      break
    }
    case 'save': {
      const answer = await saveProblemReport(draft, deps.io)
      if (!answer.ok && answer.reason === 'cancelled') {
        return
      }
      await saySave(deps.window, answer.ok)
      break
    }
    case 'issue': {
      const answer = await openProblemReportIssue(draft, deps.io)
      await sayIssue(deps.window, answer)
      break
    }
  }
}

/** The blank issue page: the way out when no draft could be built. */
async function openBlankIssue(deps: ReportFallbackDeps): Promise<void> {
  try {
    const isOpened = await deps.io.openExternal(REPORT_ISSUE_NEW_URL)
    await sayIssue(deps.window, isOpened ? { ok: true } : { ok: false, reason: 'openFailed' })
  } catch (error: unknown) {
    reportError(deps.log, 'blank issue page failed', error)
    await sayIssue(deps.window, { ok: false, reason: 'openFailed' })
  }
}

async function sayCopy(window: ReportFallbackWindow, isOk: boolean): Promise<void> {
  if (isOk) {
    await window.showInformationMessage(UI_TEXT.reportCopied)
  } else {
    // No preview exists to copy from here: name the other way out.
    await window.showErrorMessage(UI_TEXT.reportFallbackCopyFailed)
  }
}

async function saySave(window: ReportFallbackWindow, isOk: boolean): Promise<void> {
  if (isOk) {
    await window.showInformationMessage(UI_TEXT.reportSaved)
  } else {
    await window.showErrorMessage(UI_TEXT.reportSaveFailed)
  }
}

async function sayIssue(window: ReportFallbackWindow, answer: ReportExportOutcome): Promise<void> {
  if (answer.ok) {
    await window.showInformationMessage(
      answer.isIssueFallback === true ? UI_TEXT.reportUrlTooLong : UI_TEXT.reportIssueOpened,
    )
  } else {
    await window.showErrorMessage(UI_TEXT.reportIssueOpenFailed)
  }
}
