// M103's activation wiring through the real product (RLF-M103WIRE): the six
// maker commands register at activation behind the lazy bundles, and the
// non-modal ones run for real (disable, Stop with no machines, the empty
// device log as an untitled document). The modal commands (enable, add,
// remove) need a person at glass, so only their registration is proved
// here. Runs inside the Extension Development Host (see .vscode-test.mjs).
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { COMMAND_IDS, EXTENSION_QUALIFIED_ID, UI_TEXT } from '../../src/shared/constants'

const MAKER_COMMAND_IDS = [
  COMMAND_IDS.enableHardware,
  COMMAND_IDS.disableHardware,
  COMMAND_IDS.addMachine,
  COMMAND_IDS.removeMachine,
  COMMAND_IDS.stopMachine,
  COMMAND_IDS.openDeviceLog,
] as const

suite('maker commands in VS Code (M103)', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    await extension.activate()
  })
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  })

  test('the six maker commands are registered', async () => {
    const commands = await vscode.commands.getCommands(true)
    for (const id of MAKER_COMMAND_IDS) assert.ok(commands.includes(id), id)
  })

  test('disable, Stop and the empty device log run without a modal', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.disableHardware)
    await vscode.commands.executeCommand(COMMAND_IDS.stopMachine)
    await vscode.commands.executeCommand(COMMAND_IDS.openDeviceLog)
    const document = vscode.workspace.textDocuments.find(
      (candidate) =>
        candidate.isUntitled &&
        candidate.languageId === 'plaintext' &&
        candidate.getText() === UI_TEXT.makerEmptyLog,
    )
    assert.ok(document, 'the empty device log opens as an untitled document')
  })
})
