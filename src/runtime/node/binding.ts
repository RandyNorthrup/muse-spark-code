// The production node binding S0 installs: real serve and stop, real
// stopped-node wipe, and explicit refusals where the A1/M104/M109/T
// integrations are still open. Missing adapters fail explicitly with the
// node's said words; nothing here pretends to serve, stop, lock or unlock.
// Serving itself lives in the lazy dist/nodeServe.js, loaded when serve
// starts, so every other command keeps dist/node.js small.
import { open, rm, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  NODE_FILE_MODE,
  NODE_KEYS_FILE,
  NODE_LOCK_FILE,
  NODE_SERVE_BUNDLE_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { NodePrivateFiles } from './privateFiles'
import type { ServeNodeOptions } from './serve'
import type { NodeStateStore } from './state'
import { stopNode } from './stop'

/** Authenticated local transport, TLS/web sign-in, slot codec and tool-peer binding. */
export interface NodeServiceBinding {
  serve(store: NodeStateStore, signal: AbortSignal): Promise<void>
  command(
    action: 'status' | 'stop' | 'lock' | 'unlock',
    input: {
      root: string
      all: boolean
      signal: AbortSignal
      readSecret: () => Promise<string>
    },
  ): Promise<unknown>
  wipe(store: NodeStateStore): Promise<void>
}

/** The lock is held: a supervisor owns this identity and state. */
export function isLockTaken(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/** An exclusive OS file prevents two supervisors sharing one identity/state. */
export async function ownService(store: NodeStateStore): Promise<() => Promise<void>> {
  await store.files.prepare()
  const file = store.files.file(NODE_LOCK_FILE)
  const handle = await open(file, 'wx', NODE_FILE_MODE)
  await handle.writeFile(JSON.stringify({ pid: process.pid }))
  await handle.sync()
  return async () => {
    await handle.close()
    await unlink(file)
  }
}

export interface ProductionNodeBindingOptions {
  /** The serve console: the fingerprint line and fixed failure sentences. */
  readonly print: (line: string) => void
  /** The product version the dashboard reports, read when serve starts. */
  readonly version: () => string
  /** How the serve bundle is loaded: Node's `require` of dist/nodeServe.js, unless a test hands in the module. */
  readonly loadServeBundle?: (() => unknown) | undefined
  /** How the auth bundle beside dist/nodeServe.js is loaded, passed to serve; tests hand the module in. */
  readonly loadAuthBundle?: (() => unknown) | undefined
}

/** The lazy serve bundle's surface: exactly serveEntry.ts's export. */
interface NodeServeBundle {
  runNodeServe(options: ServeNodeOptions, table: UiText, locale: string): Promise<void>
}

function isNodeServeBundle(value: unknown): value is NodeServeBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runNodeServe' in value &&
    typeof value.runNodeServe === 'function'
  )
}

/** Node's own `require` of dist/nodeServe.js beside the running bundle. */
function requireServeBundle(): unknown {
  const file = path.join(__dirname, NODE_SERVE_BUNDLE_FILE)
  return createRequire(file)(file)
}

function loadServeBundle(options: ProductionNodeBindingOptions): NodeServeBundle {
  let loaded: unknown
  try {
    loaded =
      options.loadServeBundle === undefined ? requireServeBundle() : options.loadServeBundle()
  } catch (error: unknown) {
    // The bundle's absence fails serve: the cause stays out of the console.
    options.print(UI_TEXT.nodeMessages.unexpectedFailure)
    throw new Error(UI_TEXT.nodeErrors.unavailable, { cause: error })
  }
  if (!isNodeServeBundle(loaded)) {
    options.print(UI_TEXT.nodeMessages.unexpectedFailure)
    throw new Error(UI_TEXT.nodeErrors.unavailable)
  }
  return loaded
}

export function productionNodeBinding(options: ProductionNodeBindingOptions): NodeServiceBinding {
  return {
    serve: async (store, signal) => {
      await loadServeBundle(options).runNodeServe(
        {
          store,
          signal,
          print: options.print,
          version: options.version,
          loadAuthBundle: options.loadAuthBundle,
        },
        UI_TEXT,
        uiLocale(),
      )
    },
    command: (action, input) => {
      // Live status and the lock commands ride T's local control transport,
      // still open: without it the CLI cannot ask the running service.
      return ['status', 'lock', 'unlock'].includes(action)
        ? Promise.reject(new Error(UI_TEXT.nodeErrors.unavailable))
        : stopNode({ files: new NodePrivateFiles(input.root), signal: input.signal })
    },
    wipe: async (store) => {
      let release: (() => Promise<void>) | undefined
      try {
        release = await ownService(store)
      } catch (error: unknown) {
        // A live supervisor holds the lock, or a dead one left it stale:
        // wiping underneath either corrupts the state, so wipe refuses.
        // Stale-lock recovery is an operator step in the home guide.
        if (!isLockTaken(error)) throw error
        throw new Error(UI_TEXT.nodeErrors.running, { cause: error })
      }
      try {
        // A stopped node keeps no live sessions, tools or keys in this
        // process: destruction is the key slots and the boot identity,
        // exactly the stopped half of the service's own wipe.
        await store.files.write(NODE_KEYS_FILE, '')
        await store.files.write('identity-key.pem', '')
        // The workspace volume belongs to the node too; init recorded it.
        await rm(path.resolve(store.read().config.workspaceRoot), {
          recursive: true,
          force: true,
        })
      } finally {
        await release()
      }
    },
  }
}
