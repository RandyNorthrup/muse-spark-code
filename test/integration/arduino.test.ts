import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { readArduinoSelection } from '../../src/host/arduino/boardContext'

suite('optional Arduino IDE board API (M103-A)', () => {
  test('reads the real provider when present and is absent in ordinary VS Code', async () => {
    const provider = vscode.extensions.getExtension<unknown>('dankeboy36.vscode-arduino-api')
    const selection = await readArduinoSelection({
      getExtension: (id) => vscode.extensions.getExtension<unknown>(id),
    })
    if (provider === undefined) {
      assert.equal(selection, undefined)
      return
    }
    assert.ok(selection)
    assert.equal(provider.isActive, true)
  })
})
