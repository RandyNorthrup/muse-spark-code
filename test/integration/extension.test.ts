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
// test/fixtures/workspace/.vscode/settings.json sets this window-scoped key
// and two machine-scoped ones (PLAN.md D15).
const FIXTURE_OVERRIDE = 'hideOnboarding'
const RULES_HEADER = 'Muse Code reads this file as project rules when it runs in this directory.'
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
  const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label))
  throw new Error(
    `no matching tab appeared within ${String(TAB_WAIT_TIMEOUT_MS)} ms; open: ${labels.join(', ')}`,
  )
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
    // The fixture workspace overrides one window-scoped setting (next test).
    const defaults = Object.entries(SETTING_DEFAULTS).filter(([key]) => key !== FIXTURE_OVERRIDE)
    for (const [key, value] of defaults) {
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

  test('a workspace cannot set the machine-scoped settings but sets the others (D15)', () => {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    assert.equal(configuration.get('allowDangerouslySkipPermissions'), false)
    assert.equal(configuration.get('museBinaryPath'), '')
    assert.equal(configuration.inspect(FIXTURE_OVERRIDE)?.workspaceValue, true)
    assert.equal(configuration.get(FIXTURE_OVERRIDE), true)
  })

  test('creates AGENTS.md in the workspace root and opens it (D15)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'no workspace folder')
    const target = vscode.Uri.joinPath(folder.uri, 'AGENTS.md')
    try {
      await vscode.commands.executeCommand(COMMAND_IDS.createRulesFile)
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(target))
      assert.ok(text.startsWith('# AGENTS.md'), text.slice(0, 40))
      assert.ok(text.includes(RULES_HEADER), 'header line missing')
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, target.fsPath)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      await vscode.workspace.fs.delete(target)
    }
  })

  test('New Conversation clears the active surface in place (D15)', async () => {
    const webviewTabs = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.input instanceof vscode.TabInputWebview).length
    const before = webviewTabs()
    assert.ok(before > 0, 'a chat panel from the earlier test is open')
    await vscode.commands.executeCommand(COMMAND_IDS.newConversation)
    assert.equal(webviewTabs(), before)
  })

  test('opens the walkthrough (D15)', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.openWalkthrough)
    // The walkthrough opens in VS Code's Welcome editor.
    await waitForTab(
      (candidate) => candidate.label === 'Welcome' || candidate.label.includes('Muse Spark'),
    )
  })
})
