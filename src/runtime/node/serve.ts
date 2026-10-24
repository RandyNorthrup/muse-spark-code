// The A1/M104 serve binding (RLF-NODESERVE): N's named handoffs composed
// into one serving node. A1's in-memory verifier, the S0 pinned leaf, the
// session-scoped method port (U1 files/git pages, U2 terminal/dashboard
// pages, the service's stop/lock/wipe) and the terminal subscription the
// socket needs. Every peer that is still another lane's work refuses with
// the node's said words: C's tools peer (terminal PTYs, file/git
// publication, repository Git as the tools user), M103's maker engine and
// M109's vault codec. H19 step-up binding and H20 console recovery are
// A1's as accepted; this binding adds no approval and no paid call.
import { statfsSync } from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { cpus, freemem, totalmem } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import * as z from 'zod/mini'
import {
  NODE_AUTH_BUNDLE_FILE,
  NODE_EXECUTABLE_WRITE_MASK,
  NODE_LOCK_FILE,
  NODE_MAX_AUTH_BYTES,
  NODE_STOP_POLL_MS,
  NODE_TLS_CERT_FILE,
  NODE_TLS_DIRECTORY,
  NODE_TLS_KEY_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodPort,
  type NodeMethodResult,
} from '../../shared/hostApi/nodeMethods'
import type { NodeClock, NodeConfig, NodeState, NodeToolHostPort } from '../../shared/node'
import type { NodeSession } from '../../shared/nodeAuth'
import type { NodePasskeyAuth, NodeAuthOptions } from './auth/service'
import type { NodeSessionLifecycle } from './auth/sessions'
import type { NodeCertificate } from './tls/certificate'
import { NodeListener } from './listener'
import { NodeListenerError, type NodeListenerErrorCode } from './listenerGuard'
import type { NodeListenerMethodFactory } from './listenerMethods'
import type { NodeTerminalSubscription } from './listenerSocket'
import { NodeService } from './service'
import type { NodeStateStore } from './state'
import { isMissingFile, NodePrivateFiles } from './privateFiles'
import type { NodeVaultCodec } from './keyStore'
import { createNodeFileMethods, type NodeFileWorkspacePort } from './web/files'
import { createNodeTerminalMethods, type NodeTerminalPagePort } from './web/terminal'
import {
  createNodeDashboardMethods,
  type NodeDashboardPagePort,
  type NodeDashboardReadings,
} from './web/dashboard'

/** The lazy auth bundle's serve surface: exactly auth/entry.ts's exports. */
interface NodeAuthBundle {
  createNodePasskeyAuth(options: NodeAuthOptions, table: UiText, locale: string): NodePasskeyAuth
  nodeAuthMethods(
    auth: NodePasskeyAuth,
    source: string,
    session: NodeSession | null,
    next: NodeMethodPort,
    failure: (code: NodeListenerErrorCode, options?: { cause?: unknown }) => Error,
  ): NodeMethodPort
  checkNodeCertificate(
    pem: string,
    key: string,
    names: readonly string[],
    now: number,
    fingerprint?: string,
  ): string
  issueNodeCertificate(
    files: NodePrivateFiles,
    names: readonly string[],
    now: () => number,
    opensslPath: string,
    signal: AbortSignal,
  ): Promise<NodeCertificate>
  readNodeChallengeKey(files: NodePrivateFiles): Promise<Buffer>
}

const AUTH_FUNCTIONS = [
  'createNodePasskeyAuth',
  'nodeAuthMethods',
  'checkNodeCertificate',
  'issueNodeCertificate',
  'readNodeChallengeKey',
] as const

/** Whether a required module is the auth bundle: it has the five functions. */
function isNodeAuthBundle(value: unknown): value is NodeAuthBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    AUTH_FUNCTIONS.every((name) => typeof Reflect.get(value, name) === 'function')
  )
}

interface ServeAuthLoader {
  /** dist/nodeAuth.js beside the running bundle; tests hand the module in instead. */
  readonly bundlePath?: string | undefined
  /** How the bundle is loaded: Node's `require`, unless a test hands in the module. */
  readonly loadBundle?: (() => unknown) | undefined
}

/** Node's own `require` of an absolute bundle path (the lazyBundle pattern). */
function requireAuthBundle(file: string): unknown {
  return createRequire(file)(file)
}

function loadAuthBundle(deps: ServeAuthLoader, print: (line: string) => void): NodeAuthBundle {
  // The bundle path resolves only on the require path, so tests that hand
  // the module in never touch `__dirname` (absent under the test runner).
  let loaded: unknown
  try {
    loaded =
      deps.loadBundle === undefined ? requireAuthBundle(authBundlePath(deps)) : deps.loadBundle()
  } catch (error: unknown) {
    // The bundle's absence fails serve: the cause stays out of the console.
    print(UI_TEXT.nodeMessages.unexpectedFailure)
    throw new Error(UI_TEXT.nodeErrors.unavailable, { cause: error })
  }
  if (!isNodeAuthBundle(loaded)) {
    print(UI_TEXT.nodeMessages.unexpectedFailure)
    throw new Error(UI_TEXT.nodeErrors.unavailable)
  }
  return loaded
}

function authBundlePath(deps: ServeAuthLoader): string {
  return deps.bundlePath ?? path.join(__dirname, NODE_AUTH_BUNDLE_FILE)
}

/**
An installed tool by bare name: absolute PATH entries only, resolved through
the system's own links (alternatives included), a regular file its directory
cannot swap out from under the service. System tooling is owned by whatever
user the OS uses; writability is the check that matters. A candidate that is
not executable fails at issuance with unavailable.
*/
async function resolveInstalledTool(name: string): Promise<string | undefined> {
  const value = process.env['PATH']
  if (value === undefined || value === '') return undefined
  for (const entry of value.split(path.delimiter)) {
    if (entry === '' || !path.isAbsolute(entry)) continue
    try {
      const real = await realpath(path.join(entry, name))
      const info = await stat(real)
      const parent = await stat(path.dirname(real))
      if (
        !info.isFile() ||
        (info.mode & NODE_EXECUTABLE_WRITE_MASK) !== 0 ||
        !parent.isDirectory() ||
        (parent.mode & NODE_EXECUTABLE_WRITE_MASK) !== 0
      )
        continue
      return real
    } catch (error: unknown) {
      // A missing, unusable or unreadable entry is not this tool; anything
      // else surfaces.
      if (!isUnusableEntry(error)) throw error
    }
  }
  return undefined
}

function isUnusableEntry(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)
  )
}

/** The committed pair, issuing it on first serve when OpenSSL is installed. */
async function ensureTlsPair(
  auth: NodeAuthBundle,
  files: NodePrivateFiles,
  names: readonly string[],
  now: () => number,
  signal: AbortSignal,
): Promise<NodeCertificate> {
  const committedRoot = files.file(NODE_TLS_DIRECTORY)
  let hasCommitted = false
  try {
    await lstat(committedRoot)
    hasCommitted = true
  } catch (error: unknown) {
    if (!isMissingFile(error)) throw error
  }
  if (hasCommitted) {
    const committed = new NodePrivateFiles(committedRoot)
    const fingerprint = auth.checkNodeCertificate(
      await committed.read(NODE_TLS_CERT_FILE, NODE_MAX_AUTH_BYTES),
      await committed.read(NODE_TLS_KEY_FILE, NODE_MAX_AUTH_BYTES),
      names,
      now(),
    )
    signal.throwIfAborted()
    return {
      root: committedRoot,
      certificateFile: NODE_TLS_CERT_FILE,
      privateKeyFile: NODE_TLS_KEY_FILE,
      fingerprint,
    }
  }
  const openssl = await resolveInstalledTool('openssl')
  if (openssl === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
  return await auth.issueNodeCertificate(files, names, now, openssl, signal)
}

/** M109's vault reader is still open: every codec operation says so. */
function refusingVaultCodec(): NodeVaultCodec {
  return {
    readPassphraseSlot: (): never => {
      throw new Error(UI_TEXT.nodeErrors.unsupported)
    },
    parse: (): never => {
      throw new Error(UI_TEXT.nodeErrors.unsupported)
    },
    serialize: (): never => {
      throw new Error(UI_TEXT.nodeErrors.unsupported)
    },
    createPassphraseSlot: () => Promise.reject(new Error(UI_TEXT.nodeErrors.unsupported)),
    unwrapPassphraseSlot: () => Promise.reject(new Error(UI_TEXT.nodeErrors.unsupported)),
  }
}

/** C's tools peer is still open: every tool operation says unavailable. */
function refusingToolHost(): NodeToolHostPort {
  return {
    run: () => Promise.reject(new NodeListenerError('unavailable')),
    openTerminal: () => Promise.reject(new NodeListenerError('unavailable')),
    writeTerminal: () => Promise.reject(new NodeListenerError('unavailable')),
    resizeTerminal: () => Promise.reject(new NodeListenerError('unavailable')),
    closeTerminal: () => Promise.reject(new NodeListenerError('unavailable')),
    stopAll: () => Promise.reject(new NodeListenerError('unavailable')),
  }
}

const lockSchema = z.strictObject({ pid: z.number().check(z.int(), z.positive()) })

function abortablePoll(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, NODE_STOP_POLL_MS)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export interface StopNodeInput {
  readonly files: NodePrivateFiles
  readonly signal: AbortSignal
}

/**
Stop the serving node: signal its recorded supervisor, then wait until the
process is gone. `--all` is honored: the graceful shutdown ends every turn,
sandbox, model request and stream, and no maker device can be registered
until M103's runtime lands.
*/
export async function stopNode(input: StopNodeInput): Promise<{ done: true }> {
  const raw = await input.files.read(NODE_LOCK_FILE, NODE_MAX_AUTH_BYTES)
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error: unknown) {
    // The lock is ours; a corrupt one is a failed stop, never a guess.
    throw new Error(UI_TEXT.nodeErrors.failed, { cause: error })
  }
  const parsed = lockSchema.safeParse(decoded)
  if (!parsed.success) {
    throw new Error(UI_TEXT.nodeErrors.failed, { cause: parsed.error })
  }
  const pid = parsed.data.pid
  try {
    process.kill(pid, 0)
  } catch (error: unknown) {
    // A stale lock is the operator's to remove (the home guide); a foreign
    // user's node is not ours to signal.
    if (isProcessGone(error)) throw new Error(UI_TEXT.nodeErrors.failed, { cause: error })
    if (isPermissionDenied(error)) throw new Error(UI_TEXT.nodeErrors.forbidden, { cause: error })
    throw error
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error: unknown) {
    if (isProcessGone(error)) return { done: true }
    if (isPermissionDenied(error)) throw new Error(UI_TEXT.nodeErrors.forbidden, { cause: error })
    throw error
  }
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (isProcessGone(error)) return { done: true }
      if (!isPermissionDenied(error)) throw error
    }
    await abortablePoll(input.signal)
    input.signal.throwIfAborted()
  }
}

function isProcessGone(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ESRCH' || error.code === 'ENOENT')
  )
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
}

export interface ServeNodeOptions {
  readonly store: NodeStateStore
  readonly signal: AbortSignal
  readonly print: (line: string) => void
  readonly version: string
  /** The auth bundle beside dist/node.js; tests hand the module in. */
  readonly authBundlePath?: string | undefined
  readonly loadAuthBundle?: (() => unknown) | undefined
}

interface ServePorts {
  readonly service: NodeService
  readonly files: NodeFileWorkspacePort
  readonly terminal: NodeTerminalPagePort
  readonly dashboard: NodeDashboardPagePort
  readonly terminals: Map<string, ReturnType<typeof createNodeTerminalMethods>>
}

function createServePorts(
  service: NodeService,
  store: NodeStateStore,
  state: NodeState,
  config: NodeConfig,
  clock: NodeClock,
  print: (line: string) => void,
  version: string,
  startedAtMs: number,
): ServePorts {
  const report = (_error: unknown): void => {
    print(UI_TEXT.nodeMessages.unexpectedFailure)
  }
  const files: NodeFileWorkspacePort = {
    root: (workspaceId, signal) => {
      signal.throwIfAborted()
      const workspace = store.read().workspaces.find((entry) => entry.id === workspaceId)
      if (workspace === undefined) throw new NodeListenerError('notFound')
      return Promise.resolve(path.join(config.workspaceRoot, workspace.path))
    },
    // U1/C's tools-UID publisher is still open: writes say unavailable.
    replace: () => Promise.reject(new NodeListenerError('unavailable')),
    report,
  }
  const terminal: NodeTerminalPagePort = {
    host: refusingToolHost(),
    nodeId: state.nodeId,
    now: () => clock.now(),
    audit: (details) => store.append(details),
    report,
  }
  let lastCpu: { idle: number; total: number } | undefined
  const readings = (signal: AbortSignal): Promise<NodeDashboardReadings> => {
    signal.throwIfAborted()
    const cores = cpus()
    const summary = { idle: 0, total: 0 }
    for (const cpu of cores) {
      summary.idle += cpu.times.idle
      summary.total +=
        cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
    }
    const previous = lastCpu
    lastCpu = summary
    // No baseline on the first read: usage needs two samples.
    const busy =
      previous === undefined || cores.length === 0
        ? 0
        : (1 - (summary.idle - previous.idle) / Math.max(1, summary.total - previous.total)) * 100
    const totalBytes = totalmem()
    const disk = statfsSync(store.files.root)
    return Promise.resolve({
      cpuPercent: Math.min(100, Math.max(0, busy)),
      memory: { usedBytes: totalBytes - freemem(), totalBytes },
      disk: {
        freeBytes: disk.bfree * disk.bsize,
        totalBytes: disk.blocks * disk.bsize,
      },
    })
  }
  const dashboard: NodeDashboardPagePort = {
    nodeId: state.nodeId,
    version,
    startedAtMs,
    now: () => clock.now(),
    sessions: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(service.attendance.sessions())
    },
    locked: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(service.isLocked)
    },
    keyStoreSealed: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(service.keys.isSealed)
    },
    // A3's challenges are stateless: unproved ones retain nothing server-side.
    pendingChallenges: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(0)
    },
    readings,
    workspaces: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(store.read().workspaces)
    },
    audit: (signal) => {
      signal.throwIfAborted()
      return Promise.resolve(store.audit())
    },
    report,
  }
  return { service, files, terminal, dashboard, terminals: new Map() }
}

function createMethodPort(
  ports: ServePorts,
  session: NodeSession | null,
  report: (error: unknown) => void,
): NodeMethodPort {
  const terminalFor = (id: string | null): ReturnType<typeof createNodeTerminalMethods> => {
    if (id === null) return createNodeTerminalMethods(ports.terminal, null)
    let methods = ports.terminals.get(id)
    if (methods === undefined) {
      methods = createNodeTerminalMethods(ports.terminal, id)
      ports.terminals.set(id, methods)
    }
    return methods
  }
  return {
    request: async <M extends NodeMethodName>(
      method: M,
      params: NodeMethodParams<M>,
      signal: AbortSignal,
    ): Promise<NodeMethodResult<M>> => {
      signal.throwIfAborted()
      const narrowed: NodeMethodName = method
      let result: unknown
      switch (narrowed) {
        case 'node/files/list': {
          result = await createNodeFileMethods(ports.files).list(
            nodeMethods['node/files/list'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/files/search': {
          result = await createNodeFileMethods(ports.files).search(
            nodeMethods['node/files/search'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/files/read': {
          result = await createNodeFileMethods(ports.files).read(
            nodeMethods['node/files/read'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/files/download': {
          result = await createNodeFileMethods(ports.files).download(
            nodeMethods['node/files/download'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/files/write': {
          result = await createNodeFileMethods(ports.files).write(
            nodeMethods['node/files/write'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/files/upload': {
          result = await createNodeFileMethods(ports.files).upload(
            nodeMethods['node/files/upload'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/terminal/open': {
          result = await terminalFor(session?.id ?? null).open(
            nodeMethods['node/terminal/open'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/terminal/close': {
          result = await terminalFor(session?.id ?? null).close(
            nodeMethods['node/terminal/close'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/terminal/attach': {
          result = await terminalFor(session?.id ?? null).attach(
            nodeMethods['node/terminal/attach'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/terminal/write': {
          result = await terminalFor(session?.id ?? null).write(
            nodeMethods['node/terminal/write'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/terminal/resize': {
          result = await terminalFor(session?.id ?? null).resize(
            nodeMethods['node/terminal/resize'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/dashboard/read': {
          result = await createNodeDashboardMethods(ports.dashboard).read(
            nodeMethods['node/dashboard/read'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/audit/list': {
          result = await createNodeDashboardMethods(ports.dashboard).list(
            nodeMethods['node/audit/list'].params.parse(params),
            signal,
          )
          break
        }
        case 'node/stop': {
          nodeMethods['node/stop'].params.parse(params)
          signal.throwIfAborted()
          try {
            await ports.service.stop()
          } catch (error: unknown) {
            if (signal.aborted) throw error
            report(error)
            throw new NodeListenerError('unavailable', { cause: error })
          }
          result = { done: true }
          break
        }
        case 'node/lock': {
          nodeMethods['node/lock'].params.parse(params)
          signal.throwIfAborted()
          try {
            await ports.service.lock()
          } catch (error: unknown) {
            if (signal.aborted) throw error
            report(error)
            throw new NodeListenerError('unavailable', { cause: error })
          }
          result = { done: true }
          break
        }
        case 'node/wipe': {
          nodeMethods['node/wipe'].params.parse(params)
          signal.throwIfAborted()
          try {
            await ports.service.wipe()
          } catch (error: unknown) {
            if (signal.aborted) throw error
            report(error)
            throw new NodeListenerError('unavailable', { cause: error })
          }
          result = { done: true }
          break
        }
        // Repository Git runs only as the tools user (M110-U1-N-GIT-RESULTS);
        // C's tools peer is still open, so every git method says unavailable.
        // M103's maker runtime is still open (RLM103 running): the generic
        // action is registered and step-up bound, but has no engine to run.
        // The auth wrapper answers auth before this port runs; reaching here
        // is a wiring bug, failed closed without a leak.
        case 'node/git/status':
        case 'node/git/diff':
        case 'node/git/branches':
        case 'node/git/stage':
        case 'node/git/commit':
        case 'node/git/branch':
        case 'node/git/fetch':
        case 'node/git/pull':
        case 'node/git/push':
        case 'node/maker/action':
        case 'node/auth/begin':
        case 'node/auth/enroll':
        case 'node/auth/signin':
        case 'node/auth/stepUp/begin':
        case 'node/auth/stepUp/complete':
        case 'node/auth/end': {
          throw new NodeListenerError('unavailable')
        }
        default: {
          const exhaustive: never = narrowed
          throw new NodeListenerError('unavailable', { cause: exhaustive })
        }
      }
      // No trailing abort check: stop, lock and wipe legitimately end the
      // caller's own session, which aborts the request signal on success.
      // The catalog lookup is generic over M and zod has validated the exact
      // method's result above, so the cast below restates what validation
      // proved; narrowing cannot retain that generic correlation (PLAN §8).
      return nodeMethods[method].result.parse(result) as NodeMethodResult<M>
    },
  }
}

/**
Serve the node: boot the service once, bind A1's verifier, load the S0
pinned leaf, start the selected-interface listener with the full method
port and the terminal subscription, print the full fingerprint, and serve
until the signal aborts. Privileged routes refuse without a verified
bearer: the listener's guards answer before any method runs.
*/
export async function serveNode(options: ServeNodeOptions): Promise<void> {
  options.signal.throwIfAborted()
  const { store, signal, print } = options
  const state = store.read()
  const config = state.config
  const bound = config.listener
  if (bound === null) throw new Error(UI_TEXT.nodeErrors.unavailable)
  const auth = loadAuthBundle(
    { bundlePath: options.authBundlePath, loadBundle: options.loadAuthBundle },
    print,
  )
  const clock: NodeClock = { now: () => Date.now(), monotonicMs: () => performance.now() }
  const report = (_error: unknown): void => {
    print(UI_TEXT.nodeMessages.unexpectedFailure)
  }
  const pair = await ensureTlsPair(
    auth,
    store.files,
    config.browserNames,
    () => clock.now(),
    signal,
  )
  const challengeKey = await auth.readNodeChallengeKey(new NodePrivateFiles(pair.root))
  signal.throwIfAborted()
  const service = new NodeService(store, {
    clock,
    vaultCodec: refusingVaultCodec(),
    // No engine or tools peer runs work yet: creating resources says so.
    createResources: () => Promise.reject(new Error(UI_TEXT.nodeErrors.unavailable)),
    endSessions: () => {
      passkeys.endAll()
      return Promise.resolve()
    },
    report,
  })
  await service.boot()
  const rpId = config.browserNames[0]
  if (rpId === undefined) throw new Error(UI_TEXT.nodeErrors.unavailable)
  const origin = `https://${rpId}:${String(bound.port)}`
  const ports = createServePorts(
    service,
    store,
    state,
    config,
    clock,
    print,
    options.version,
    clock.now(),
  )
  const lifecycle: NodeSessionLifecycle = {
    attached: (session) => {
      service.attach(session)
    },
    ended: (id) => {
      service.attendance.detach(id)
      const entry = ports.terminals.get(id)
      ports.terminals.delete(id)
      void entry?.dispose().catch((error: unknown) => {
        report(error)
      })
    },
  }
  const passkeys = auth.createNodePasskeyAuth(
    { state: store, clock, challengeKey, rpId, origin, lifecycle, console: print },
    UI_TEXT,
    uiLocale(),
  )
  const methods: NodeListenerMethodFactory = (session, source) =>
    auth.nodeAuthMethods(
      passkeys,
      source,
      session,
      createMethodPort(ports, session, report),
      (code, failureOptions) => new NodeListenerError(code, failureOptions),
    )
  const terminal: NodeTerminalSubscription = async (session, terminalId, onEvent, wsSignal) => {
    const entry = ports.terminals.get(session.id)
    if (entry === undefined) throw new NodeListenerError('notFound')
    await entry.subscribe(session, terminalId, onEvent, wsSignal)
  }
  const listener = new NodeListener({
    config,
    ownerId: state.ownerId,
    clock,
    tls: {
      root: pair.root,
      certificateFile: pair.certificateFile,
      privateKeyFile: pair.privateKeyFile,
      fingerprint: pair.fingerprint,
    },
    verifier: passkeys.sessions,
    methods,
    terminal,
    print,
  })
  await listener.start()
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  await listener.close()
  await service.shutdown()
}
