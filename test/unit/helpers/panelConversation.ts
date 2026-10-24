// Conversations in the runtime panel (M104 lane B): `runPanel` runs here in
// the suite's process over a pair of streams, with the editor on the other
// end. The conversation controller is the product's own, loaded from the
// shared production build; the backend is the product's own Model API host
// over a real file session store (`modelApiRig`, no key stored, a real
// providers file for its models), reported ready. A session starts and ends
// locally; no prompt is sent and no network is touched. The credential store
// is the machine's own and cannot be faked, so these suites hand the runtime
// one that fails the suite if it is ever read.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { runPanel } from '../../../src/runtime/panel/panelEntry'
import type { RuntimeBackend } from '../../../src/runtime/backends'
import { createRuntimeBackend } from '../../../src/runtime/runtimeEngineEntry'
import { stderrLogger } from '../../../src/runtime/stderrLog'
import { UI_TEXT } from '../../../src/shared/constants'
import type { MhpCapability } from '../../../src/shared/hostApi/capabilities'
import { panelInitializeResultSchema } from '../../../src/shared/hostApi/panel'
import type { PanelRuntimeDeps } from '../../../src/runtime/panel/panelEntry'
import { modelApiRig } from './conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './editorChatRig'
import { connectMhpHost, type MhpWire } from './mhpHost'
import { panelEditor } from './panelEditor'
import type { PanelRun } from './panelRun'

const ROOT = process.cwd()
const log = stderrLogger(() => undefined, 'warn')

/** A credential store that fails the suite if the runtime reads or writes it. */
const untouchedSecrets: PanelRuntimeDeps['github']['secrets'] = {
  get: () => Promise.reject(new Error('this suite never reads the credential store')),
  store: () => Promise.reject(new Error('this suite never writes the credential store')),
  delete: () => Promise.reject(new Error('this suite never clears the credential store')),
}

export interface ConnectedPanelOptions {
  readonly trusted?: boolean
  /** The user's git; none unless the suite proves git. */
  readonly runGit?: PanelRuntimeDeps['runGit']
  /** What the editor offers besides the chat itself (its services the suite answers). */
  readonly offers?: readonly MhpCapability[]
}

/** The runtime panel in this process, and the editor's end of its streams. */
export async function connectedPanel(run: PanelRun, options: ConnectedPanelOptions = {}) {
  const folder = path.join(run.folder, 'sessions')
  mkdirSync(folder, { recursive: true })
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, { ...(models !== undefined && { models }) })
  const runtimes: RuntimeBackend[] = []
  const unsaved: (() => readonly string[])[] = []
  const toRuntime = new PassThrough()
  const fromRuntime = new PassThrough()
  const runGit = options.runGit ?? (() => Promise.reject(new Error('this suite has no git')))
  const exit = runPanel(
    { workspace: run.workspace, isVerbose: false },
    {
      stdin: toRuntime,
      stdout: fromRuntime,
      table: UI_TEXT,
      locale: 'en',
      log,
      dataFolder: run.dataFolder,
      distDir: path.join(ROOT, 'dist'),
      // The product's own runtime; only the backend is the rig's host, reported ready.
      createRuntime: (serveOptions, questions, unsavedFiles) => {
        unsaved.push(unsavedFiles)
        const runtime = createRuntimeBackend({
          hostKind: 'acp',
          options: serveOptions,
          version: '0.19.0',
          distDir: path.join(ROOT, 'dist'),
          platform: process.platform,
          env: run.environment(),
          homeDir: run.home,
          secrets: untouchedSecrets,
          runGit: () => Promise.reject(new Error('this suite has no git')),
          fetch: () => Promise.reject(new Error('no request may leave the machine')),
          sleep: () => Promise.resolve(),
          log,
          questions,
          unsavedFiles,
        })
        const ready = {
          ...runtime,
          backend: {
            kind: 'modelApi' as const,
            readiness: () => Promise.resolve({ state: 'ready' as const }),
            hostFor: () => Promise.resolve(rig.host),
          },
        }
        runtimes.push(ready)
        return Promise.resolve(ready)
      },
      runGit,
      github: {
        secrets: untouchedSecrets,
        fetch: () => Promise.reject(new Error('no request may leave the machine')),
        userAgent: 'muse-spark-code/0.19.0',
      },
    },
  )
  const host = connectMhpHost(toRuntime, fromRuntime)
  const editor = panelEditor(host)
  panelInitializeResultSchema.parse(
    await host.request(
      'initialize',
      run.initializeParams({
        capabilities: ['lifecycle', 'ui', 'surfaces', 'terminal', ...(options.offers ?? [])],
        trusted: options.trusted ?? true,
      }),
    ),
  )
  return { host, editor, rig, exit, runtimes, unsaved }
}

/** The questions the editor was asked, and the answers it gives in turn (null closes the question). */
export function confirmations(
  host: MhpWire,
  answers: (string | number | null | Promise<string | number | null>)[],
) {
  interface Question {
    readonly title: string
    readonly message: string
    readonly choices: readonly { readonly id: string | number; readonly title: string }[]
  }
  const asked: Question[] = []
  const waiting: { readonly count: number; readonly resolve: () => void }[] = []
  host.serve('ui/confirm', (params) => {
    asked.push(params as Question)
    for (const waiter of waiting) if (asked.length >= waiter.count) waiter.resolve()
    return answers.shift() ?? null
  })
  return {
    asked,
    /** Resolves once the editor has been asked this many times. */
    reached: (count: number) =>
      asked.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiting.push({ count, resolve })
          }),
  }
}
