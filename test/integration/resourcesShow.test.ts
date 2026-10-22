// Runs inside the Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  CHAT_PANEL_VIEW_TYPE,
  COMMAND_IDS,
  EXTENSION_QUALIFIED_ID,
} from '../../src/shared/constants'

const TAB_WAIT_TIMEOUT_MS = 5000
const TAB_POLL_INTERVAL_MS = 50
// How long after Show Resources to keep watching the log: the open, the
// webview's parse and its report back all land within seconds.
const DROP_SETTLE_MS = 12_000
const DROP_POLL_INTERVAL_MS = 250
const DROP_MARKER = 'Dropped malformed host message'

async function waitForChatPanel(): Promise<void> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const isOpen = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some(
        (tab) =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType.includes(CHAT_PANEL_VIEW_TYPE),
      )
    if (isOpen) return
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  throw new Error('no chat panel tab appeared')
}

async function logFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await logFilesUnder(full)))
    else if (entry.isFile() && entry.name.endsWith('.log')) found.push(full)
  }
  return found
}

/** Every drop line in the development host's logs, counted per line. */
async function dropCounts(logRoot: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  // No catch: when the logs cannot be read the drop cannot be observed, so
  // the test must fail rather than pass blind.
  const files = await logFilesUnder(logRoot)
  for (const file of files) {
    const info = await stat(file)
    if (!info.isFile()) continue
    const text = await readFile(file, 'utf8')
    for (const line of text.split('\n')) {
      if (line.includes(DROP_MARKER)) counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }
  return counts
}

function increased(before: Map<string, number>, after: Map<string, number>): string[] {
  const grown: string[] = []
  for (const [line, count] of after) {
    if (count > (before.get(line) ?? 0)) grown.push(line)
  }
  return grown
}

// RLWINFIX item 1: `Muse Spark: Show Resources` must deliver its state to the
// chat webview. A host message that fails the webview's schema is dropped and
// reported back into this log, so the command runs for real and the log must
// stay free of new drop lines.
suite('Show Resources delivers its state', () => {
  test('no host message is dropped on the way to the chat webview', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    await extension.activate()
    const logRoot = path.join(extension.extensionUri.fsPath, '.vscode-test')
    const before = await dropCounts(logRoot)
    await vscode.commands.executeCommand(COMMAND_IDS.openInNewTab)
    await waitForChatPanel()
    await vscode.commands.executeCommand(COMMAND_IDS.showResources)
    const deadline = Date.now() + DROP_SETTLE_MS
    let grown: string[] = []
    while (Date.now() < deadline) {
      grown = increased(before, await dropCounts(logRoot))
      if (grown.length > 0) break
      await new Promise((resolve) => setTimeout(resolve, DROP_POLL_INTERVAL_MS))
    }
    assert.deepEqual(grown, [], 'a host message was dropped after Show Resources')
  })
})
