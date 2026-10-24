// Runs inside the Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { COMMAND_IDS, JUDGE_SETUP_PANEL_VIEW_TYPE } from '../../src/shared/constants'
import { waitForTab } from './tabs'

// The host prefixes a panel's view type (`mainThreadWebview-…`), so the
// match is a suffix.
function isWizardTab(candidate: vscode.Tab): boolean {
  return (
    candidate.input instanceof vscode.TabInputWebview &&
    candidate.input.viewType.includes(JUDGE_SETUP_PANEL_VIEW_TYPE)
  )
}

suite('Set Up Local Judge', () => {
  test('the palette command opens the wizard panel, which closes cleanly', async () => {
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes(COMMAND_IDS.setUpLocalJudge), 'setup command not registered')
    await vscode.commands.executeCommand(COMMAND_IDS.setUpLocalJudge)
    const tab = await waitForTab(isWizardTab)
    assert.equal(tab.label, 'Set Up Local Judge')
    await vscode.window.tabGroups.close(tab)
  })
})
