// Lazy, user-only recording surface. R1–R3 supply the exported driver;
// attaching transfers temporary-file ownership to the upload lifecycle.
import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { ScreenRecordingPreview } from '../../core/media/record/driver'
import {
  SCREEN_RECORDING_MAX_SECONDS,
  SCREEN_RECORDING_MIN_SECONDS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatUnit, setUiText } from '../../shared/l10n/text'
import { screenRecordingOptionsSchema } from '../../shared/media'
import { createNonce } from '../html'
import type { RecordingCommandDeps, RecordingPreviewDeps } from './screenRecordBundle'

const previewMessage = z.strictObject({ type: z.enum(['attach', 'discard']) })
const htmlEscapes: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
function escape(text: string): string {
  return text.replaceAll(/[&<>"']/gu, (character) => htmlEscapes[character] ?? character)
}

export function openRecordingPreview(
  preview: ScreenRecordingPreview,
  deps: RecordingPreviewDeps,
): vscode.Disposable {
  setUiText(deps.l10n.table, deps.l10n.locale)
  const root = vscode.Uri.file(path.dirname(preview.path))
  const panel = vscode.window.createWebviewPanel(
    'museSpark.recordingPreview',
    UI_TEXT.media.recordingPreview,
    vscode.ViewColumn.Beside,
    { enableScripts: true, enableCommandUris: false, localResourceRoots: [root] },
  )
  const nonce = createNonce()
  const source = panel.webview.asWebviewUri(vscode.Uri.file(preview.path)).toString()
  const html = `<!DOCTYPE html>
<html lang="${escape(deps.l10n.locale)}"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${escape(panel.webview.cspSource)}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>${escape(UI_TEXT.media.recordingPreview)}</title>
<style nonce="${nonce}">
body{margin:0;padding:1rem;box-sizing:border-box;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}
main{max-width:60rem;margin:auto}video{display:block;width:100%;max-height:70vh}p{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:1rem}
button{padding:.5rem 1rem;border:1px solid var(--vscode-button-border,transparent);color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;cursor:pointer}
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}button:disabled{opacity:.5;cursor:default}
</style></head><body><main><h1>${escape(UI_TEXT.media.recordingPreview)}</h1>
<video controls preload="metadata" aria-label="${escape(UI_TEXT.media.recordingPreview)}" src="${escape(source)}"></video>
<p>${escape(UI_TEXT.media.recordingWarning)}</p><nav aria-label="${escape(UI_TEXT.media.recordingPreview)}">
<button id="attach" type="button">${escape(UI_TEXT.media.recordingAttach)}</button>
<button id="discard" type="button">${escape(UI_TEXT.media.recordingDiscard)}</button></nav></main>
<script nonce="${nonce}">const host=acquireVsCodeApi();for(const type of ['attach','discard'])document.getElementById(type).addEventListener('click',()=>{for(const button of document.querySelectorAll('button'))button.disabled=true;host.postMessage({type:type})});</script>
</body></html>`
  panel.webview.html = html
  let isPending = false
  let isTransferred = false
  let isClosed = false
  let cleanup: Promise<void> | undefined
  const discardOnce = async () => {
    try {
      await preview.dispose()
    } catch {
      deps.log.warn('Recording preview cleanup failed')
    }
  }
  const discard = () => {
    cleanup ??= discardOnce()
    return cleanup
  }
  const attach = async () => {
    try {
      isTransferred = await deps.attach(preview, true)
      if (isTransferred) panel.dispose()
      // A refusal keeps the preview: the banner said why (M105 E1 review).
    } catch (error: unknown) {
      // A thrown attach is silent without this: say it (M105 E1 review).
      deps.log.warn('Recording preview attachment failed')
      await vscode.window.showErrorMessage(
        fill(UI_TEXT.media.uploadFailed, {
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      isPending = false
      if (isClosed && !isTransferred) await discard()
      else if (!isClosed) panel.webview.html = html
    }
  }
  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = previewMessage.safeParse(raw)
    if (isPending || isClosed || !parsed.success) return
    if (parsed.data.type === 'discard') {
      panel.dispose()
      return
    }
    isPending = true
    void attach()
  })
  panel.onDidDispose(() => {
    isClosed = true
    subscription.dispose()
    if (!isPending && !isTransferred) void discard()
  })
  return panel
}

/** Command registrations call this only in response to an interactive user. */
export async function runScreenRecordingCommand(
  deps: RecordingCommandDeps,
  isLatest: boolean,
): Promise<void> {
  setUiText(deps.l10n.table, deps.l10n.locale)
  if (deps.isRemote) {
    await vscode.window.showInformationMessage(UI_TEXT.media.recordingRemote)
    return
  }
  if (isLatest) {
    const preview = await deps.latest?.()
    if (preview === undefined)
      await vscode.window.showInformationMessage(UI_TEXT.media.recordingNoRecent)
    else openRecordingPreview(preview, deps)
    return
  }
  const driver = deps.driver
  if (driver === undefined) {
    // No driver is a missing recorder, never the user's fault (M105 E1/E2 review).
    await vscode.window.showInformationMessage(
      fill(UI_TEXT.media.recordingUnavailable, { reason: UI_TEXT.media.recorderUnavailable }),
    )
    return
  }
  const available = await driver.available()
  if (!available.ok) {
    await vscode.window.showInformationMessage(
      fill(UI_TEXT.media.recordingUnavailable, { reason: available.reason }),
    )
    return
  }
  const selected = await vscode.window.showQuickPick(
    [
      { label: UI_TEXT.media.recordingMicrophone, picked: false, audio: 'microphone' },
      { label: UI_TEXT.media.recordingSystemAudio, picked: false, audio: 'systemAudio' },
    ],
    { canPickMany: true, title: UI_TEXT.media.recordingStart },
  )
  if (selected === undefined) return
  // A setting outside the schema range clamps instead of failing the
  // command with a raw schema error (M105 E1 review).
  const options = screenRecordingOptionsSchema.parse({
    maxSeconds: Math.min(
      SCREEN_RECORDING_MAX_SECONDS,
      Math.max(SCREEN_RECORDING_MIN_SECONDS, deps.maxSeconds),
    ),
    microphone: selected.some((item) => item.audio === 'microphone'),
    systemAudio: selected.some((item) => item.audio === 'systemAudio'),
  })
  const isLive = deps.isLive ?? (() => true)
  const status = vscode.window.createStatusBarItem()
  // One Stop command per invocation; no tool/bridge can invoke the driver.
  const stopCommand = `museSpark.stopScreenRecording.${createNonce()}`
  status.command = stopCommand
  status.tooltip = UI_TEXT.media.recordingStop
  let stopping: vscode.Disposable | undefined
  // A countdown tick after the result settled must not touch the disposed
  // status item (M105 E1 review).
  let isSettled = false
  try {
    const run = await driver.start(options, (remaining) => {
      if (isSettled) return
      status.text = fill(UI_TEXT.media.recordingCountdown, {
        remaining: formatUnit(remaining, 'second'),
      })
      status.show()
    })
    // The conversation went away while the driver started: the run is
    // cancelled, never previewed (M105 E1 review).
    if (!isLive()) {
      await run.cancel()
      return
    }
    const untrack = deps.trackRun?.(() => run.cancel())
    try {
      stopping = vscode.commands.registerCommand(stopCommand, () => run.stop())
      const result = await run.result
      if (!result.ok)
        await vscode.window.showInformationMessage(
          fill(UI_TEXT.media.recordingUnavailable, { reason: result.reason }),
        )
      else if (isLive()) {
        openRecordingPreview(result.preview, deps)
      } else {
        await result.preview.dispose()
      }
    } finally {
      untrack?.()
    }
  } finally {
    isSettled = true
    stopping?.dispose()
    status.dispose()
  }
}
