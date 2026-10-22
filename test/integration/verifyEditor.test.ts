// The verify loop's editor side against VS Code itself (M68, PLAN.md D49):
// the built-in TypeScript and JSON servers' diagnostics for files written on
// disk, which they report only once an editor shows the file, and the JSON
// formatter through `vscode.executeFormatDocumentProvider`. Runs inside the
// Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { canonicalPath } from '../../src/host/canonicalPath'
import type { VerifyEditor } from '../../src/host/editor/verifyEditor'
import { createDeferredVerifyEditor } from '../../src/host/editor/verifyEditorBundle'
import { EXTENSION_QUALIFIED_ID } from '../../src/shared/constants'
import { createLogger } from '../../src/host/logger'
import { removeFolder } from '../unit/helpers/temporaryFolders'

// A server that is still starting can take seconds to report here; the
// product waits less (DIAGNOSTICS_SETTLE_*), and the unit tests cover that
// timing. The TypeScript server's cold start is the slow one.
const SETTLE = { firstMs: 12_000, quietMs: 1500, maxMs: 15_000 }
const messages: string[] = []

const FORMAT = { syncMs: 2000, pollMs: 50, formatMs: 12_000 }

suite('verify loop in VS Code (M68)', () => {
  let folder: string
  let verify: VerifyEditor
  let hasTypeScript = true
  const diagnosticsSnapshots: unknown[] = []
  let observe: ReturnType<typeof setInterval> | undefined
  let reports = 0
  let reportSubscription: vscode.Disposable | undefined
  const channel = vscode.window.createOutputChannel('M68 verify', { log: true })

  suiteSetup(async () => {
    const languages = await vscode.languages.getLanguages()
    hasTypeScript = languages.includes('typescript')
    if (!hasTypeScript) assert.ok(vscode.extensions.getExtension('dankeboy36.vscode-arduino-api'))
    // Its real form, as confinement hands the loop every path (the Codex review of PR #54).
    folder = await canonicalPath(await mkdtemp(path.join(tmpdir(), 'm68-verify-')))
    if (process.env['MUSE_ARDUINO_RESULT'] !== undefined) {
      reportSubscription = vscode.languages.onDidChangeDiagnostics(() => {
        reports += 1
      })
      observe = setInterval(() => {
        const snapshot = vscode.window.visibleTextEditors
          .filter((editor) => editor.document.uri.fsPath.startsWith(folder))
          .map((editor) => ({
            file: path.basename(editor.document.uri.fsPath),
            language: editor.document.languageId,
            diagnostics: vscode.languages
              .getDiagnostics(editor.document.uri)
              .map((entry) => entry.message),
            jsonProviderActive: vscode.extensions.getExtension('vscode.json-language-features')
              ?.isActive,
          }))
        if (JSON.stringify(snapshot) !== JSON.stringify(diagnosticsSnapshots.at(-1)))
          diagnosticsSnapshots.push(snapshot)
      }, 500)
    }
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, 'installed extension missing')
    verify = createDeferredVerifyEditor(
      {
        platform: process.platform,
        log: {
          ...createLogger(channel),
          warn: (message) => {
            messages.push(message)
            channel.warn(message)
          },
        },
        workspaceRoot: folder,
        realPath: canonicalPath,
        settle: SETTLE,
        format: FORMAT,
      },
      vscode.Uri.joinPath(extension.extensionUri, 'dist').fsPath,
    )
  })

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    clearInterval(observe)
    reportSubscription?.dispose()
    verify.dispose()
    channel.dispose()
    await removeFolder(folder)
  })

  test('shows edited files no editor showed, and reads what their servers report', async () => {
    const files = [
      { relative: 'broken.ts', text: "const a: number = 'text'\nexport { a }\n" },
      { relative: 'broken.json', text: '{\n  "a": 1\n  "b": 2\n}\n' },
    ]
    for (const file of files) {
      await writeFile(path.join(folder, file.relative), file.text)
    }
    const results = await verify.diagnosticsAfterEdit(
      files.map((file) => ({
        relative: file.relative,
        absolute: path.join(folder, file.relative),
      })),
      new AbortController().signal,
    )
    const errors = results.map((result) =>
      result.entries.filter((entry) => entry.severity === 'error').map((entry) => entry.message),
    )
    assert.deepEqual(
      errors,
      [
        hasTypeScript ? ["Type 'string' is not assignable to type 'number'."] : [],
        ['Expected comma'],
      ],
      JSON.stringify({ results, messages }),
    )
    // Missing TS service is explicitly unchecked, never an empty clean report.
    if (!hasTypeScript) assert.equal(results[0]?.unchecked, 'noReport')
    assert.equal(results[1]?.unchecked, undefined)
    const fallbackEntries = results[1]?.entries.filter(
      (entry) => entry.source === 'muse-spark-json',
    )
    assert.equal(
      fallbackEntries?.length,
      hasTypeScript ? 0 : 1,
      'native JSON reports must not duplicate',
    )
    assert.equal(results[1]?.entries[0]?.line, 3)
    // The tabs it opened are closed again (the M68 review).
    const shown = new Set(
      files.map((file) => vscode.Uri.file(path.join(folder, file.relative)).toString()),
    )
    const left = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter(
        (tab) => tab.input instanceof vscode.TabInputText && shown.has(tab.input.uri.toString()),
      )
    assert.deepEqual(left, [])
    assert.deepEqual(
      vscode.window.visibleTextEditors.filter((editor) =>
        shown.has(editor.document.uri.toString()),
      ),
      [],
    )
  })

  // The JSON server clears a file's diagnostics when its tab closes (this
  // test found it), so the tool gets what was read while the file showed.
  test('settles one file for the diagnostics tool, read before its tab closes', async () => {
    const absolute = path.join(folder, 'tool.json')
    await writeFile(absolute, '[1 2]\n')
    const read = await verify.settleFile(absolute)
    assert.ok(
      read !== undefined && read.length > 0,
      `nothing reported for the file the tool named: ${messages.join('; ')}`,
    )
    assert.equal(read[0]?.path, 'tool.json')
  })

  test('formats a JSON file the tool wrote with the built-in formatter', async () => {
    const absolute = path.join(folder, 'flat.json')
    const written = '{"a":1,"b":[1,2]}'
    await writeFile(absolute, written)
    const resultPath = process.env['MUSE_ARDUINO_RESULT']
    if (resultPath !== undefined) {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute))
      const formatting = await vscode.commands.executeCommand(
        'vscode.executeFormatDocumentProvider',
        document.uri,
        { tabSize: 2, insertSpaces: true },
      )
      await writeFile(
        path.join(path.dirname(resultPath), 'host-api-capture.json'),
        JSON.stringify(
          {
            formatting,
            diagnosticsSnapshots,
            reports,
            jsonProviderActive: vscode.extensions.getExtension('vscode.json-language-features')
              ?.isActive,
            languages: await vscode.languages.getLanguages(),
            visibleEditors: vscode.window.visibleTextEditors.map((editor) => ({
              path: path.basename(editor.document.uri.fsPath),
              language: editor.document.languageId,
              column: editor.viewColumn,
            })),
            tabs: vscode.window.tabGroups.all.flatMap((group) =>
              group.tabs.map((tab) => ({
                label: tab.label,
                input: tab.input,
                column: group.viewColumn,
                isActive: tab.isActive,
              })),
            ),
          },
          null,
          2,
        ),
      )
    }
    const formatted = await verify.formatAfterEdit(absolute, written)
    assert.ok(formatted !== undefined, 'the formatter changed nothing')
    assert.deepEqual(JSON.parse(formatted), JSON.parse(written))
    assert.ok(formatted.includes('\n'), `not formatted: ${formatted}`)
  })
})
