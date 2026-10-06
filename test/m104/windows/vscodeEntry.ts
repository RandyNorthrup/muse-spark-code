import * as assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import * as vscode from 'vscode'
import { createVscodeHostServices } from '../../../src/host/vscode/hostServices'
import { COMMAND_IDS, EXTENSION_QUALIFIED_ID, MHP } from '../../../src/shared/constants'

/** Fresh host-service code runs in the installed editor; every file belongs to its fixture. */
export async function run(): Promise<void> {
  const receipts: string[] = []
  const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
  assert.ok(extension)
  await extension.activate()
  assert.equal(extension.isActive, true)
  const commands = await vscode.commands.getCommands(true)
  for (const command of Object.values(COMMAND_IDS)) assert.ok(commands.includes(command), command)
  receipts.push('extension activation and every contributed command registered')

  const root = vscode.workspace.workspaceFolders?.[0]?.uri
  assert.ok(root)
  const uri = vscode.Uri.joinPath(root, 'unicode space Ω.ts')
  const document = await vscode.workspace.openTextDocument(uri)
  const editor = await vscode.window.showTextDocument(document)
  const original = document.getText()
  const state = { get: () => undefined, update: () => Promise.resolve() }
  const host = createVscodeHostServices({ globalState: state, workspaceState: state })
  const read = await host.request('documents/read', { uri: uri.toString() })
  assert.equal(read.text, original)
  assert.equal(read.document.dirty, false)
  assert.equal(read.document.version, document.version)
  receipts.push('native read sees the clean editor snapshot on a Windows Unicode path')

  const changed = await host.request('documents/applyEdits', {
    uri: uri.toString(),
    expectedVersion: document.version,
    undoLabel: 'Fixture multi-edit',
    edits: [
      {
        range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
        newText: 'first',
      },
      {
        range: { start: { line: 1, character: 6 }, end: { line: 1, character: 11 } },
        newText: 'second',
      },
    ],
  })
  assert.equal(changed.dirty, true)
  assert.ok(document.getText().includes('const first'))
  assert.ok(document.getText().includes('const second'))
  await assert.rejects(
    host.request('editor/insertAtCursor', {
      uri: uri.toString(),
      expectedVersion: document.version,
      position: { line: 0, character: 0 },
      text: 'refused',
      undoLabel: 'Fixture insertion',
    }),
    /MHP_DIRTY_BUFFER/u,
  )
  await vscode.commands.executeCommand('undo')
  assert.equal(document.getText(), original)
  receipts.push('multi-edit is one native undo; current dirty insertion is refused')

  await assert.rejects(
    host.request('documents/applyEdits', {
      uri: uri.toString(),
      expectedVersion: read.document.version,
      undoLabel: 'Fixture stale edit',
      edits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: 'refused',
        },
      ],
    }),
    /MHP_VERSION_CONFLICT/u,
  )
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(
    host.request(
      'documents/save',
      { uri: uri.toString(), expectedVersion: document.version },
      abort.signal,
    ),
    /MHP_CANCELLED/u,
  )
  assert.equal(document.getText(), original)
  receipts.push('stale version and cancelled save have no editor effects')

  const emoji = document.lineAt(0).text.indexOf('😀')
  editor.selection = new vscode.Selection(0, emoji, 0, emoji + '😀'.length)
  const active = await host.request('editor/active', {})
  assert.ok(active)
  assert.equal(active.uri, uri.toString())
  assert.equal(active.excerpt, '😀')
  assert.equal(active.range.end.character - active.range.start.character, '😀'.length)
  receipts.push('selection/caret positions use the native UTF-16 snapshot')

  const diagnostics = vscode.languages.createDiagnosticCollection('m104-pd-fixture')
  try {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      'M104PD_FIXTURE',
      vscode.DiagnosticSeverity.Warning,
    )
    diagnostic.code = 'fixture'
    diagnostics.set(uri, [diagnostic])
    const result = await host.request('diagnostics/get', { uri: uri.toString() })
    assert.ok(
      result.some(
        (item) =>
          item.message === 'M104PD_FIXTURE' &&
          item.severity === 'warning' &&
          item.code === 'fixture',
      ),
    )
    receipts.push('native diagnostic collection is read with severity/range/code intact')
  } finally {
    diagnostics.dispose()
  }

  const result = await host.request('initialize', {
    host: { id: 'vscode', version: vscode.version },
    protocolRange: { minimum: MHP.version, maximumExclusive: MHP.maximumVersionExclusive },
    capabilities: ['lifecycle'],
    locale: vscode.env.language,
    theme: { kind: 'dark', tokens: {} },
    folders: [],
    trusted: vscode.workspace.isTrusted,
  })
  assert.equal(result.protocolVersion, MHP.version)
  await host.request('shutdown', {})
  await assert.rejects(host.request('window/state', {}), /MHP_HOST_CLOSED/u)
  receipts.push('MHP 1.2 in-process schema boundary and shutdown refusal')

  const output = process.env['M104_PD_RESULT']
  assert.ok(output)
  await writeFile(
    output,
    JSON.stringify(
      {
        editor: vscode.env.appName,
        version: vscode.version,
        arch: process.arch,
        platform: process.platform,
        locale: vscode.env.language,
        trusted: vscode.workspace.isTrusted,
        receipts,
        modelAttempts: 0,
      },
      null,
      2,
    ),
  )
}
