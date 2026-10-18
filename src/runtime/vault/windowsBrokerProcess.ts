import path from 'node:path'
import type { Duplex } from 'node:stream'
import process from 'node:process'
import { unlinkSync } from 'node:fs'
import type * as z from 'zod/mini'
import { VaultBrokerDiscovery, type VaultBrokerLocation } from '../../core/vault/broker/discovery'
import { isVaultFileMissing, type VaultPrivateFilesPort } from '../../core/vault/broker/files'
import type { VaultSecuredListenerPort } from '../../core/vault/broker/channel'
import {
  WindowsVaultPeerVerifier,
  type VaultPeerVerifier,
  type VaultProcessIdentity,
} from '../../core/vault/broker/peer'
import {
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
  VAULT_BROKER_MAX_CONNECTIONS,
  VAULT_BROKER_NATIVE_TIMEOUT_MS,
} from '../../shared/constants'
import { vaultBrokerLockSchema } from '../../shared/vaultProtocol'
import type { WindowsVaultExecutable } from './slots/windowsVaultTransport'
import {
  startWindowsPipeServe,
  windowsVaultPipeName,
  type PipeRelay,
  type WindowsPipeFiles,
} from './windowsPipeRelay'
import {
  windowsBrokerPlatform,
  windowsProcessIdentity,
  type WindowsBrokerPlatform,
} from './windowsHost'

/** Mirrors VaultBrokerProcessOptions, with the pipe helper instead of the POSIX peer. */
export interface WindowsVaultBrokerProcessOptions {
  readonly runDirectory: string
  readonly dataDir: string
  readonly userSession: string
  readonly pipeHelper: WindowsVaultExecutable
  readonly idleMs?: number
  channel(
    location: VaultBrokerLocation,
    endpoint: {
      readonly listener: VaultSecuredListenerPort
      readonly peers: VaultPeerVerifier
      readonly platform: WindowsBrokerPlatform
    },
  ): Promise<{ listen(socket: string): Promise<void>; close(): Promise<void> }>
  lock(lock: {
    readonly isStarting: boolean
    readonly isClosing: boolean
    readonly location: VaultBrokerLocation
    readonly sockets: ReadonlySet<Duplex>
    readonly emptySince: number | null
  }): Promise<void>
  dispose(): Promise<void>
}

async function clearStaleWindowsBroker(
  discovery: VaultBrokerDiscovery,
  files: VaultPrivateFilesPort,
  guard: WindowsPipeFiles,
  relay: PipeRelay,
  userSession: string,
): Promise<void> {
  let raw: Buffer
  try {
    raw = await files.read(discovery.lockFile)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  let lock: z.infer<typeof vaultBrokerLockSchema>
  try {
    lock = vaultBrokerLockSchema.parse(JSON.parse(raw.toString('utf8')))
  } catch {
    // Not our shape: never delete what we cannot identify.
    throw new Error(UI_TEXT.vault.noAccess)
  }
  const live = await windowsProcessIdentity(relay, lock.processId)
  if (
    live !== null &&
    lock.userSession === userSession &&
    live.process.startedAt === lock.startedAt
  )
    throw new Error(UI_TEXT.vault.noAccess)
  try {
    const reread = await files.read(discovery.lockFile)
    const current = vaultBrokerLockSchema.parse(JSON.parse(reread.toString('utf8')))
    if (current.processId !== lock.processId || current.startedAt !== lock.startedAt)
      throw new Error(UI_TEXT.vault.noAccess)
    await guard.verify(discovery.lockFile, 'file')
    unlinkSync(discovery.lockFile)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return
    throw error
  }
  try {
    await guard.verify(discovery.tokenFile, 'file')
    unlinkSync(discovery.tokenFile)
  } catch (error: unknown) {
    if (!isVaultFileMissing(error)) throw error
  }
}

/** One serve helper's live pipe, shared by the starter that owns it. */
export type WindowsVaultBrokerServe = Awaited<ReturnType<typeof startWindowsPipeServe>>

/**
 * Start (or adopt) the vault broker on Windows: one serve helper owns the
 * pipe and the owner-only files; the claim publishes the pipe name where
 * POSIX publishes the socket path. A racing starter loses the claim and its
 * child exits: discovery then finds the winner.
 */
export async function startWindowsVaultBrokerProcess(
  options: WindowsVaultBrokerProcessOptions,
): Promise<{
  readonly location: VaultBrokerLocation
  close(): Promise<void>
  closed: Promise<void>
}> {
  if (process.platform !== 'win32') throw new Error(UI_TEXT.vault.noAccess)
  if (!path.isAbsolute(options.runDirectory) || !path.isAbsolute(options.dataDir))
    throw new Error(UI_TEXT.vault.noAccess)
  const pipe = windowsVaultPipeName()
  const serve = await startWindowsPipeServe(options.pipeHelper, pipe)
  try {
    return await startWindowsVaultBrokerOnServe(options, serve)
  } catch (error: unknown) {
    try {
      await serve.stop()
    } catch {
      /* Startup already failed; the stop is best-effort. */
    }
    throw error
  }
}

/**
 * The broker on an already-serving pipe: the installed entry builds the
 * serve relay first (its platform feeds the bindings), then starts the
 * broker on it instead of serving twice.
 */
export async function startWindowsVaultBrokerOnServe(
  options: WindowsVaultBrokerProcessOptions & {
    /** The serve helper's own file: the files port verifies integrity against it. */
    readonly helperFile?: string
  },
  serve: WindowsVaultBrokerServe,
): Promise<{
  readonly location: VaultBrokerLocation
  close(): Promise<void>
  closed: Promise<void>
}> {
  if (process.platform !== 'win32') throw new Error(UI_TEXT.vault.noAccess)
  if (!path.isAbsolute(options.runDirectory) || !path.isAbsolute(options.dataDir))
    throw new Error(UI_TEXT.vault.noAccess)
  const pipe = serve.relay.pipe
  if (pipe === null) throw new Error(UI_TEXT.vault.noAccess)
  const relay = serve.relay
  {
    const platform = windowsBrokerPlatform(
      relay,
      serve.ownerSid,
      options.helperFile ?? options.pipeHelper.file,
    )
    const privateFiles = platform.files
    const guard = platform.guard
    const discovery = new VaultBrokerDiscovery(options.runDirectory, options.userSession, {
      directory: (dir) => privateFiles.directory(dir),
      read: (file, maxBytes) => privateFiles.read(file, maxBytes),
      replace: (file, bytes, authorize) => privateFiles.replace(file, bytes, authorize),
      claim: (file, bytes, onReady) => privateFiles.claim(file, bytes, onReady),
      writer: (dir) => privateFiles.writer(dir),
    })
    await privateFiles.directory(discovery.directory)
    await clearStaleWindowsBroker(discovery, privateFiles, guard, relay, options.userSession)
    const self = await windowsProcessIdentity(relay, process.pid)
    if (!self) throw new Error(UI_TEXT.vault.noAccess)
    const identity: VaultProcessIdentity = {
      processId: self.process.processId,
      userId: self.process.userId,
      startedAt: self.process.startedAt,
      executable: self.process.executable,
    }
    if (identity.userId !== serve.ownerSid) throw new Error(UI_TEXT.vault.noAccess)
    const claim = await discovery.claim(identity, pipe)
    const sockets = new Set<Duplex>()
    const lifecycle = {
      isStarting: true,
      isClosing: false,
      location: claim.location,
      sockets,
      emptySince: null as number | null,
    }
    const listener: VaultSecuredListenerPort = {
      listen: async (file, accepted) => {
        if (file !== pipe) throw new Error(UI_TEXT.vault.noAccess)
        return await serve.listen(file, (socket) => {
          if (lifecycle.isClosing || sockets.size >= VAULT_BROKER_MAX_CONNECTIONS) {
            socket.destroy()
            return
          }
          sockets.add(socket)
          socket.once('close', () => {
            sockets.delete(socket)
          })
          accepted(socket)
        })
      },
    }
    const peers = new WindowsVaultPeerVerifier(
      { inspect: (socket) => serve.inspect(socket) },
      serve.ownerSid,
    )
    const channel = await options.channel(claim.location, {
      listener,
      peers,
      platform,
    })
    await channel.listen(pipe)
    lifecycle.isStarting = false
    const idleMs = options.idleMs ?? VAULT_BROKER_NATIVE_TIMEOUT_MS
    const interval = setInterval(() => {
      void (async () => {
        try {
          await options.lock(lifecycle)
        } catch {
          /* A lock check never fails startup; the next round retries. */
        }
      })()
      if (lifecycle.isClosing || sockets.size > 0) lifecycle.emptySince = null
      else {
        if (lifecycle.emptySince === null) lifecycle.emptySince = Date.now()
        else if (Date.now() - lifecycle.emptySince > idleMs) void close()
      }
    }, MILLISECONDS_PER_SECOND)
    interval.unref()
    let isClosed = false
    const settlements: { resolve: () => void }[] = []
    const closed = new Promise<void>((resolve) => {
      settlements.push({ resolve })
    })
    // close() retains any error; closed only observes the shutdown.
    void closed.catch(() => {
      /* The caller awaiting only close() sees the error there. */
    })
    const close = async (): Promise<void> => {
      if (isClosed) return
      isClosed = true
      lifecycle.isClosing = true
      clearInterval(interval)
      const settlement = settlements[0]
      if (!settlement) throw new Error(UI_TEXT.vault.noAccess)
      try {
        for (const socket of sockets) socket.destroy()
        await channel.close()
        try {
          await claim.release()
        } catch {
          /* The claim is already gone; disposal still runs. */
        }
        await options.dispose()
        await serve.stop()
      } finally {
        settlement.resolve()
      }
    }
    // The claim publishes the pipe name where POSIX publishes the socket
    // path: clients read the broker record either way.
    // The serve relay belongs to the starter: a failed broker never stops
    // another owner's pipe (close() above still stops a started broker's
    // own serve). The starter stops what it started.
    return { location: claim.location, close, closed }
  }
}
