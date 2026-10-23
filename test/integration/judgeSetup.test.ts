// Runs inside the Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { COMMAND_IDS, JUDGE_SETUP_PANEL_VIEW_TYPE } from '../../src/shared/constants'

const TAB_WAIT_TIMEOUT_MS = 5000
const TAB_POLL_INTERVAL_MS = 50

// Tab groups update asynchronously after a webview panel is created, so a
// direct read right after executeCommand races the UI. The host prefixes
// a panel's view type (`mainThreadWebview-…`), so the match is a suffix.
async function waitForWizardTab(): Promise<vscode.Tab> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (candidate) =>
          candidate.input instanceof vscode.TabInputWebview &&
          candidate.input.viewType.includes(JUDGE_SETUP_PANEL_VIEW_TYPE),
      )
    if (tab !== undefined) return tab
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  assert.fail('the setup wizard opened no tab')
}

suite('Set Up Local Judge', () => {
  test('the palette command opens the wizard panel, which closes cleanly', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes(COMMAND_IDS.setUpLocalJudge), 'setup command not registered')
    await vscode.commands.executeCommand(COMMAND_IDS.setUpLocalJudge)
    const tab = await waitForWizardTab()
    assert.equal(tab.label, 'Set Up Local Judge')
    await vscode.window.tabGroups.close(tab)
  })
})
