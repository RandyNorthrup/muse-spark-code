// `Muse Spark: Report a Problem` export paths (M93, PLAN.md D72). The draft
// the user previewed is sealed (`SealedReportDraft`): every path below
// exports that exact text and refuses a draft whose seal broke, so any change
// after the preview invalidates the export instead of sending stale words.
// Opening the prefilled issue page hands the draft to the user's browser and
// GitHub account; the extension never sends anything over the network itself
// and needs no GitHub access.

import * as vscode from 'vscode'
import {
  isSealedDraftCurrent,
  issueLinkForDraft,
  type SealedReportDraft,
} from '../../core/support/report'
import { REPORT_ISSUE_NEW_URL, UI_TEXT } from '../../shared/constants'

/** What an export attempt answers; `message`, when present, is already shown. */
export type ReportExportOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'stale' | 'cancelled' | 'copyFailed' | 'saveFailed'
      /** The notice shown for the failure; absent when nothing is shown. */
      readonly message: string | undefined
    }

const MARKDOWN_FILTER = 'Markdown'
const REPORT_FILE_EXTENSION = 'md'

/**
 * A broken seal: the draft changed after its preview. Nothing is shown on
 * purpose — the preview on screen already holds the current text, so the
 * caller rebuilds from it instead of telling the user what they can see.
 */
function staleDraft(): ReportExportOutcome {
  return { ok: false, reason: 'stale', message: undefined }
}

/** Copies the sealed draft to the clipboard, exactly as previewed. */
export async function copyProblemReport(draft: SealedReportDraft): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return staleDraft()
  }
  try {
    await vscode.env.clipboard.writeText(draft.text)
  } catch {
    const message = UI_TEXT.reportCopyFailed
    await vscode.window.showErrorMessage(message)
    return { ok: false, reason: 'copyFailed', message }
  }
  const message = UI_TEXT.reportCopied
  await vscode.window.showInformationMessage(message)
  return { ok: true }
}

/**
 * Opens the prefilled new-issue page for a short draft. Past the encoded-URL
 * cap it copies the same draft and opens the unfilled form with the paste
 * instruction instead; a failed copy still opens the form but says so, and
 * never pretends the draft was copied.
 */
export async function openProblemReportIssue(
  draft: SealedReportDraft,
): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return staleDraft()
  }
  const link = issueLinkForDraft(draft.title, draft.text)
  if (link.kind === 'open') {
    await vscode.env.openExternal(vscode.Uri.parse(link.url))
    return { ok: true }
  }
  try {
    await vscode.env.clipboard.writeText(draft.text)
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(REPORT_ISSUE_NEW_URL))
    const message = UI_TEXT.reportCopyFailed
    await vscode.window.showErrorMessage(message)
    return { ok: false, reason: 'copyFailed', message }
  }
  await vscode.env.openExternal(vscode.Uri.parse(REPORT_ISSUE_NEW_URL))
  const message = UI_TEXT.reportUrlTooLong
  await vscode.window.showInformationMessage(message)
  return { ok: true }
}

/**
 * Saves the sealed draft to a file the user picks. A dismissed picker ends
 * quietly; a refused write names the failure.
 */
export async function saveProblemReport(draft: SealedReportDraft): Promise<ReportExportOutcome> {
  if (!isSealedDraftCurrent(draft)) {
    return staleDraft()
  }
  let target: vscode.Uri | undefined
  try {
    target = await vscode.window.showSaveDialog({
      filters: { [MARKDOWN_FILTER]: [REPORT_FILE_EXTENSION] },
    })
  } catch {
    const message = UI_TEXT.reportSaveFailed
    await vscode.window.showErrorMessage(message)
    return { ok: false, reason: 'saveFailed', message }
  }
  if (target === undefined) {
    return { ok: false, reason: 'cancelled', message: undefined }
  }
  try {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(draft.text))
  } catch {
    const message = UI_TEXT.reportSaveFailed
    await vscode.window.showErrorMessage(message)
    return { ok: false, reason: 'saveFailed', message }
  }
  const message = UI_TEXT.reportSaved
  await vscode.window.showInformationMessage(message)
  return { ok: true }
}
