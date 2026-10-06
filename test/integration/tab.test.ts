// Tab's provider inside the real extension host (M94, PLAN.md D73): the
// provider runs from the dev build's dist/tab.js against a local fake
// Model API. `editor.action.inlineSuggest.trigger` then `commit` changes the
// document and the item's command runs a fixture `afterTabFileEdit`;
// `acceptNextWord` inserts one word and the inference fires. The bundle's
// own engine (lane C) and ledger (lane L) run; only the key client's stream
// is the test's: it POSTs the real request body to the fake server and
// replays its answer as Responses events. The activation shim and status
// item are bundled into this fixture, as in the extension's activation.

import * as assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import type { StreamEvent } from '../../src/core/backends/modelapi/schemas'
import {
  createTabActivation,
  tabTextChangeEvent,
  type TabAcceptedEdit,
} from '../../src/host/tab/tabBundle'
import {
  REDACTED_MARK,
  SETTING_DEFAULTS,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
  UI_TEXT,
} from '../../src/shared/constants'
import { SYNTHETIC } from '../unit/helpers/syntheticTokens'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'

const TRIGGER_TIMEOUT_MS = 15_000
const TRIGGER_POLL_MS = 100
const FIXTURE_NAME = 'tab-fixture.ts'
const COMPLETION = 'foo(bar)'
const FIXTURE_COMMAND_PREFIX = 'm94.fixture.'

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
    const fixtureCommands = new Map<string, string>()
    const log = new FakeLogOutputChannel()
    const root = folder.uri.fsPath
    const ledgerDirectory = mkdtempSync(path.join(tmpdir(), 'muse-tab-ledger-'))
    const tab = createTabActivation({
      bundlePath: path.resolve(__dirname, '..', '..', 'tab.js'),
      log,
      isTabSettingOn: () => true,
      tabSettings: () => ({ ...SETTING_DEFAULTS, tabTrigger: 'automatic' }),
      isPaidOn: () => true,
      isKeyStored: () => true,
      isTrusted: () => vscode.workspace.isTrusted,
      ensureKeyPresence: () => Promise.resolve(),
      updateSetting: () => Promise.resolve(),
      // Startup activation owns the real IDs; this fixture owns its handlers.
      registerCommand: (id, run) => {
        const fixtureId = `${FIXTURE_COMMAND_PREFIX}${id}`
        fixtureCommands.set(id, fixtureId)
        return vscode.commands.registerCommand(fixtureId, (...args: unknown[]) => run(...args))
      },
      realPath: async (absolutePath) => await realpath(absolutePath),
      registerProvider: (provider) =>
        vscode.languages.registerInlineCompletionItemProvider(
          { scheme: 'file' },
          {
            provideInlineCompletionItems: async (document, position, context, token) => {
              const result = await provider.provideInlineCompletionItems(
                document,
                position,
                context,
                token,
              )
              const items = Array.isArray(result) ? result : (result?.items ?? [])
              for (const item of items) {
                if (item.command === undefined) continue
                const command = fixtureCommands.get(item.command.command)
                assert.ok(command !== undefined, 'unregistered fixture accept command')
                item.command = { ...item.command, command }
              }
              return result
            },
          },
        ),
      setTabOnContext: () => undefined,
      foreignSetting: () => undefined,
      isCopilotExtensionPresent: () => false,
      filesExclude: () => ({}),
      workspaceRoots: () => [root],
      ignoreFileExists: () => false,
      runGit: () => Promise.reject(new Error('no git in the integration window')),
      onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
      onDidChangeTextDocument: (listener) =>
        vscode.workspace.onDidChangeTextDocument((event) => {
          listener(tabTextChangeEvent(event))
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
      services: {
        // The key client's stream, faked: the real body goes to the fake
        // server, and its answer comes back as Responses events.
        stream: (body) =>
          (async function* replay(): AsyncGenerator<StreamEvent> {
            const response = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
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
            yield {
              type: 'response.output_text.delta',
              item_id: 'item',
              delta: `${TAB_REPLY_OPEN_TAG}${completion}${TAB_REPLY_CLOSE_TAG}`,
            }
            yield {
              type: 'response.completed',
              response: {
                id: 'response',
                status: 'completed',
                output: [],
                usage: {
                  input_tokens: 10,
                  output_tokens: 3,
                  input_tokens_details: { cached_tokens: 2 },
                },
              },
            }
          })(),
        ledgerDirectory,
        windowId: 'integration',
        onSent: () => undefined,
        onUsage: () => undefined,
      },
      consent: { requestUse: () => Promise.resolve(true) },
      hooks: {
        beforeRead: () => Promise.resolve(true),
        afterEdit: (edit) => {
          edits.push(edit)
        },
      },
    })
    // Tab is on: register at once; the first request loads the bundle.
    tab.refresh()
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
      assert.ok(
        received.some((body) => body.includes(REDACTED_MARK)),
        'no redaction mark sent',
      )

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
      // The same prefix again: the typing-through cache answers it, with no
      // second request (D73).
      await new Promise((resolve) => setTimeout(resolve, 1000))
      assert.equal(received.length, 0, 'the cached suggestion was requested again')
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
      rmSync(ledgerDirectory, { recursive: true, force: true })
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
