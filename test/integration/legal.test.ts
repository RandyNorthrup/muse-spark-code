// The installed package's real lazy scanner; adapters use fake transports.
import * as assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import { EXTENSION_QUALIFIED_ID, COMMAND_IDS } from '../../src/shared/constants'
import { isLegalScanBundle } from '../../src/host/ide/legalScanBundle'
import { requireFile } from '../../src/host/lazyBundle'
import { legalScanResultSchema } from '../../src/shared/legal'
import { runLegalScanCall } from '../../src/core/backends/modelapi/legalScanTool'
import { ideLegalScanTools } from '../../src/host/ide/legalScanTool'
import { createLogger } from '../../src/host/logger'

suite('M97 shipped scanner', () => {
  test('command palette scan runs in an open panel without sign-in', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    await extension.activate()
    await vscode.commands.executeCommand(COMMAND_IDS.openInNewTab)
    await vscode.commands.executeCommand(COMMAND_IDS.legalScan)
  })

  test('shipped scanner and data drive identical native/MCP facts without a model', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    assert.ok(extension)
    assert.ok(root)
    const loaded = requireFile(path.join(extension.extensionPath, 'dist', 'legalScan.js'))
    assert.ok(isLegalScanBundle(loaded), 'missing scanner/hold exports')
    for (const name of ['NOTICE.md', 'provenance.json']) {
      assert.ok(
        existsSync(path.join(extension.extensionPath, 'src', 'core', 'legal', 'data', name)),
      )
    }
    const signal = new AbortController().signal
    const runner = async () => {
      const handle = await loaded.runLegalScan({ workspaceRoot: root, input: {}, signal })
      return legalScanResultSchema.parse(handle.result)
    }
    const expected = await runner()
    const native = await runLegalScanCall({}, runner, true, signal)
    assert.ok(native.ok)
    assert.deepEqual(legalScanResultSchema.parse(JSON.parse(native.json)), expected)
    const channel = vscode.window.createOutputChannel('M97 installed fixture', { log: true })
    try {
      const [tool] = ideLegalScanTools({
        isOffered: () => true,
        runScan: runner,
        log: createLogger(channel),
      })
      assert.ok(tool)
      const answer = await tool.call({}, signal)
      assert.deepEqual(legalScanResultSchema.parse(JSON.parse(answer)), expected)
    } finally {
      channel.dispose()
    }
  })
})
