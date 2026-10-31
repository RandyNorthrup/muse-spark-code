// Finding the editor tabs a command opens, for the integration suites.
// Tab groups update asynchronously after a webview panel is created, so a
// direct read right after executeCommand races the UI: these poll instead.

import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'

export const TAB_WAIT_TIMEOUT_MS = 5000
export const TAB_POLL_INTERVAL_MS = 50

function describeTab(tab: vscode.Tab): string {
  // A label alone cannot name the F74 thief: every chat panel is labelled
  // 'Untitled', same as an untitled document. The kind tells them apart.
  const { input, label } = tab
  if (input instanceof vscode.TabInputWebview) {
    const kind = `webview:${input.viewType}`
    return `${label}(${kind})`
  }
  if (input instanceof vscode.TabInputText) {
    const kind = `text:${input.uri.fsPath}`
    return `${label}(${kind})`
  }
  return `${label}(other)`
}

// Read fresh on every poll: an earlier assert's narrowing of the editor
// chain does not survive the awaits between polls, so the read lives in its
// own function where the optional chain is genuinely needed.
export function activeTextEditorFsPath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath
}

/** The first open tab `isMatch` accepts; a failure names every open tab. */
export async function waitForTab(isMatch: (tab: vscode.Tab) => boolean): Promise<vscode.Tab> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((candidate) => isMatch(candidate))
    if (tab !== undefined) {
      return tab
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  const open = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => describeTab(tab)),
  )
  throw new Error(
    `no matching tab appeared within ${String(TAB_WAIT_TIMEOUT_MS)} ms; open: ${open.join(', ')}; active editor: ${activeTextEditorFsPath() ?? 'none'}`,
  )
}

/** Waits until `target` is the active editor's document, then asserts it. */
export async function waitForDocument(target: vscode.Uri): Promise<void> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (
    vscode.window.activeTextEditor?.document.uri.toString() !== target.toString() &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, target.fsPath)
}
