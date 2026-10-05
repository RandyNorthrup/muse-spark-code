// `Muse Spark: Report a Problem` export paths (M93, PLAN.md D72). The draft
// the user previewed is sealed (`SealedReportDraft`): every path below
// exports that exact text and refuses a draft whose seal broke, so any change
// after the preview invalidates the export instead of sending stale words.
// Opening the prefilled issue page hands the draft to the user's browser and
// GitHub account; the extension never sends anything over the network itself
// and needs no GitHub access.
//
// The outcome is the caller's to state: the report dialog's status line says
// it in fixed words. Nothing here waits on a notification, which resolves
// only when the user closes it and would hold the answer back until then.

import * as vscode from 'vscode'
import {
  isSealedDraftCurrent,
  issueLinkForDraft,
  type SealedReportDraft,
} from '../../core/support/problemReport'
import { REPORT_ISSUE_NEW_URL } from '../../shared/constants'

/** What an export attempt answers, in fixed words the dialog states. */
export type ReportExportOutcome =
  | { readonly ok: true; readonly isIssueFallback?: boolean }
  | {
      readonly ok: false
      readonly reason: 'stale' | 'cancelled' | 'copyFailed' | 'saveFailed' | 'openFailed'
    }

const MARKDOWN_FILTER = 'Markdown'
const REPORT_FILE_EXTENSION = 'md'

/**
 * A broken seal: the draft changed after its preview. The caller rebuilds
 * from the preview on screen instead of exporting stale words.
 */
const STALE_DRAFT: ReportExportOutcome = { ok: false, reason: 'stale' }

/** Opens `url` in the user's browser; a refusal or a throw reads as not opened. */
async function isOpenedInBrowser(url: string): Promise<boolean> {
  try {
    return await vscode.env.openExternal(vscode.Uri.parse(url))
  } catch {
    return false
  }
}

/** Copies the sealed draft to the clipboard, exactly as previewed. */
export async function copyProblemReport(draft: SealedReportDraft): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  try {
    await vscode.env.clipboard.writeText(draft.text)
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
): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  const link = issueLinkForDraft(draft.title, draft.text)
  if (link.kind === 'open') {
    return (await isOpenedInBrowser(link.url))
      ? { ok: true, isIssueFallback: false }
      : { ok: false, reason: 'openFailed' }
  }
  try {
    await vscode.env.clipboard.writeText(draft.text)
  } catch {
    return { ok: false, reason: 'copyFailed' }
  }
  return (await isOpenedInBrowser(REPORT_ISSUE_NEW_URL))
    ? { ok: true, isIssueFallback: true }
    : { ok: false, reason: 'openFailed' }
}

/**
 * Saves the sealed draft to a file the user picks. A dismissed picker ends
 * quietly; a refused write names the failure.
 */
export async function saveProblemReport(draft: SealedReportDraft): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return STALE_DRAFT
  }
  let target: vscode.Uri | undefined
  try {
    target = await vscode.window.showSaveDialog({
      filters: { [MARKDOWN_FILTER]: [REPORT_FILE_EXTENSION] },
    })
  } catch {
    return { ok: false, reason: 'saveFailed' }
  }
  if (target === undefined) {
    return { ok: false, reason: 'cancelled' }
  }
  try {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(draft.text))
  } catch {
    return { ok: false, reason: 'saveFailed' }
  }
  return { ok: true }
}
