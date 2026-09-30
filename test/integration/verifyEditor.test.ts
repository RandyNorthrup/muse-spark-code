// The verify loop's editor side against VS Code itself (M68, PLAN.md D49):
// the built-in TypeScript and JSON servers' diagnostics for files written on
// disk, which they report only once an editor shows the file, and the JSON
// formatter through `vscode.executeFormatDocumentProvider`. Runs inside the
// Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createVerifyEditor, type VerifyEditor } from '../../src/host/editor/verifyEditor'
import { createLogger } from '../../src/host/logger'

// A server that is still starting can take seconds to report here; the
// product waits less (DIAGNOSTICS_SETTLE_*), and the unit tests cover that
// timing. The TypeScript server's cold start is the slow one.
const SETTLE = { firstMs: 12_000, quietMs: 1500, maxMs: 15_000 }
const FORMAT = { syncMs: 2000, pollMs: 50, formatMs: 12_000 }

suite('verify loop in VS Code (M68)', () => {
  let folder: string
  let verify: VerifyEditor
  const channel = vscode.window.createOutputChannel('M68 verify', { log: true })

  suiteSetup(async () => {
    // Its real form, as confinement hands the loop every path (the Codex review of PR #54).
    folder = await canonicalPath(await mkdtemp(path.join(tmpdir(), 'm68-verify-')))
    verify = createVerifyEditor({
      platform: process.platform,
      log: createLogger(channel),
      workspaceRoot: folder,
      realPath: canonicalPath,
      settle: SETTLE,
      format: FORMAT,
    })
  })

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    channel.dispose()
    await rm(folder, { recursive: true, force: true })
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
    assert.deepEqual(errors, [
      ["Type 'string' is not assignable to type 'number'."],
      ['Expected comma'],
    ])
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
  })

  // The JSON server clears a file's diagnostics when its tab closes (this
  // test found it), so the tool gets what was read while the file showed.
  test('settles one file for the diagnostics tool, read before its tab closes', async () => {
    const absolute = path.join(folder, 'tool.json')
    await writeFile(absolute, '[1 2]\n')
    const read = await verify.settleFile(absolute)
    assert.ok(read !== undefined && read.length > 0, 'nothing reported for the file the tool named')
    assert.equal(read[0]?.path, 'tool.json')
  })

  test('formats a JSON file the tool wrote with the built-in formatter', async () => {
    const absolute = path.join(folder, 'flat.json')
    const written = '{"a":1,"b":[1,2]}'
    await writeFile(absolute, written)
    const formatted = await verify.formatAfterEdit(absolute, written)
    assert.ok(formatted !== undefined, 'the formatter changed nothing')
    assert.deepEqual(JSON.parse(formatted), JSON.parse(written))
    assert.ok(formatted.includes('\n'), `not formatted: ${formatted}`)
  })
})
