import * as assert from 'node:assert/strict'
import { realpath, writeFile } from 'node:fs/promises'
import * as vscode from 'vscode'
import { createVscodeHostServices } from '../../../src/host/vscode/hostServices'
import { vscodeLanguageServices } from '../../../src/host/vscode/codeIntel/languageServices'
import { createVerifyEditor } from '../../../src/host/vscode/editor/verifyEditor'
import { createLogger } from '../../../src/host/logger'
import { createRuntimeCodeIntel } from '../../../src/runtime/features/codeIntel'
import { COMMAND_IDS, EXTENSION_QUALIFIED_ID, MHP } from '../../../src/shared/constants'

// A real Windows terminal writes and exits through the editor's pty host.
const TERMINAL_POLL_ATTEMPTS = 100
const TERMINAL_POLL_MS = 50

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

  const cellText = "const cell = '😀'"
  const notebookData = new vscode.NotebookData([
    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cellText, 'typescript'),
  ])
  const serializer = vscode.workspace.registerNotebookSerializer('m104-pd-fixture', {
    deserializeNotebook: () => notebookData,
    serializeNotebook: () => {
      throw new Error('M104_FIXTURE_NOTEBOOK_IS_READ_ONLY')
    },
  })
  try {
    const notebook = await vscode.workspace.openNotebookDocument('m104-pd-fixture', notebookData)
    const notebookEditor = await vscode.window.showNotebookDocument(notebook)
    notebookEditor.selections = [new vscode.NotebookRange(0, 1)]
    const cell = notebook.cellAt(0).document
    assert.equal(cell.uri.scheme, 'vscode-notebook-cell')
    const cellEmoji = cellText.indexOf('😀')
    const cellEditor = await vscode.window.showTextDocument(cell, {
      selection: new vscode.Range(0, cellEmoji, 0, cellEmoji + '😀'.length),
    })
    assert.equal(cellEditor.document, cell)
    const cellRead = await host.request('documents/read', { uri: cell.uri.toString() })
    assert.equal(cellRead.text, cellText)
    assert.equal(cellRead.document.version, cell.version)
    assert.equal(cellRead.document.languageId, 'typescript')
    const cellActive = await host.request('editor/active', {})
    assert.ok(cellActive)
    assert.equal(cellActive.uri, cell.uri.toString())
    assert.equal(cellActive.excerpt, '😀')
    assert.equal(cellActive.range.end.character - cellActive.range.start.character, '😀'.length)
    cellEditor.selection = new vscode.Selection(0, 0, 0, 0)
    const moved = await host.request('editor/active', {})
    assert.ok(moved)
    assert.equal(moved.range.start.character, 0)
    assert.equal(moved.range.end.character, 0)
    receipts.push(
      'native notebook-cell read/UTF-16 selection sees the current caret after movement',
    )
  } finally {
    serializer.dispose()
    await vscode.window.showTextDocument(document)
  }

  const typescript = vscode.extensions.getExtension('vscode.typescript-language-features')
  assert.ok(typescript)
  await typescript.activate()
  const languageUri = vscode.Uri.joinPath(root, 'language services Ω.ts')
  const languageDocument = await vscode.workspace.openTextDocument(languageUri)
  await vscode.window.showTextDocument(languageDocument)
  const language = vscodeLanguageServices()
  const call = { line: 1, character: languageDocument.lineAt(1).text.indexOf('m104Double') + 1 }
  const definitions = await language.definitions(languageUri.fsPath, call)
  assert.ok(
    definitions.some(
      (item) =>
        item.path?.replaceAll('\\', '/').toLowerCase() ===
          languageUri.fsPath.replaceAll('\\', '/').toLowerCase() && item.range.start.line === 0,
    ),
  )
  const references = await language.references(languageUri.fsPath, call)
  assert.ok(references.some((item) => item.range.start.line === 0))
  assert.ok(references.some((item) => item.range.start.line === 1))
  const hover = await language.hover(languageUri.fsPath, call)
  assert.ok(hover.some((part) => part.includes('m104Double')))
  const symbols = await language.documentSymbols(languageUri.fsPath)
  assert.ok(symbols.some((symbol) => symbol.name === 'm104Double'))
  assert.ok(symbols.some((symbol) => symbol.name === 'result'))
  const hierarchy = await language.callHierarchy(languageUri.fsPath, call, 'incoming')
  assert.ok(hierarchy)
  assert.equal(hierarchy.item.name, 'm104Double')
  assert.ok(hierarchy.calls.some((site) => site.ranges.some((range) => range.start.line === 1)))
  const rename = await language.rename(languageUri.fsPath, call, 'm104Twice')
  assert.equal(rename.fileOperations, 'none')
  assert.equal(rename.files.length, 1)
  assert.equal(rename.files[0]?.edits.length, 2)
  assert.ok(rename.files[0].edits.every((edit) => edit.newText === 'm104Twice'))
  assert.ok(languageDocument.getText().includes('m104Double'))
  receipts.push(
    'installed TypeScript service returns definition/references/hover/symbols/call hierarchy and a text-only rename plan',
  )

  let canUseTools = false
  const nativeLanguagePath = await realpath(languageUri.fsPath)
  const runtimeIntel = createRuntimeCodeIntel({
    host,
    workspaceRoot: root.fsPath,
    platform: process.platform,
    realPath: realpath,
    assertCurrent: () => undefined,
    canUseTools: () => canUseTools,
    libraryRoots: () => language.libraryRoots(),
  })
  try {
    await assert.rejects(
      runtimeIntel.service.definitions(nativeLanguagePath, call),
      /MHP_MODEL_TOOLS_UNAVAILABLE/u,
    )
    canUseTools = true
    const nativeDefinitions = await runtimeIntel.service.definitions(nativeLanguagePath, call)
    assert.ok(nativeDefinitions.some((item) => item.range.start.line === 0))
    const nativeReferences = await runtimeIntel.service.references(nativeLanguagePath, call)
    assert.ok(nativeReferences.some((item) => item.range.start.line === 1))
    const nativeHover = await runtimeIntel.service.hover(nativeLanguagePath, call)
    assert.ok(nativeHover.some((part) => part.includes('m104Double')))
    const nativeSymbols = await runtimeIntel.service.documentSymbols(nativeLanguagePath)
    assert.ok(nativeSymbols.some((item) => item.name === 'm104Double'))
    const workspaceSymbols = await runtimeIntel.service.workspaceSymbols('m104Double')
    assert.ok(workspaceSymbols.some((item) => item.name === 'm104Double()'))
    const nativeHierarchy = await runtimeIntel.service.callHierarchy(
      nativeLanguagePath,
      call,
      'incoming',
    )
    assert.equal(nativeHierarchy?.item.name, 'm104Double')
    const nativeRename = await runtimeIntel.service.rename(nativeLanguagePath, call, 'm104Twice')
    assert.equal(nativeRename.fileOperations, 'none')
    assert.equal(nativeRename.files[0]?.edits.length, 2)
    assert.ok(nativeRename.files[0].edits.every((edit) => edit.newText === 'm104Twice'))
    assert.ok(languageDocument.getText().includes('m104Double'))
    const prepared = await host.request('codeIntel/prepareRename', {
      uri: languageUri.toString(),
      position: call,
    })
    assert.equal(prepared?.placeholder, 'm104Double')
    const withoutDeclaration = await host.request('codeIntel/references', {
      uri: languageUri.toString(),
      position: call,
      includeDeclaration: false,
    })
    assert.ok(withoutDeclaration.some((item) => item.range.start.line === 1))
    assert.ok(withoutDeclaration.every((item) => item.range.start.line !== 0))
    receipts.push(
      'integrated runtime code intelligence uses all native query/rename methods through validated MHP and refuses a model without tools',
    )
  } finally {
    await runtimeIntel.dispose()
  }
  const formatPlan = await host.request('codeIntel/format', {
    uri: languageUri.toString(),
    expectedVersion: languageDocument.version,
    tabSize: 2,
    insertSpaces: true,
  })
  assert.ok(formatPlan.some((edit) => edit.newText.includes(' * ') || edit.newText === ' '))
  assert.equal(languageDocument.isDirty, false)
  await assert.rejects(
    host.request('codeIntel/format', {
      uri: languageUri.toString(),
      expectedVersion: languageDocument.version - 1,
      tabSize: 2,
      insertSpaces: true,
    }),
    /MHP_VERSION_CONFLICT/u,
  )
  receipts.push(
    'validated native formatting is an unwritten plan and refuses stale expected versions',
  )

  const output = vscode.window.createOutputChannel('M104 Windows Verify Fixture', { log: true })
  const verify = createVerifyEditor({
    platform: process.platform,
    workspaceRoot: root.fsPath,
    realPath: realpath,
    log: createLogger(output),
  })
  try {
    const nativePath = await realpath(languageUri.fsPath)
    const before = languageDocument.getText()
    const formatted = await verify.formatAfterEdit(nativePath, before)
    assert.ok(formatted)
    assert.ok(formatted.includes('value * 2'))
    assert.equal(languageDocument.getText(), before)
    assert.equal(languageDocument.isDirty, false)
    assert.equal(await verify.formatAfterEdit(nativePath, before + '\n// stale'), undefined)
    receipts.push('native formatter returns an unwritten plan and refuses a stale editor snapshot')
  } finally {
    verify.dispose()
    output.dispose()
  }
  await vscode.window.showTextDocument(document)

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

  const terminalHost = createVscodeHostServices({ globalState: state, workspaceState: state })
  assert.equal(process.env['M104_FIXTURE_API_KEY'], 'fixture-marker')
  const terminalCount = vscode.window.terminals.length
  try {
    const created = await terminalHost.request('terminal/create', {
      cwd: root.toString(),
      executable: 'C:/Windows/System32/cmd.exe',
      args: ['/d', '/q'],
      env: {},
    })
    assert.equal(vscode.window.terminals.length, terminalCount + 1)
    await terminalHost.request('terminal/show', created)
    await terminalHost.request('terminal/sendText', {
      ...created,
      text: 'if defined M104_FIXTURE_API_KEY (echo M104_LEAK>terminal-clean.txt) else (echo M104_CLEAN>terminal-clean.txt)',
      addNewLine: true,
    })
    const proof = vscode.Uri.joinPath(root, 'terminal-clean.txt')
    let result: string | undefined
    for (let attempt = 0; attempt < TERMINAL_POLL_ATTEMPTS; attempt++) {
      try {
        result = new TextDecoder().decode(await vscode.workspace.fs.readFile(proof)).trim()
        if (result !== '') break
      } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, TERMINAL_POLL_MS))
    }
    assert.equal(result, 'M104_CLEAN')
    receipts.push(
      'real native terminal executes in the fixture cwd with credential environment removed',
    )
  } finally {
    await terminalHost.request('shutdown', {})
    for (
      let attempt = 0;
      attempt < TERMINAL_POLL_ATTEMPTS && vscode.window.terminals.length > terminalCount;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, TERMINAL_POLL_MS))
    assert.equal(vscode.window.terminals.length, terminalCount)
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
  receipts.push('MHP 1.5 in-process schema boundary and shutdown refusal')

  const receiptPath = process.env['M104_PD_RESULT']
  assert.ok(receiptPath)
  await writeFile(
    receiptPath,
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
