// The runtime dispatches here only for an explicit node command. A1/M104/C
// install the named service binding; missing dependencies fail explicitly.
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { open, rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
  NODE_FILE_MODE,
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
import { fill, formatDateTime } from '../../shared/l10n/text'
import { parseNodeArgs, type NodeCommand } from './args'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { NodeStateStore } from './state'
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

/** Authenticated local transport, TLS/web sign-in, slot codec and tool-peer binding. */
export interface NodeServiceBinding {
  serve(store: NodeStateStore, signal: AbortSignal): Promise<void>
  command(
    action: 'status' | 'stop' | 'lock' | 'unlock',
    input: {
      root: string
      all: boolean
      readSecret: () => Promise<string>
    },
  ): Promise<unknown>
  wipe(store: NodeStateStore): Promise<void>
}
export interface NodeCommandDeps {
  readonly root: string
  readonly signal: AbortSignal
  readonly binding?: NodeServiceBinding
  readonly now: () => number
  readonly print: (line: string) => void
  readonly readSecret: () => Promise<string>
}

/** An exclusive OS file prevents two supervisors sharing one identity/state. */
async function ownService(store: NodeStateStore): Promise<() => Promise<void>> {
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
  const store = new NodeStateStore(deps.root)
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
  if (command.action === 'status' && deps.binding === undefined) {
    try {
      await store.files.read(NODE_LOCK_FILE, NODE_MAX_AUTH_BYTES)
      throw new Error(UI_TEXT.nodeErrors.unavailable)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
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
    // Binding destroys slots, seals memory, ends sessions/tools and revokes any
    // future pairs before removal. Workspace volume removal belongs to S0.
    await rm(path.resolve(deps.root), { recursive: true })
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
  } catch {
    deps.print(UI_TEXT.nodeErrors.invalidRequest)
    return 2
  }
  try {
    return await runNodeCommand(command, { ...deps, root: command.dataRoot ?? deps.root })
  } catch {
    deps.print(UI_TEXT.nodeErrors.unavailable)
    return 1
  }
}
