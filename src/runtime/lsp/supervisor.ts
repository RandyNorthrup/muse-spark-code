// Independent process supervision: Stop never enters the model/request queue.
import { type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, readdir, realpath, rename, rm } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { constants as osConstants } from 'node:os'
import type { Readable, Writable } from 'node:stream'
import type { ResourceTicket } from '../../shared/resources'
import { RUNTIME_STOP, RUNTIME_STOP_SOCKET_BYTES, LSP_LIMITS } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { withoutCredentials } from '../credentialVariables'
import { isProcessAlive } from '../../host/checkpoints/windowPresence'
import { privateDirectory, openPrivateRecord, writePrivateRecord } from './registry'
import type { StopBinding, StopReceipt, StopOwner } from './stopReceipt'
import { stablePrivateRoot, trustedPrivateRoot, trustedPrivateRoots } from '../privateDirectory'

async function readStopRecord(file: string): Promise<unknown> {
  const handle = await openPrivateRecord(file)
  try {
    const bytes = Buffer.alloc(RUNTIME_STOP.recordBytes + 1)
    const { bytesRead } = await handle.read(bytes)
    if (bytesRead > RUNTIME_STOP.recordBytes) throw new Error('ESTOP_RECORD')
    return JSON.parse(bytes.toString('utf8', 0, bytesRead))
  } finally {
    await handle.close()
  }
}

async function readTreeReceipt(file: string) {
  const { treeReceiptSchema } = await import('./stopReceipt')
  return treeReceiptSchema.parse(await readStopRecord(file))
}

/** Which unusable-record check failed: unreadable, oversize or invalid JSON. */
function unusableRecordReason(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string')
    return `unreadable: ${error.code}`
  if (error instanceof Error && error.message === 'ESTOP_RECORD') return 'oversize'
  return error instanceof SyntaxError ? 'invalid' : 'unreadable'
}

export async function runtimeLocatorDirectory(packageRoot: string, shouldCreate = false) {
  const directory = path.join(await stablePrivateRoot(packageRoot, shouldCreate), 'runtime-roots')
  await privateDirectory(directory, shouldCreate)
  return directory
}

/** Discover old environment roots as paths only; each must independently pass admission. */
export async function stopRuntime(
  cwd: string,
  packageRoot: string,
  home: string,
  diagnostic: (message: string) => void,
): Promise<void> {
  const roots = new Set<string>()
  for await (const root of trustedPrivateRoots(packageRoot, diagnostic)) roots.add(root)
  const { rootLocatorSchema } = await import('./stopReceipt')
  try {
    const directory = await runtimeLocatorDirectory(packageRoot)
    const files = await readdir(directory)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const locator = rootLocatorSchema.parse(await readStopRecord(path.join(directory, file)))
        await privateDirectory(locator.trustRoot)
        const root = await realpath(locator.trustRoot)
        roots.add(root)
        diagnostic(`ELSP_PRIVATE_ROOT: ${root}`)
      } catch {
        diagnostic('ESTOP_ROOT_REFUSED')
      }
    }
  } catch {
    diagnostic('ESTOP_LOCATORS_REFUSED')
  }
  await stopWorkspace(
    [...roots].map((root) => path.join(root, `muse-runtime-${workspaceKey(home)}`)),
    cwd,
    packageRoot,
    diagnostic,
  )
}

export class UnverifiedStopError extends Error {
  constructor(readonly pids: readonly number[]) {
    super('ESTOP_UNVERIFIED')
  }
}

export interface SupervisorDeps {
  readonly registry: string
  readonly locatorDirectory?: string
  readonly cwd: string
  readonly file: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly packageRoot: string
  readonly watchdogFile?: string
  readonly stdin: Readable
  readonly stdout: Writable
  readonly onSignalExit?: (signal: NodeJS.Signals) => void
}

/** The supervisor owns pipes and a group/job; the child never owns Stop. */
export async function superviseRuntime(deps: SupervisorDeps): Promise<number> {
  await privateDirectory(deps.registry, true)
  const trustRoot = await realpath(path.dirname(deps.registry))
  const env = withoutCredentials(deps.env)
  const { processAuthority } = await import('./processAuthority')
  const authority = await processAuthority(deps.packageRoot, deps.registry)
  const directory = path.join(
    // Registries/workspaces can be deeply nested. Only the verified platform
    // runtime root hosts the socket; its record still binds the registry root.
    await trustedPrivateRoot(deps.packageRoot),
    `ms-${randomBytes(LSP_LIMITS.socketNameBytes).toString('hex')}`,
  )
  const token = randomBytes(RUNTIME_STOP.tokenBytes).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\muse-stop-${randomUUID()}`
      : path.join(directory, 'control')
  // Darwin's sockaddr_un has 104 bytes including the terminator. Refuse an
  // oversized pathname before it can become an unusable control address.
  if (process.platform !== 'win32' && Buffer.byteLength(pipe) > RUNTIME_STOP_SOCKET_BYTES)
    throw new Error('ESTOP_SOCKET_PATH')
  const created = await privateDirectory(directory, true)
  if (!created.isNew) throw new Error('ELSP_PRIVATE')
  const ownerId = randomUUID()
  const generation = randomBytes(RUNTIME_STOP.generationBytes).toString('hex')
  const record = path.join(deps.registry, `${workspaceKey(deps.cwd)}-${ownerId}.json`)
  const locator =
    deps.locatorDirectory === undefined
      ? undefined
      : path.join(deps.locatorDirectory, `${ownerId}.json`)
  const ownership = (binding: StopBinding | null) =>
    JSON.stringify({ trustRoot, pid: process.pid, pipe, token, generation, ownerId, binding })
  let child: ChildProcessWithoutNullStreams | undefined
  let watchdog: ChildProcessWithoutNullStreams | undefined
  let watchdogDone: Promise<number> | undefined
  let childTicket: ResourceTicket | undefined
  let watchdogTicket: ResourceTicket | undefined
  const lifecycle = { wasAdmitted: false, didStopTree: false, isIntentionalStop: false }
  let stopping: Promise<void> | undefined
  const { promise: startup, resolve: finishStartup } = Promise.withResolvers<undefined>()
  const { promise: closed, resolve: closeOwner } = Promise.withResolvers<undefined>()
  const stop = () => {
    stopping ??= (async () => {
      await startup
      if (child === undefined) return
      if (childTicket !== undefined) await authority.stop(childTicket, true)
      // EOF guardian has independently enrolled the same exact ticket before admission.
      if (watchdog !== undefined && watchdogDone !== undefined) {
        watchdog.stdin.end()
        const result = await watchdogDone
        if (result !== 0) throw new Error('ESTOP_WATCHDOG')
        if (watchdogTicket !== undefined) await authority.stop(watchdogTicket)
      }
      lifecycle.didStopTree = true
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      closeOwner(undefined)
    })()
    // The main path awaits this failure and preserves a nonzero result.
    void stopping.catch(() => {
      closeOwner(undefined)
    })
  }
  const requestStop = () => {
    if (child === undefined || (child.exitCode === null && child.signalCode === null))
      lifecycle.isIntentionalStop = true
    stop()
  }
  const sockets = new Set<ReturnType<typeof createConnection>>()
  const control = createServer((socket) => {
    sockets.add(socket)
    socket.setTimeout(RUNTIME_STOP.exitMs, () => {
      socket.destroy()
    })
    socket.on('error', () => {
      socket.destroy()
    })
    socket.on('close', () => {
      sockets.delete(socket)
    })
    let request = ''
    socket.on('data', (bytes: Buffer) => {
      request += bytes.toString('utf8')
      if (request.length > RUNTIME_STOP.handshakeChars) {
        socket.destroy()
        return
      }
      if (!request.endsWith('\n')) return
      if (request !== `${token}\n`) {
        socket.destroy()
        return
      }
      requestStop()
      void stopping?.then(
        () => {
          socket.end('STOPPED\n')
        },
        () => {
          socket.end('ESTOP_TREE\n')
        },
      )
    })
  })
  control.maxConnections = RUNTIME_STOP.connections
  try {
    await new Promise<void>((resolve, reject) => {
      control.once('error', reject)
      control.listen(pipe, resolve)
    })
    if (locator !== undefined) await writePrivateRecord(locator, JSON.stringify({ trustRoot }))
    await writePrivateRecord(record, ownership(null))
    process.on('SIGTERM', requestStop)
    process.on('SIGINT', requestStop)
    if (process.platform !== 'win32') {
      const launched = await authority.launch(
        process.execPath,
        [
          deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
          String(process.pid),
          deps.packageRoot,
          deps.registry,
          `${record}.tree`,
        ],
        deps.cwd,
        env,
        deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
      )
      watchdog = launched.child
      watchdogTicket = launched.ticket
      launched.admit()
      const guard = watchdog
      watchdogDone = new Promise<number>((resolve) => {
        guard.once('close', (code: number | null) => {
          // A signaled watchdog has no code; report it as a failure.
          if (code === null) {
            resolve(1)
            return
          }
          resolve(code)
        })
      })
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('ESTOP_WATCHDOG'))
        }, RUNTIME_STOP.exitMs)
        guard.once('error', reject)
        guard.stdout.once('data', (bytes: Buffer) => {
          clearTimeout(timer)
          if (bytes.toString('ascii') === 'READY\n') resolve()
          else reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.once('close', () => {
          clearTimeout(timer)
          reject(new Error('ESTOP_WATCHDOG'))
        })
      })
      guard.stderr.resume()
      guard.stdout.resume()
      guard.once('exit', stop)
    }
    const launched = await authority.launch(
      deps.file,
      deps.args,
      deps.cwd,
      env,
      deps.watchdogFile ?? path.join(deps.packageRoot, 'dist', 'runtimeWatchdog.js'),
    )
    child = launched.child
    childTicket = launched.ticket
    child.on('error', () => {
      closeOwner(undefined)
    })
    child.on('close', () => {
      closeOwner(undefined)
    })
    child.on('exit', stop)
    if (watchdog !== undefined) {
      if (watchdogTicket === undefined) throw new Error('ESTOP_WATCHDOG')
      const guard = watchdog
      const binding: StopBinding = {
        generation,
        ownerId,
        ticketId: childTicket.id,
        root: childTicket.root,
        guardian: watchdogTicket.root,
      }
      const nextOwner = `${record}.${randomUUID()}`
      await writePrivateRecord(nextOwner, ownership(binding))
      await rename(nextOwner, record)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('ESTOP_WATCHDOG'))
        }, RUNTIME_STOP.exitMs)
        guard.stdout.once('data', (bytes: Buffer) => {
          clearTimeout(timer)
          if (bytes.toString('ascii') === 'OWNED\n') resolve()
          else reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.once('close', () => {
          clearTimeout(timer)
          reject(new Error('ESTOP_WATCHDOG'))
        })
        guard.stdin.write(`${JSON.stringify({ ticket: childTicket, binding })}\n`)
      })
    }
    launched.admit()
    lifecycle.wasAdmitted = true
    // Piping preserves byte boundaries/backpressure; provider stderr is private.
    deps.stdin.pipe(child.stdin)
    child.stdin.on('error', stop)
    child.stdout.pipe(deps.stdout, { end: false })
    child.stderr.resume()
    finishStartup(undefined)
    await closed
    stop()
    await stopping
    if (child.pid === undefined) return 1
    if (lifecycle.isIntentionalStop) return RUNTIME_STOP.stoppedExit
    if (child.signalCode !== null) {
      deps.onSignalExit?.(child.signalCode)
      return RUNTIME_STOP.signalExitBase + osConstants.signals[child.signalCode]
    }
    return child.exitCode ?? 1
  } catch (error: unknown) {
    if (child === undefined && error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return 1
    throw error
  } finally {
    finishStartup(undefined)
    stop()
    try {
      await stopping
    } finally {
      process.off('SIGTERM', requestStop)
      process.off('SIGINT', requestStop)
      if (watchdog !== undefined) {
        watchdog.stdin.end()
        await watchdogDone
        const ticket = watchdogTicket
        if (
          ticket !== undefined &&
          authority.registry.tickets().some((entry) => entry.id === ticket.id)
        )
          await authority.stop(ticket)
      }
      if (child !== undefined) deps.stdin.unpipe(child.stdin)
      deps.stdin.destroy()
      await new Promise<void>((resolve) => {
        // Let the final acknowledgement drain before closing authenticated peers.
        const timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy()
        }, RUNTIME_STOP.graceMs)
        control.close(() => {
          clearTimeout(timer)
          resolve()
        })
      })
      if (lifecycle.didStopTree || !lifecycle.wasAdmitted) {
        await rm(`${record}.tree.observed`, { force: true })
        await rm(`${record}.tree`, { force: true })
        await rm(record, { force: true })
        if (locator !== undefined) await rm(locator, { force: true })
        await rm(directory, { recursive: true, force: true })
      }
    }
  }
}

/** Private authenticated control sockets reach every owner in this workspace.
An unreadable, empty, truncated or schema-invalid owner file is an unusable
record, and a well-formed record from another trust root is foreign: both
are skipped and reported, never signalled and never fatal. Only two
well-formed records for the same ownerId:generation stay ESTOP_AMBIGUOUS. */
export async function stopWorkspace(
  registries: string | readonly string[],
  cwd: string,
  packageRoot = path.resolve(__dirname, '..'),
  diagnostic: (message: string) => void = () => {
    /* Callers that stop by string keep the previous silent-skip behaviour. */
  },
): Promise<void> {
  const { ownerSchema, isReceiptMatching, isSameProcess } = await import('./stopReceipt')
  const prefix = `${workspaceKey(cwd)}-`
  const owners: { registry: string; file: string; owner: StopOwner }[] = []
  const runs = new Set<string>()
  const uniqueRegistries = new Set(typeof registries === 'string' ? [registries] : registries)
  for (const registry of uniqueRegistries) {
    let files: string[]
    try {
      // Missing registries are not native ACL refusals on Windows.
      await lstat(registry)
      await privateDirectory(registry)
      files = await readdir(registry)
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    const trustRoot = await realpath(path.dirname(registry))
    for (const file of files) {
      if (!file.startsWith(prefix) || !file.endsWith('.json')) continue
      const record = path.join(registry, file)
      let raw: unknown
      try {
        raw = await readStopRecord(record)
      } catch (error: unknown) {
        // The owner removes its private record when it finishes stopping.
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
        diagnostic(`ESTOP_RECORD_UNUSABLE: ${record}: ${unusableRecordReason(error)}`)
        continue
      }
      const parsed = ownerSchema.safeParse(raw)
      if (!parsed.success) {
        diagnostic(`ESTOP_RECORD_UNUSABLE: ${record}: schema-invalid`)
        continue
      }
      if (parsed.data.trustRoot.replaceAll('\\', '/') !== trustRoot.replaceAll('\\', '/')) {
        diagnostic(`ESTOP_RECORD_FOREIGN: ${record}: trust-root-mismatch`)
        continue
      }
      const owner = parsed.data
      const run = `${owner.ownerId}:${owner.generation}`
      if (runs.has(run)) throw new Error('ESTOP_AMBIGUOUS')
      runs.add(run)
      owners.push({ registry, file, owner })
    }
  }
  if (typeof registries !== 'string' && owners.length === 0) throw new Error('ESTOP_NO_RUN')
  const isRecordGone = async (record: string) => {
    try {
      await lstat(record)
      return false
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return true
      throw error
    }
  }
  const stopOwner = async (entry: (typeof owners)[number]): Promise<void> => {
    const { registry, file, owner } = entry
    const record = path.join(registry, file)
    if (!isProcessAlive(owner.pid)) {
      const receiptFile = `${record}.tree`
      let receipt: StopReceipt | undefined
      try {
        receipt = await readTreeReceipt(receiptFile)
      } catch {
        // Missing, invalid or unsafe receipt never certifies descendant exit.
      }
      const binding = owner.binding
      if (
        receipt?.isComplete !== true ||
        binding?.generation !== owner.generation ||
        owner.ownerId !== binding.ownerId ||
        file !== `${prefix}${owner.ownerId}.json` ||
        !isReceiptMatching(receipt, binding)
      ) {
        let observed = receipt
        if (binding === null || (observed !== undefined && !isReceiptMatching(observed, binding)))
          observed = undefined
        if (observed === undefined) {
          try {
            const pending = await readTreeReceipt(`${receiptFile}.observed`)
            if (binding !== null && isReceiptMatching(pending, binding)) observed = pending
          } catch {
            /* Missing/unsafe observations provide no authority. */
          }
        }
        throw new UnverifiedStopError(observed?.members.map((member) => member.pid) ?? [owner.pid])
      }
      const { processAuthority } = await import('./processAuthority')
      const authority = await processAuthority(packageRoot, registry)
      const liveGuardian = await authority.identity(binding.guardian.pid)
      // A completed guardian may have exited; a live/reused PID must match its birth.
      if (
        (liveGuardian === null && isProcessAlive(binding.guardian.pid)) ||
        (liveGuardian !== null && !isSameProcess(liveGuardian, binding.guardian))
      )
        throw new UnverifiedStopError(receipt.members.map((member) => member.pid))
      await rm(path.join(registry, file), { force: true })
      await rm(receiptFile, { force: true })
      await rm(`${receiptFile}.observed`, { force: true })
      return
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(owner.pipe)
        socket.setTimeout(RUNTIME_STOP.exitMs, () => {
          socket.destroy(new Error('ESTOP_TIMEOUT'))
        })
        let reply = ''
        socket.on('error', reject)
        socket.on('connect', () => {
          socket.write(`${owner.token}\n`)
        })
        socket.on('data', (bytes: Buffer) => {
          reply += bytes.toString('utf8')
          if (reply.length > RUNTIME_STOP.handshakeChars) socket.destroy(new Error('ESTOP_REPLY'))
        })
        socket.on('close', (failed) => {
          if (!failed && reply === 'STOPPED\n') resolve()
          else reject(new Error('ESTOP_TREE'))
        })
      })
    } catch (error: unknown) {
      // A stopping owner closes its control socket before it removes its record.
      if (
        !(error instanceof Error && 'code' in error) ||
        (error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED')
      )
        throw error
      const deadline = Date.now() + RUNTIME_STOP.exitMs
      for (;;) {
        // Sample liveness first: a record seen after death is final, never mid-removal.
        const [isAlive, isGone] = [isProcessAlive(owner.pid), await isRecordGone(record)]
        if (isGone) return
        if (!isAlive) {
          await stopOwner(entry)
          return
        }
        if (Date.now() >= deadline) throw error
        await delay(RUNTIME_STOP.pollMs)
      }
    }
  }
  for (let offset = 0; offset < owners.length; offset += RUNTIME_STOP.owners)
    await Promise.all(
      owners.slice(offset, offset + RUNTIME_STOP.owners).map((entry) => stopOwner(entry)),
    )
}
