// `Muse Spark: Report a Problem` export paths (M93, PLAN.md D72). The draft
// the user previewed is sealed (`SealedReportDraft`): every path below
// exports that exact text and refuses a draft whose seal broke, so any change
// after the preview invalidates the export instead of sending stale words.
// Opening the prefilled issue page hands the draft to the user's browser and
// GitHub account; the extension never sends anything over the network itself
// and needs no GitHub access.
//
// The editor's side (the clipboard, the browser, the save picker, VS Code's
// issue reporter) comes in as `ReportEditorIo`, so this module and the
// dialog's bundle reach no `vscode` (the conversation is portable host code,
// D60); reportEditorIo.ts is VS Code's. The outcome is the caller's to state:
// the dialog's status line says it in fixed words, and nothing here waits on
// a notification, which resolves only when the user closes it.

import {
  isSealedDraftCurrent,
  issueLinkForDraft,
  type SealedReportDraft,
} from '../../core/support/problemReport'
import { REPORT_ISSUE_NEW_URL } from '../../shared/constants'

/** What VS Code's own issue reporter is opened with: its supported prefill only (D72). */
export interface IssueReporterPrefill {
  readonly extensionId: string
  readonly issueTitle: string
  readonly issueBody: string
}

/** The editor operations an export needs; each throws or answers, never shows a notification. */
export interface ReportEditorIo {
  writeClipboard(text: string): Promise<void>
  /** Opens a URL in the user's browser; false when the editor refused. */
  openExternal(url: string): Promise<boolean>
  /** Saves `text` to a file the user picks; false when the picker was dismissed. */
  saveText(text: string): Promise<boolean>
  openIssueReporter(prefill: IssueReporterPrefill): Promise<void>
}

/** What an export attempt answers, in fixed words the dialog states. */
export type ReportExportOutcome =
  | { readonly ok: true; readonly isIssueFallback?: boolean }
  | {
      readonly ok: false
      readonly reason: 'stale' | 'cancelled' | 'copyFailed' | 'saveFailed' | 'openFailed'
    }

/**
 * A broken seal: the draft changed after its preview. The caller rebuilds
 * from the preview on screen instead of exporting stale words.
 */
const STALE_DRAFT: ReportExportOutcome = { ok: false, reason: 'stale' }

/** Opens `url` in the user's browser; a refusal or a throw reads as not opened. */
async function isOpenedInBrowser(io: ReportEditorIo, url: string): Promise<boolean> {
  try {
    return await io.openExternal(url)
  } catch {
    return false
  }
}

/** Copies the sealed draft to the clipboard, exactly as previewed. */
export async function copyProblemReport(
  draft: SealedReportDraft,
  io: ReportEditorIo,
): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  try {
    await io.writeClipboard(draft.text)
  } catch {
    return { ok: false, reason: 'copyFailed' }
  }
  return { ok: true }
}

/**
 * Opens the prefilled new-issue page for a short draft. Past the encoded-URL
 * cap it copies the same draft and opens the unfilled form with the paste
 * instruction instead (`isIssueFallback`). A failed copy opens nothing and
 * says so, never pretending the draft was copied; a browser that would not
 * open says so too.
 */
export async function openProblemReportIssue(
  draft: SealedReportDraft,
  io: ReportEditorIo,
): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  const link = issueLinkForDraft(draft.title, draft.text)
  if (link.kind === 'open') {
    return (await isOpenedInBrowser(io, link.url))
      ? { ok: true, isIssueFallback: false }
      : { ok: false, reason: 'openFailed' }
  }
  try {
    await io.writeClipboard(draft.text)
  } catch {
    return { ok: false, reason: 'copyFailed' }
  }
  return (await isOpenedInBrowser(io, REPORT_ISSUE_NEW_URL))
    ? { ok: true, isIssueFallback: true }
    : { ok: false, reason: 'openFailed' }
}

/**
 * Saves the sealed draft to a file the user picks. A dismissed picker ends
 * quietly; a picker or write that failed names the failure.
 */
export async function saveProblemReport(
  draft: SealedReportDraft,
  io: ReportEditorIo,
): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  let isSaved: boolean
  try {
    isSaved = await io.saveText(draft.text)
  } catch {
    return { ok: false, reason: 'saveFailed' }
  }
  return isSaved ? { ok: true } : { ok: false, reason: 'cancelled' }
}
