// M104 lane H: the runtime's language server, `supervise` and `stop`, driven
// by the official LSP JSON-RPC client (`vscode-jsonrpc/node`, the library
// VS Code's own language client speaks) over the real stdio of the
// production build's `dist/acp.js`. Every per-user folder the runtime reads
// (its data folder, Muse Code's settings, the home folder) points into this
// suite's own folder, so the person's grants, ledger, hooks and runs never
// show through. No request is ever sent to a provider: every Tab request
// here stops before the credential store is read (no `--tab`, an untrusted
// workspace, or a `beforeTabFileRead` hook that gives no permission).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  CancellationTokenSource,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  type MessageConnection,
} from 'vscode-jsonrpc/node'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { agentDataFolder } from '../../src/runtime/dataFolder'
import {
  LSP_COMMANDS,
  LSP_SERVER_NOT_INITIALIZED,
  MHP_ERROR_CODES,
  SUPERVISED_FOLDER,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { assertCurrentProductionBuild } from './productionBuild'
import { removeFolder } from './helpers/temporaryFolders'

const ROOT = process.cwd()
const AGENT = path.join(ROOT, 'dist', 'acp.js')
const RECORDER = fileURLToPath(new URL('helpers/hookHoldRecorder.mjs', import.meta.url))
// A cold Windows hook start compiles its job helper once; the rest is fast.
const SUITE_MS = 240_000
const SAMPLE_TEXT = 'export const total = (a: number, b: number) => \n'
const AT_END = { line: 0, character: SAMPLE_TEXT.length - 1 }
const FOLDER = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-lsp-')))
const HOME = path.join(FOLDER, 'home')
// Every process a case started; one a failed case left running is ended after it.
const STARTED = new Set<ChildProcessWithoutNullStreams>()

interface Served {
  readonly connection: MessageConnection
  readonly child: ChildProcessWithoutNullStreams
  readonly messages: { readonly type: number; readonly message: string }[]
  readonly exited: Promise<number | null>
  stderr(): string
}

/** The runtime's per-user folders, all inside this suite's own folder. */
function environment(): NodeJS.ProcessEnv {
  return {
    ...withoutCredentials(process.env),
    HOME,
    USERPROFILE: HOME,
    LOCALAPPDATA: path.join(HOME, 'local'),
    APPDATA: path.join(HOME, 'roaming'),
    XDG_DATA_HOME: path.join(HOME, 'data'),
    XDG_CONFIG_HOME: path.join(HOME, 'config'),
    XDG_STATE_HOME: path.join(HOME, 'state'),
    GIT_CEILING_DIRECTORIES: FOLDER,
  }
}

function launch(args: readonly string[], cwd: string): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [AGENT, ...args], {
    cwd,
    env: environment(),
    stdio: 'pipe',
  })
  STARTED.add(child)
  child.once('close', () => {
    STARTED.delete(child)
  })
  return child
}

function exitOf(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  return new Promise((resolve) => {
    child.once('close', (code) => {
      resolve(code)
    })
  })
}

/** One command's exit code and what it printed. */
async function run(args: readonly string[], cwd: string): Promise<[number | null, string]> {
  const child = launch(args, cwd)
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
  })
  return [await exitOf(child), output.trim()]
}

/** A language server under the official client; a question is dismissed. */
function serve(args: readonly string[], cwd: string): Served {
  const child = launch(args, cwd)
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const exited = exitOf(child)
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  )
  const messages: { type: number; message: string }[] = []
  connection.onNotification('window/showMessage', (params: { type: number; message: string }) => {
    messages.push(params)
  })
  connection.onRequest('window/showMessageRequest', () => null)
  connection.listen()
  return { connection, child, messages, exited, stderr: () => stderr }
}

async function initialize(served: Served, workspace: string): Promise<unknown> {
  const result = await served.connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(workspace).href,
    capabilities: {
      workspace: { applyEdit: true },
      textDocument: { inlineCompletion: {} },
    },
  })
  await served.connection.sendNotification('initialized', {})
  return result
}

async function shutDown(served: Served): Promise<number | null> {
  await served.connection.sendRequest('shutdown')
  await served.connection.sendNotification('exit')
  const code = await served.exited
  served.connection.dispose()
  return code
}

/** The error a request answered with; a request that succeeded fails the test. */
async function refusalOf(request: Promise<unknown>): Promise<ResponseError<unknown>> {
  try {
    await request
  } catch (error: unknown) {
    if (error instanceof ResponseError) return error
    throw error
  }
  throw new Error('the request succeeded')
}

/** A workspace with one source file on disk, and the buffer an editor holds for it. */
async function workspaceWith(name: string): Promise<{ root: string; uri: string }> {
  const root = path.join(FOLDER, name)
  await mkdir(path.join(root, 'src'), { recursive: true, mode: 0o700 })
  const file = path.join(root, 'src', 'sample.ts')
  await writeFile(file, 'export {}\n')
  return { root: await realpath(root), uri: pathToFileURL(await realpath(file)).href }
}

async function openSample(served: Served, uri: string): Promise<void> {
  await served.connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri, languageId: 'typescript', version: 1, text: SAMPLE_TEXT },
  })
}

function inlineAtEnd(served: Served, uri: string, source?: CancellationTokenSource) {
  const params = { textDocument: { uri }, position: AT_END, context: { triggerKind: 1 } }
  return source === undefined
    ? served.connection.sendRequest('textDocument/inlineCompletion', params)
    : served.connection.sendRequest('textDocument/inlineCompletion', params, source.token)
}

function quoted(value: string): string {
  return `"${value}"`
}

/** A project hook file whose `beforeTabFileRead` records its input and gives no permission. */
async function recordingHook(root: string, capture: string, holdMs: number): Promise<void> {
  const command = [process.execPath, RECORDER, capture, String(holdMs)]
    .map((part) => quoted(part))
    .join(' ')
  await mkdir(path.join(root, '.muse'), { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(root, '.muse', 'spark-hooks.json'),
    JSON.stringify({ hooks: { beforeTabFileRead: [{ hooks: [{ type: 'command', command }] }] } }),
  )
}

/** Where the runtime keeps its supervised runs' records, under this suite's home. */
async function recordFiles(): Promise<string[]> {
  const folder = path.join(
    agentDataFolder({ platform: process.platform, env: environment(), homeDir: HOME }),
    SUPERVISED_FOLDER,
  )
  const names = await readdir(folder)
  return names.filter((name) => name.endsWith('.json'))
}

/**
A cold runtime's first hook can miss Tab's own hook bound (TAB_HOOK_TIMEOUT_MS)
while the resource governor takes its first reading: that read is refused, as
designed. Ask until the workspace's hook has answered once, then start clean.
*/
async function warmHook(served: Served, uri: string, capture: string): Promise<void> {
  const deadline = Date.now() + SUITE_MS / 2
  while (!existsSync(capture)) {
    if (Date.now() > deadline) throw new Error(`the hook never ran: ${served.stderr()}`)
    expect(await inlineAtEnd(served, uri)).toEqual({ items: [] })
  }
  await rm(capture)
}

async function waitFor(isDone: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!isDone()) {
    if (Date.now() > deadline) throw new Error('the condition never held')
    await delay(50)
  }
}

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  // Owner-only, as a profile is: the private records' ancestors are checked.
  mkdirSync(HOME, { recursive: true, mode: 0o700 })
})

afterEach(async () => {
  const left = [...STARTED]
  for (const child of left) child.kill('SIGKILL')
  await Promise.all(left.map((child) => exitOf(child)))
})

afterAll(async () => {
  await removeFolder(FOLDER)
})

describe('lsp over real stdio, under the official client', () => {
  it(
    'negotiates LSP 3.18 inline completions and the commands, and exits 0 after shutdown',
    async () => {
      const { root } = await workspaceWith('lifecycle')
      const served = serve(['lsp', '--workspace', root], root)
      expect(await initialize(served, root)).toMatchObject({
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 1 },
          completionProvider: { resolveProvider: false },
          inlineCompletionProvider: true,
          executeCommandProvider: { commands: Object.values(LSP_COMMANDS) },
        },
        serverInfo: { name: 'Muse Spark Code (Unofficial)' },
      })
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )

  it(
    'refuses a request before initialize, an unknown method and malformed parameters',
    async () => {
      const { root } = await workspaceWith('order')
      const served = serve(['lsp', '--workspace', root], root)
      const early = await refusalOf(served.connection.sendRequest('textDocument/completion', {}))
      expect(early.code).toBe(LSP_SERVER_NOT_INITIALIZED)
      await initialize(served, root)
      const unknown = await refusalOf(served.connection.sendRequest('textDocument/hover', {}))
      expect(unknown.code).toBe(MHP_ERROR_CODES.methodNotFound)
      const malformed = await refusalOf(
        served.connection.sendRequest('textDocument/inlineCompletion', { position: 'nowhere' }),
      )
      expect(malformed.code).toBe(MHP_ERROR_CODES.invalidParams)
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )

  it(
    'without --tab sends nothing, quiet at the paid gate before any read, and reports today',
    async () => {
      const { root, uri } = await workspaceWith('unpaid')
      const served = serve(['lsp', '--workspace', root, '--trust-workspace', '--verbose'], root)
      await initialize(served, root)
      await openSample(served, uri)
      expect(await inlineAtEnd(served, uri)).toEqual({ items: [] })
      const list = await served.connection.sendRequest('textDocument/completion', {
        textDocument: { uri },
        position: AT_END,
      })
      expect(list).toEqual([])
      expect(served.stderr()).toContain('Tab quiet (paid-off)')
      expect(served.stderr()).not.toContain('Tab quiet (no-key)')
      const usage = await served.connection.sendRequest('workspace/executeCommand', {
        command: LSP_COMMANDS.usage,
      })
      expect(usage).toEqual({
        isOn: false,
        model: 'muse-spark-1.3',
        todayUsd: '0',
        todayRequests: 0,
        budgetUsd: '0',
      })
      await served.connection.sendRequest('workspace/executeCommand', {
        command: LSP_COMMANDS.help,
      })
      await waitFor(() => served.messages.length >= 2, SUITE_MS / 2)
      expect(served.messages.map((message) => message.message)).toEqual([
        [EN.paidTabName, '0 Tab requests', 'Today: $0.00', EN.usagePaidTabBudgetNone].join('\n'),
        EN.languageServer.help.replace('{command}', 'muse-spark-code-acp'),
      ])
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )

  it(
    'with --tab in a trusted workspace runs beforeTabFileRead on the editor’s buffer and honours its refusal',
    async () => {
      const { root, uri } = await workspaceWith('hooked')
      const capture = path.join(FOLDER, 'hooked-capture.jsonl')
      await recordingHook(root, capture, 0)
      const served = serve(
        ['lsp', '--workspace', root, '--trust-workspace', '--tab', '--verbose'],
        root,
      )
      await initialize(served, root)
      await openSample(served, uri)
      await warmHook(served, uri, capture)
      expect(await inlineAtEnd(served, uri)).toEqual({ items: [] })
      expect(existsSync(capture), served.stderr()).toBe(true)
      const text = await readFile(capture, 'utf8')
      const lines = text.split('\n').filter((line) => line !== '')
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        hook_event_name: 'beforeTabFileRead',
        file_path: fileURLToPath(uri),
        workspace_roots: [root],
        model: 'muse-spark-1.3',
        content: SAMPLE_TEXT,
      })
      // The hook gave no permission, so nothing reached the key or a question.
      expect(served.stderr()).toContain('beforeTabFileRead: denied')
      expect(served.stderr()).toContain('Tab quiet (ineligible-file)')
      expect(served.stderr()).not.toContain('Tab quiet (no-key)')
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )

  it(
    'with --tab in an untrusted workspace reads nothing and runs no hook',
    async () => {
      const { root, uri } = await workspaceWith('untrusted')
      const capture = path.join(FOLDER, 'untrusted-capture.jsonl')
      await recordingHook(root, capture, 0)
      const served = serve(['lsp', '--workspace', root, '--tab', '--verbose'], root)
      await initialize(served, root)
      await openSample(served, uri)
      expect(await inlineAtEnd(served, uri)).toEqual({ items: [] })
      expect(served.stderr()).toContain('Tab quiet (untrusted)')
      expect(existsSync(capture)).toBe(false)
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )

  it(
    'answers a cancelled request with RequestCancelled while its hook still runs',
    async () => {
      const { root, uri } = await workspaceWith('cancelled')
      const capture = path.join(FOLDER, 'cancelled-capture.jsonl')
      await recordingHook(root, capture, 1000)
      const served = serve(['lsp', '--workspace', root, '--trust-workspace', '--tab'], root)
      await initialize(served, root)
      await openSample(served, uri)
      await warmHook(served, uri, capture)
      const source = new CancellationTokenSource()
      const pending = refusalOf(inlineAtEnd(served, uri, source))
      await waitFor(() => existsSync(capture), SUITE_MS / 2)
      source.cancel()
      const refusal = await pending
      expect(refusal.code).toBe(MHP_ERROR_CODES.cancelled)
      expect(await shutDown(served)).toBe(0)
    },
    SUITE_MS,
  )
})

describe('supervise and stop', () => {
  it(
    'serves the language server through the supervisor, and stop ends it from another process',
    async () => {
      const { root } = await workspaceWith('supervised')
      const served = serve(['supervise', 'lsp', '--workspace', root], root)
      await initialize(served, root)
      expect(await recordFiles()).toHaveLength(1)
      expect(await run(['stop'], root)).toEqual([0, 'Stopped 1 supervised run.'])
      expect(await served.exited).toBe(0)
      served.connection.dispose()
      expect(await recordFiles()).toEqual([])
    },
    SUITE_MS,
  )

  it(
    'stops the run muse.stop is sent from, and stop then finds nothing',
    async () => {
      const { root } = await workspaceWith('self-stopped')
      const served = serve(['supervise', 'lsp', '--workspace', root], root)
      await initialize(served, root)
      await served.connection.sendRequest('workspace/executeCommand', {
        command: LSP_COMMANDS.stop,
      })
      expect(await served.exited).toBe(0)
      served.connection.dispose()
      expect(await run(['stop'], root)).toEqual([1, EN.supervision.stopNone])
    },
    SUITE_MS,
  )

  it(
    'removes the record a killed supervisor left behind',
    async () => {
      const { root } = await workspaceWith('killed')
      const served = serve(['supervise', 'lsp', '--workspace', root], root)
      await initialize(served, root)
      served.child.kill('SIGKILL')
      await served.exited
      served.connection.dispose()
      expect(await recordFiles()).toHaveLength(1)
      expect(await run(['stop'], root)).toEqual([1, EN.supervision.stopNone])
      expect(await recordFiles()).toEqual([])
    },
    SUITE_MS,
  )
})
