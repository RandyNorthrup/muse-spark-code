// Tab's provider inside the real extension host (M94, PLAN.md D73): the
// provider, the status bar and the shim run from source against a local fake
// Model API. `editor.action.inlineSuggest.trigger` then `commit` changes the
// document and the item's command runs a fixture `afterTabFileEdit`;
// `acceptNextWord` inserts one word and the inference fires. The completion
// engine is the test's explicit seam (lane C owns the pipeline): it POSTs
// the redacted window the provider hands it to the fake server. Lane W
// points this file at the dev build's dist/tab.js; until then it loads the
// entry the same way, through the shim's loader seam.

import * as assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import * as vscode from 'vscode'
import {
  createTabActivation,
  type TabAcceptedEdit,
  type TabReportedUsage,
} from '../../src/host/tab/tabBundle'
import * as tabEntry from '../../src/host/tab/tabEntry'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { SYNTHETIC } from '../unit/helpers/syntheticTokens'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'

const TRIGGER_TIMEOUT_MS = 15_000
const TRIGGER_POLL_MS = 100
const FIXTURE_NAME = 'tab-fixture.ts'
const COMPLETION = 'foo(bar)'
const USAGE: TabReportedUsage = { inputTokens: 10, cachedTokens: 2, outputTokens: 3 }

function fixtureText(): string {
  return `const key = "${SYNTHETIC.awsAccessKey}"\nconst y = `
}

async function startFakeModelApi(received: string[]): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      received.push(body)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ completion: COMPLETION }))
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  assert.ok(address !== null && typeof address !== 'string', 'fake server has no port')
  return { server, url: `http://127.0.0.1:${String(address.port)}/complete` }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve()
        return
      }
      reject(error)
    })
  })
}

suite('tab completions', () => {
  test('trigger then commit accepts, and acceptNextWord infers, past the redactor', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'no workspace folder')
    const received: string[] = []
    const { server, url } = await startFakeModelApi(received)
    const edits: TabAcceptedEdit[] = []
    const log = new FakeLogOutputChannel()
    const root = folder.uri.fsPath
    const tab = createTabActivation({
      bundlePath: '<test seam: the entry module>',
      log,
      loadBundle: () => tabEntry,
      isTabSettingOn: () => true,
      tabSettings: () => ({
        tabModel: 'muse-spark-1.3',
        tabLanguages: { '*': true },
        tabMultiline: 'auto',
        tabTrigger: 'automatic',
        tabWithCopilot: 'yield',
        tabDailyBudgetUsd: 1,
      }),
      isPaidOn: () => true,
      isKeyStored: () => true,
      isTrusted: () => vscode.workspace.isTrusted,
      ensureKeyPresence: () => undefined,
      updateSetting: () => Promise.resolve(),
      registerCommand: (id, run) => vscode.commands.registerCommand(id, (...args: unknown[]) => run(...args)),
      relativeInWorkspace: (uri) => {
        if (uri.scheme !== 'file') {
          return undefined
        }
        const relative = path.relative(root, uri.fsPath)
        return relative === '' || relative.startsWith('..') ? undefined : relative.split(path.sep).join('/')
      },
      foreignSetting: () => undefined,
      isCopilotExtensionPresent: () => false,
      filesExclude: () => ({}),
      workspaceRoots: () => [root],
      ignoreFileExists: () => false,
      runGit: () => Promise.reject(new Error('no git in the integration window')),
      onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
      onDidChangeTextDocument: (listener) =>
        vscode.workspace.onDidChangeTextDocument((event) => {
          listener({
            changes: event.contentChanges.map((change) => ({
              uriString: event.document.uri.toString(),
              insertedText: change.text,
              startLine: change.range.start.line,
              startCharacter: change.range.start.character,
              endLine: change.range.end.line,
              endCharacter: change.range.end.character,
            })),
          })
        }),
      activeLanguageId: () => vscode.window.activeTextEditor?.document.languageId,
      knownLanguages: async (): Promise<readonly string[]> => [
        ...(await vscode.languages.getLanguages()),
      ],
      confirmCopilotDisable: () => Promise.resolve(false),
      disableCopilotFor: () => Promise.resolve(),
      openAccountUsage: () => Promise.resolve(),
      runCommand: () => Promise.resolve(),
      table: () => UI_TEXT,
      locale: () => vscode.env.language,
      snoozeStore: {
        readSnoozedUntil: () => undefined,
        writeSnoozedUntil: () => Promise.resolve(),
        nowMs: () => Date.now(),
      },
      engine: {
        complete: async (snapshot) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              path: snapshot.relativePath,
              languageId: snapshot.languageId,
              prefix: snapshot.prefix,
              suffix: snapshot.suffix,
            }),
          })
          const answer: unknown = await response.json()
          const completion =
            typeof answer === 'object' &&
            answer !== null &&
            'completion' in answer &&
            typeof answer.completion === 'string'
              ? answer.completion
              : undefined
          assert.ok(completion !== undefined, 'the fake server answered no completion')
          return { completion, usage: USAGE }
        },
      },
      spend: {
        reserve: () => Promise.resolve(true),
        settle: () => undefined,
        todayTotalUsd: () => 0,
        todayRequests: () => 0,
      },
      consent: { requestUse: () => Promise.resolve(true) },
      hooks: {
        beforeRead: () => Promise.resolve(true),
        afterEdit: (edit) => {
          edits.push(edit)
        },
      },
    })
    const target = vscode.Uri.joinPath(folder.uri, FIXTURE_NAME)
    let document: vscode.TextDocument | undefined
    try {
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(fixtureText()))
      document = await vscode.workspace.openTextDocument(target)
      assert.ok(document, 'no document')
      await vscode.window.showTextDocument(document)
      const position = new vscode.Position(1, 10)
      const editor = vscode.window.activeTextEditor
      assert.ok(editor, 'no active editor')
      editor.selection = new vscode.Selection(position, position)

      // A full accept: trigger, then commit the ghost text.
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')
      const deadline = Date.now() + TRIGGER_TIMEOUT_MS
      while (document.getText() === fixtureText() && Date.now() < deadline) {
        await vscode.commands.executeCommand('editor.action.inlineSuggest.commit')
        await new Promise((resolve) => setTimeout(resolve, TRIGGER_POLL_MS))
      }
      assert.equal(document.getText(), `${fixtureText()}${COMPLETION}`)
      assert.equal(edits.length, 1)
      const full = edits[0]
      assert.ok(full !== undefined, 'no accept was observed')
      assert.equal(full.inferred, false)
      assert.equal(full.newString, COMPLETION)
      // Lines and columns count from 1 (D73).
      assert.equal(full.range.startLineNumber, 2)
      assert.equal(full.range.startColumn, 11)
      // Every byte sent passed the redactor: the secret is only the mark.
      assert.ok(received.length > 0, 'the fake server saw no request')
      for (const body of received) {
        assert.ok(!body.includes(SYNTHETIC.awsAccessKey), 'a secret reached the wire')
      }
      assert.ok(received.some((body) => body.includes(REDACTED_MARK)), 'no redaction mark sent')

      // A partial accept: trigger again, then take one word.
      received.length = 0
      edits.length = 0
      const resetRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      )
      await editor.edit((builder) => {
        builder.replace(resetRange, fixtureText())
      })
      editor.selection = new vscode.Selection(position, position)
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')
      const wordDeadline = Date.now() + TRIGGER_TIMEOUT_MS
      while (received.length === 0 && Date.now() < wordDeadline) {
        await new Promise((resolve) => setTimeout(resolve, TRIGGER_POLL_MS))
      }
      assert.ok(received.length > 0, 'no second suggestion was requested')
      await new Promise((resolve) => setTimeout(resolve, 500))
      await vscode.commands.executeCommand('editor.action.inlineSuggest.acceptNextWord')
      assert.equal(document.getText(), `${fixtureText()}foo`)
      assert.equal(edits.length, 1)
      const partial = edits[0]
      assert.ok(partial !== undefined, 'no inference was observed')
      assert.equal(partial.inferred, true)
      assert.equal(partial.newString, 'foo')
    } finally {
      tab.dispose()
      await closeServer(server)
      // Saved before closing, so no save prompt can hang the run.
      await document?.save()
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      try {
        await vscode.workspace.fs.delete(target)
      } catch {
        // The file may already be gone; the workspace stays clean either way.
      }
    }
  })
})
