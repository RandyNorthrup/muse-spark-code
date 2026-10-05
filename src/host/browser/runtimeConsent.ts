// The question before the browser check's runtime is downloaded (M81 A1,
// design spec v4 §4.1; consent is the host's, lead ruling v4-M1): a native
// modal naming Google, the pinned archive's size, storage.googleapis.com,
// where it is kept, that each new pinned version is downloaded again, and
// that it is used only for browser checks. Download, or Not now; closing it
// is Not now. It is asked inside the preparation's lifetime and its
// two-minute bound: a modal VS Code cannot close keeps no authority after
// its caller stopped waiting, so a late Download downloads nothing.

import * as vscode from 'vscode'
import type { RuntimeConsent } from '../../core/browser/runtimeTypes'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatBytes } from '../../shared/l10n/text'

/** The modal, for runtimes kept under `storageDir`. */
export function runtimeConsent(storageDir: string): RuntimeConsent {
  return async (version, archiveBytes, signal) => {
    // Read at each use: the caller may stop waiting while the modal is up.
    const isStopped = (): boolean => signal.aborted
    if (isStopped()) {
      return 'decline'
    }
    const download: vscode.MessageItem = { title: UI_TEXT.browserRuntimeDownload }
    const notNow: vscode.MessageItem = {
      title: UI_TEXT.browserRuntimeNotNow,
      isCloseAffordance: true,
    }
    const size = formatBytes(archiveBytes)
    const asked = vscode.window.showInformationMessage(
      fill(UI_TEXT.browserRuntimeConsentTitle, { size }),
      {
        modal: true,
        detail: fill(UI_TEXT.browserRuntimeConsentDetail, {
          version,
          size,
          location: storageDir,
        }),
      },
      download,
      notNow,
    )
    const listening = new AbortController()
    const stopped = new Promise<undefined>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          resolve(undefined)
        },
        { once: true, signal: listening.signal },
      )
    })
    try {
      const answer = await Promise.race([asked, stopped])
      return answer === download && !isStopped() ? 'download' : 'decline'
    } finally {
      listening.abort()
    }
  }
}
