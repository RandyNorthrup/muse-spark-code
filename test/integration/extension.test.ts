// Runs inside the Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import {
  CHAT_PANEL_VIEW_TYPE,
  CHAT_VIEW_ID,
  COMMAND_IDS,
  EXTENSION_QUALIFIED_ID,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
} from '../../src/shared/constants'

const TAB_WAIT_TIMEOUT_MS = 5000
const TAB_POLL_INTERVAL_MS = 50

// Tab groups update asynchronously after a webview panel is created, so a
// direct read right after executeCommand races the UI.
async function waitForTab(isMatch: (tab: vscode.Tab) => boolean): Promise<vscode.Tab> {
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
  throw new Error(`no matching tab appeared within ${String(TAB_WAIT_TIMEOUT_MS)} ms`)
}

suite('activation', () => {
  test('the extension is installed and activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    await extension.activate()
    assert.equal(extension.isActive, true)
  })

  test('registers its commands and the chat view focus command', async () => {
    const commands = await vscode.commands.getCommands(true)
    for (const id of Object.values(COMMAND_IDS)) {
      assert.ok(commands.includes(id), `missing command ${id}`)
    }
    assert.ok(commands.includes(`${CHAT_VIEW_ID}.focus`), 'chat view focus command missing')
  })

  test('exposes every setting with its documented default', () => {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      assert.deepEqual(configuration.get(key), value, `default for ${key}`)
    }
  })

  test('opens an Untitled chat panel in a new tab', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.openInNewTab)
    const tab = await waitForTab(
      (candidate) =>
        candidate.input instanceof vscode.TabInputWebview &&
        candidate.input.viewType.includes(CHAT_PANEL_VIEW_TYPE),
    )
    assert.equal(tab.label, 'Untitled')
  })

  test('the keybinding commands run and toggleFocusView flips the setting', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.focusInput)
    await vscode.commands.executeCommand(COMMAND_IDS.insertMentionReference)
    await vscode.commands.executeCommand(COMMAND_IDS.toggleFocusView)
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    assert.equal(configuration.get('focusView'), true)
    await configuration.update('focusView', undefined, vscode.ConfigurationTarget.Global)
  })
})
