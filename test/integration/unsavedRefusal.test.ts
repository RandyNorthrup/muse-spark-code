// A dirty editor buffer through the product's own wiring (M49, PLAN.md
// D27): the standalone headless suites prove the false answer where no
// editor exists; only a real VS Code holds a dirty buffer, so the true
// answer is proved here. A real document is dirtied in the editor, and
// the product's own headless ToolIo construction — wired exactly as
// src/extension.ts wires it — reports the file unsaved, so the memory
// store refuses a replacement over it; saving clears both. Runs inside
// the Extension Development Host (see .vscode-test.mjs).
import * as assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { createToolIo } from '../../src/host/backend/toolIo'
import { createMemoryIo, systemPath } from '../../src/host/backend/memoryIo'
import { MemoryStore } from '../../src/core/memory/memoryStore'
import { FILE_REFUSAL_MODEL_TEXT, MENTION_INDEX_LIMIT } from '../../src/shared/constants'
import { walkFiles } from '../../src/runtime/fileWalk'
import type { Logger } from '../../src/host/logger'

const silentLog: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

suite('unsaved buffers refuse memory writes (D27)', () => {
  let root = ''
  let workspace = ''
  let dataRoot = ''

  suiteSetup(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'muse-unsaved-'))
    workspace = path.join(root, 'ws')
    dataRoot = path.join(root, 'data')
    await mkdir(path.join(workspace, '.agents', 'memory', 'notes'), { recursive: true })
  })

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await rm(root, { recursive: true, force: true })
  })

  test('a dirty document reports unsaved and refuses a note replacement', async () => {
    // The product's own ToolIo construction, wired as src/extension.ts
    // wires it: the editors open with unsaved changes, as VS Code names
    // them, compared with the product's isSamePath.
    const toolIo = createToolIo({
      platform: process.platform,
      listFiles: (signal) => walkFiles(workspace, MENTION_INDEX_LIMIT, silentLog, signal),
      workspaceRoot: workspace,
      systemRoot: process.env['SystemRoot'],
      env: () => process.env,
      searchWorkerPath: '',
      log: () => undefined,
      unsavedFiles: () =>
        vscode.workspace.textDocuments
          .filter((document) => document.isDirty && document.uri.scheme === 'file')
          .map((document) => document.uri.fsPath),
    })
    const memoryIo = createMemoryIo(toolIo, { warn: () => undefined })
    const store = new MemoryStore({
      io: memoryIo,
      platform: process.platform,
      dataRoot: () => dataRoot,
      workspaceRoot: workspace,
      systemPath,
      warn: () => undefined,
    })
    const place = await store.locate('project', 'notes/dirty.md')
    if (!place.ok) throw new Error(`locate failed: ${place.reason}`)
    const created = await store.add(place.value, { content: 'saved words' })
    assert.equal(created.ok, true)

    const absolute = place.value.absolute
    assert.equal(toolIo.hasUnsavedChanges(absolute), false)
    const document = await vscode.workspace.openTextDocument(absolute)
    const editor = await vscode.window.showTextDocument(document)
    try {
      await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), 'unsaved header\n')
      })
      assert.equal(editor.document.isDirty, true)
      // The true answer a headless suite cannot give: a real dirty buffer.
      assert.equal(toolIo.hasUnsavedChanges(absolute), true)
      assert.equal(memoryIo.hasUnsavedChanges(absolute), true)
      const refused = await store.add(place.value, { content: 'more words' })
      if (refused.ok) throw new Error('a dirty note must refuse the append')
      assert.ok(refused.reason.includes(absolute))
      assert.ok(refused.reason.includes(FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges))
      const refusedEdit = await store.edit(place.value, {
        old_str: 'saved words',
        new_str: 'other words',
      })
      assert.equal(refusedEdit.ok, false)

      await editor.document.save()
      assert.equal(toolIo.hasUnsavedChanges(absolute), false)
      const afterSave = await store.add(place.value, { content: 'after save' })
      assert.equal(afterSave.ok, true)
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    }
  })
})
