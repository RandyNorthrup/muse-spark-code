// The runtime dispatches here only for an explicit node command. A1/M104/C
// install the named service binding; missing dependencies fail explicitly.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {
  NODE_LOCK_FILE,
  NODE_MAX_AUTH_BYTES,
  NODE_PROTOCOL_VERSION,
  NODE_SETUP_TTL_MS,
  NODE_VAULT_KEY_BYTES,
  NODE_ZERO_DIGEST,
  UI_TEXT,
} from '../../shared/constants'
import { nodeDashboardSchema, type NodeState } from '../../shared/node'
import * as z from 'zod/mini'
import { BASE_LOCALE, fill, formatDateTime } from '../../shared/l10n/text'
import { nodeDataFolder } from '../dataFolder'
import { readSecretLine } from '../hiddenInput'
import { isUsageError, parseNodeArgs, type NodeCommand } from './args'
import { ownService, productionNodeBinding, type NodeServiceBinding } from './binding'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { NodeStateStore } from './state'
import { NodeListenerError } from './listenerGuard'
import { isMissingFile } from './privateFiles'

// The isolated bundle also exposes the real shared service pieces to the
// integration binding. These never enter ACP stdio or the extension.
export { NodeService } from './service'
export { superviseNode } from './supervisor'
export { NodeProcessToolHost } from './toolHost'
export { nodeHealth } from './health'
export { NodeClosedGitRunner } from './gitRunner'
export { NodeListener } from './listener'
export { nodeActionDigest } from './listenerMethods'

export type { NodeServiceBinding } from './binding'
export { productionNodeBinding } from './binding'
export interface NodeCommandDeps {
  readonly root: string
  readonly signal: AbortSignal
  readonly binding?: NodeServiceBinding
  readonly now: () => number
  readonly print: (line: string) => void
  readonly readSecret: () => Promise<string>
}

async function init(
  command: NodeCommand,
  deps: NodeCommandDeps,
  store: NodeStateStore,
): Promise<void> {
  const config = command.config
  if (config === undefined) throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  const release = await ownService(store)
  try {
    try {
      await store.load()
      throw new Error(UI_TEXT.nodeErrors.conflict)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
    const identity = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const publicKey = identity.publicKey.export({ type: 'spki', format: 'der' })
    const nodeId = createHash('sha256').update(publicKey).digest('hex')
    const code = randomBytes(NODE_VAULT_KEY_BYTES).toString('base64url')
    const now = deps.now()
    const state: NodeState = {
      v: NODE_PROTOCOL_VERSION,
      nodeId,
      ownerId: randomUUID(),
      generation: 1,
      config,
      setup: {
        codeHash: createHash('sha256').update(code).digest('hex'),
        issuedAt: now,
        expiresAt: now + NODE_SETUP_TTL_MS,
      },
      passkeys: [],
      workspaces: [],
      auditHead: { seq: 0, hash: NODE_ZERO_DIGEST },
    }
    await store.files.write(
      'identity-key.pem',
      String(identity.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    )
    await store.initialize(state)
    deps.print(UI_TEXT.nodeLabels.title)
    deps.print(`${UI_TEXT.nodeLabels.setupCode}: ${code}`)
    deps.print(
      fill(UI_TEXT.nodeMessages.setupExpires, { time: formatDateTime(now + NODE_SETUP_TTL_MS) }),
    )
    deps.print(UI_TEXT.nodeMessages.listenChoice)
  } finally {
    await release()
  }
}

export async function runNodeCommand(command: NodeCommand, deps: NodeCommandDeps): Promise<number> {
  const store = new NodeStateStore(deps.root, (error: unknown) => {
    // A missing store is routine setup state each command already handles.
    if (!isMissingFile(error)) deps.print(UI_TEXT.nodeMessages.unexpectedFailure)
  })
  if (command.action === 'help') {
    deps.print(UI_TEXT.nodeLabels.title)
    deps.print(
      `${UI_TEXT.nodeLabels.title}: node init | serve | status | stop [--all] | lock | unlock | wipe --confirm-wipe`,
    )
    return 0
  }
  if (command.action === 'init') {
    await init(command, deps, store)
    return 0
  }
  await store.load()
  // A stopped node answers status from its files, binding or not; a held
  // lock falls through to the live service (or refuses without one).
  if (command.action === 'status') {
    try {
      await store.files.read(NODE_LOCK_FILE, NODE_MAX_AUTH_BYTES)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
      deps.print(
        JSON.stringify({
          nodeId: store.read().nodeId,
          running: false,
          keyStoreSealed: true,
          attendance: 'unattended',
        }),
      )
      return 0
    }
  }
  const binding = deps.binding
  if (binding === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
  if (command.action === 'serve') {
    const release = await ownService(store)
    try {
      await binding.serve(store, deps.signal)
    } finally {
      await release()
    }
    return 0
  }
  if (command.action === 'wipe') {
    if (!command.confirmWipe) throw new Error(UI_TEXT.nodeErrors.forbidden)
    await binding.wipe(store)
    // The binding destroys slots, identity and the workspace volume first;
    // force covers either nesting: the volume may hold the state root.
    await rm(path.resolve(deps.root), { recursive: true, force: true })
    return 0
  }
  const status = await binding.command(command.action, {
    root: deps.root,
    all: command.all,
    readSecret: deps.readSecret,
  })
  if (command.action === 'status') deps.print(JSON.stringify(nodeDashboardSchema.parse(status)))
  else z.strictObject({ done: z.literal(true) }).parse(status)
  return 0
}

export async function runNodeArgs(
  argv: readonly string[],
  deps: NodeCommandDeps,
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  let command: NodeCommand
  try {
    command = parseNodeArgs(argv)
  } catch (error: unknown) {
    // The parser only throws usage Errors; anything else surfaces.
    if (!isUsageError(error)) throw error
    deps.print(UI_TEXT.nodeErrors.invalidRequest)
    return 2
  }
  try {
    return await runNodeCommand(command, { ...deps, root: command.dataRoot ?? deps.root })
  } catch (error: unknown) {
    // A missing store is routine setup state: name it, never a traceback.
    if (isMissingFile(error)) {
      deps.print(UI_TEXT.nodeErrors.notFound)
      return 1
    }
    // A binding refusal is already one of the node's said words.
    if (isNodeRefusal(error)) {
      deps.print(error.message)
      return 1
    }
    // Run failures are typed; anything else is a bug and surfaces.
    if (!(error instanceof NodeListenerError)) throw error
    deps.print(UI_TEXT.nodeErrors.unavailable)
    return 1
  }
}

/** Only the binding's own said words pass through verbatim. */
function isNodeRefusal(error: unknown): error is Error {
  return (
    error instanceof Error &&
    [
      UI_TEXT.nodeErrors.unavailable,
      UI_TEXT.nodeErrors.forbidden,
      UI_TEXT.nodeErrors.running,
    ].includes(error.message)
  )
}

/** The CLI's last resort: a fixed word on stderr, never the failure's text. */
function report(_error: unknown): void {
  process.stderr.write(`${UI_TEXT.nodeErrors.failed}\n`)
}

async function cliMain(argv: readonly string[]): Promise<number> {
  const controller = new AbortController()
  const stop = () => {
    controller.abort()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  try {
    return await runNodeArgs(
      argv,
      {
        root:
          process.env['MUSE_NODE_DATA_ROOT'] ??
          nodeDataFolder({ platform: process.platform, env: process.env, homeDir: homedir() }),
        signal: controller.signal,
        binding: productionNodeBinding(),
        now: Date.now,
        print: (line) => {
          process.stdout.write(`${line}\n`)
        },
        readSecret: () => readSecretLine(UI_TEXT.nodeLabels.unlock, process.stdin, process.stderr),
      },
      UI_TEXT,
      BASE_LOCALE,
    )
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
  }
}

if (require.main === module) {
  void cliMain(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      report(error)
      process.exitCode = 1
    })
}
