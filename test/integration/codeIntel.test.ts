// Code intelligence over a real TypeScript service (M67, PLAN.md D49): the
// tools' core and the host's adapter inside the Extension Development Host,
// over the fixture test/fixtures/workspace/code-intel (VS Code's built-in
// TypeScript extension answers). Nothing here writes: the rename is planned
// and its diff read.

import * as assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import type { CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { answerCodeIntel, type CodeIntelReadTool } from '../../src/core/codeIntel/codeIntelTools'
import { planRename, renameDiff } from '../../src/core/codeIntel/rename'
import { canonicalPath, isMissingPath } from '../../src/host/canonicalPath'
import { vscodeLanguageServices } from '../../src/host/codeIntel/languageServices'

const FIXTURE = 'code-intel'
// TypeScript answers once it has loaded the fixture's project.
const READY_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 250
// Each test may wait that long for the project, and ask several times.
const TEST_TIMEOUT_MS = 120_000

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

function depsFor(root: string): CodeIntelDeps {
  return {
    service: vscodeLanguageServices(),
    workspaceRoot: root,
    platform: process.platform,
    io: {
      realPath: canonicalPath,
      readFile: readText,
      listFiles: async () => {
        const found = await vscode.workspace.findFiles(`${FIXTURE}/**`)
        return found.map((uri) => vscode.workspace.asRelativePath(uri, false))
      },
      // The editors open with unsaved changes, as VS Code names them
      // (src/extension.ts wires the product's own ToolIo the same way).
      unsavedFiles: () =>
        vscode.workspace.textDocuments
          .filter((document) => document.isDirty && document.uri.scheme === 'file')
          .map((document) => document.uri.fsPath),
    },
    now: () => Date.now(),
  }
}

/** The tool's answer once it passes `isReady` (the project may still be loading). */
async function answerOnce(
  deps: CodeIntelDeps,
  tool: CodeIntelReadTool,
  args: Record<string, unknown>,
  isReady: (text: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    const answer = await answerCodeIntel(tool, args, deps)
    last = answer.ok ? answer.text : `refused: ${answer.reason}`
    if (isReady(last)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`${tool} never answered as expected; last answer: ${last}`)
}

suite('code intelligence over TypeScript (M67)', () => {
  let deps: CodeIntelDeps
  let hasTypeScript = true

  async function assertUnavailable(
    tool: CodeIntelReadTool,
    args: Record<string, unknown>,
  ): Promise<void> {
    const answer = await answerCodeIntel(tool, args, deps)
    assert.equal(answer.ok, false)
    assert.match(answer.reason, /no language service answered.*language plaintext/)
    assert.match(answer.reason, /use search and read_file instead/)
    assert.match(answer.visibleReason, /search and read_file/)
  }

  suiteSetup(async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    assert.ok(root, 'the fixture workspace is open')
    deps = depsFor(root)
    const capturePath = process.env['MUSE_HOST_CAPTURE']
    if (capturePath !== undefined) {
      const availableCommands = await vscode.commands.getCommands(false)
      await writeFile(
        capturePath,
        JSON.stringify(
          {
            vscode: vscode.version,
            commands: availableCommands.filter((command) => /rename/i.test(command)),
          },
          null,
          2,
        ),
      )
    }
    const languages = await vscode.languages.getLanguages()
    hasTypeScript = languages.includes('typescript')
    // Arduino ships no TS provider. Its explicit host expectation is an
    // actionable refusal, never invented semantic results or a skipped case.
    if (!hasTypeScript) assert.ok(vscode.extensions.getExtension('dankeboy36.vscode-arduino-api'))
    // TypeScript loads a project for an open file; workspace symbols need one.
    const main = vscode.Uri.file(path.join(root, FIXTURE, 'main.ts'))
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(main))
  })

  test('finds a definition across files, and leaves the library out, counted', async () => {
    if (!hasTypeScript) {
      await assertUnavailable('findDefinition', {
        path: `${FIXTURE}/main.ts`,
        line: 7,
        symbol: 'greet',
      })
      await assertUnavailable('findDefinition', {
        path: `${FIXTURE}/main.ts`,
        symbol: 'toUpperCase',
      })
      return
    }
    const own = await answerOnce(
      deps,
      'findDefinition',
      { path: `${FIXTURE}/main.ts`, line: 7, symbol: 'greet' },
      (text) => text.includes('greet.ts'),
    )
    assert.match(
      own,
      /code-intel\/greet\.ts:5:17: export function greet\(name: string\): string \{/,
    )
    const library = await answerOnce(
      deps,
      'findDefinition',
      { path: `${FIXTURE}/main.ts`, symbol: 'toUpperCase' },
      (text) => text.includes('left out'),
    )
    assert.match(library, /\[left out \d+ outside the workspace/)
  }).timeout(TEST_TIMEOUT_MS)

  test('finds every reference, the declaration included, in place order', async () => {
    if (!hasTypeScript) {
      await assertUnavailable('findReferences', { path: `${FIXTURE}/greet.ts`, symbol: 'greet' })
      return
    }
    const text = await answerOnce(
      deps,
      'findReferences',
      { path: `${FIXTURE}/greet.ts`, symbol: 'greet' },
      (answer) => answer.includes('main.ts:7'),
    )
    const places = text
      .split('\n')
      .filter((line) => line.startsWith(FIXTURE))
      .map((line) => line.split(': ', 1)[0])
    assert.deepEqual(places, [
      'code-intel/greet.ts:5:17',
      'code-intel/main.ts:3:10',
      'code-intel/main.ts:7:13',
      'code-intel/main.ts:7:29',
    ])
  }).timeout(TEST_TIMEOUT_MS)

  test('outlines, hovers, finds symbols and callers', async () => {
    if (!hasTypeScript) {
      await assertUnavailable('documentSymbols', { path: `${FIXTURE}/greet.ts` })
      await assertUnavailable('hover', { path: `${FIXTURE}/greet.ts`, symbol: 'greet' })
      await assertUnavailable('hover', { path: `${FIXTURE}/main.ts`, symbol: 'toUpperCase' })
      await assertUnavailable('callHierarchy', { path: `${FIXTURE}/greet.ts`, symbol: 'greet' })
      const symbols = await answerCodeIntel('workspaceSymbols', { query: 'greet' }, deps)
      assert.equal(symbols.ok, true)
      assert.match(symbols.text, /No workspace symbols match/)
      return
    }
    assert.match(
      await answerOnce(deps, 'documentSymbols', { path: `${FIXTURE}/greet.ts` }, (text) =>
        text.includes('greet'),
      ),
      /5:17 function greet/,
    )
    assert.match(
      await answerOnce(deps, 'hover', { path: `${FIXTURE}/greet.ts`, symbol: 'greet' }, (text) =>
        text.includes('function greet'),
      ),
      /Says hello to someone\./,
    )
    // Defined in TypeScript's bundled library, under VS Code's installation:
    // a library root, so the hover is shown, not held back.
    assert.match(
      await answerOnce(
        deps,
        'hover',
        { path: `${FIXTURE}/main.ts`, symbol: 'toUpperCase' },
        (text) => text.includes('toUpperCase'),
      ),
      /toUpperCase\(\): string/,
    )
    assert.match(
      await answerOnce(deps, 'workspaceSymbols', { query: 'greet' }, (text) =>
        text.includes('greet.ts'),
      ),
      /code-intel\/greet\.ts:5:17: function greet/,
    )
    assert.match(
      await answerOnce(
        deps,
        'callHierarchy',
        { path: `${FIXTURE}/greet.ts`, symbol: 'greet' },
        (text) => text.includes('main.ts'),
      ),
      /code-intel\/main\.ts:6:17: function main \(calls at 7:13, 7:29\)/,
    )
  }).timeout(TEST_TIMEOUT_MS)

  test('says "no language service" for plain text', async () => {
    const answer = await answerCodeIntel('documentSymbols', { path: `${FIXTURE}/notes.txt` }, deps)
    assert.equal(answer.ok, false)
    assert.match(
      answer.reason,
      /no language service answered for code-intel\/notes\.txt \(language plaintext\)/,
    )
  })

  test('plans a rename across both files and writes nothing', async () => {
    const before = await readText(path.join(deps.workspaceRoot, FIXTURE, 'main.ts'))
    const planned = await planRename(
      { path: `${FIXTURE}/greet.ts`, symbol: 'greet', new_name: 'welcome' },
      deps,
    )
    if (!hasTypeScript) {
      assert.equal(planned.ok, false)
      assert.match(planned.reason, /no language service answered/)
      assert.match(planned.visibleReason, /search and read_file/)
      assert.equal(await readText(path.join(deps.workspaceRoot, FIXTURE, 'main.ts')), before)
      return
    }
    assert.ok(planned.ok, planned.ok ? '' : planned.reason)
    assert.deepEqual(
      planned.plan.files.map((file) => file.relative),
      ['code-intel/greet.ts', 'code-intel/main.ts'],
    )
    const diff = renameDiff(planned.plan)
    assert.match(diff, /\+export function welcome\(name: string\): string \{/)
    assert.match(diff, /\+import \{ welcome \} from '\.\/greet'/)
    assert.equal(await readText(path.join(deps.workspaceRoot, FIXTURE, 'main.ts')), before)
  }).timeout(TEST_TIMEOUT_MS)
})
