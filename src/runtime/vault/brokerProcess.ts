import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { constants } from 'node:fs'
import { chmod, lstat, realpath, unlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { type Duplex } from 'node:stream'
import { VaultBrokerDiscovery, type VaultBrokerLocation } from '../../core/vault/broker/discovery'
import { UnixVaultPrivateFiles, isVaultFileMissing } from '../../core/vault/broker/files'
import {
  isPathWithin,
  resolveVaultSocket,
  verifyVaultSocketBase,
  verifyVaultSocketFile,
} from '../../core/vault/broker/socketDirectory'
import { type VaultChannelServer } from '../../core/vault/broker/channel'
import { type VaultSecuredListenerPort } from '../../core/vault/broker/ports'
import { vaultBrokerLockSchema } from '../../shared/vaultProtocol'
import {
  UI_TEXT,
  VAULT_BROKER_EMPTY_IDLE_MS,
  VAULT_BROKER_MAX_CONNECTIONS,
} from '../../shared/constants'
import { holdVaultStartupLock, vaultProcessIdentity } from './posixNative'

export interface VaultBrokerProcessOptions {
  readonly runDirectory: string
  /** The data folder: the socket leaf names a short hash of it, never its path. */
  readonly dataDir: string
  readonly userSession: string
  readonly helper: string
  readonly idleMs?: number
  /** The installed binding composes the real channel; it never comes from a workspace path. */
  readonly channel: (
    location: VaultBrokerLocation,
    listener: VaultSecuredListenerPort,
  ) =>
    | Pick<VaultChannelServer, 'listen' | 'close'>
    | Promise<Pick<VaultChannelServer, 'listen' | 'close'>>
  readonly lock: () => Promise<void>
  readonly dispose: () => Promise<void>
}

/**
Only under the kernel startup lock. Never delete a live broker's files.
The socket is recovered through the record that names it (the broker
record in the data folder carries the socket path), and only while it
stays inside this broker's own socket directory: a foreign record never
directs a deletion elsewhere.
*/
async function clearStale(
  discovery: VaultBrokerDiscovery,
  helper: string,
  socketDirectory: string,
  expectedSocket: string,
): Promise<void> {
  const files = new UnixVaultPrivateFiles()
  let lock: ReturnType<typeof vaultBrokerLockSchema.parse> | null = null
  try {
    const bytes = await files.read(path.join(discovery.directory, 'broker.lock'))
    lock = vaultBrokerLockSchema.parse(JSON.parse(bytes.toString('utf8')))
    const live = await vaultProcessIdentity(helper, lock.processId)
    if (lock.userSession !== discovery.userSession || live?.startedAt === lock.startedAt)
      throw new Error(UI_TEXT.vault.noAccess)
  } catch (error: unknown) {
    if (!isVaultFileMissing(error)) throw error
  }
  for (const name of ['broker.lock', 'boot-token']) {
    const file = path.join(discovery.directory, name)
    try {
      const sample = await lstat(file)
      if (
        sample.isSymbolicLink() ||
        sample.uid !== process.getuid?.() ||
        (sample.mode & (constants.S_IRWXG | constants.S_IRWXO)) !== 0 ||
        !sample.isFile() ||
        sample.nlink !== 1
      )
        throw new Error(UI_TEXT.vault.noAccess)
      await unlink(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    }
  }
  // A crash can happen after bind, so the socket named by the dead record is
  // recovered too; without a record the expected path itself is recovered.
  // The file check refuses a hostile record; an absent socket simply stays so.
  const sockets = [lock ? lock.socket : expectedSocket]
  for (const file of sockets) {
    try {
      if (!(await isPathWithin(file, socketDirectory))) throw new Error(UI_TEXT.vault.noAccess)
      // Refuses a hostile record; an absent socket reports missing below.
      await verifyVaultSocketFile(file)
      await unlink(file)
    } catch (error: unknown) {
      if (!isVaultFileMissing(error)) throw error
    }
  }
}

/** Per user-session/protocol singleton, owner-only socket, bounded empty idle and crash recovery. */
export async function startVaultBrokerProcess(options: VaultBrokerProcessOptions): Promise<{
  readonly location: VaultBrokerLocation
  readonly closed: Promise<void>
  close(): Promise<void>
}> {
  if (process.platform !== 'linux' && process.platform !== 'darwin')
    throw new Error(UI_TEXT.vault.noAccess)
  const idleMs = options.idleMs ?? VAULT_BROKER_EMPTY_IDLE_MS
  if (
    !path.isAbsolute(options.runDirectory) ||
    !path.isAbsolute(options.dataDir) ||
    !path.isAbsolute(options.helper) ||
    !options.userSession ||
    !Number.isSafeInteger(idleMs) ||
    idleMs < 1
  )
    throw new Error(UI_TEXT.vault.noAccess)
  // The socket lives in a bounded owner-only location outside the data
  // folder; the byte length is measured before bind and refused in a
  // sentence when even the bounded location is too long (RVCM109JE P2-3).
  const socketLocation = await resolveVaultSocket(options.dataDir, {
    platform: process.platform,
    env: process.env,
    tmpdir: os.tmpdir(),
    homeDir: os.homedir(),
  })
  const files = new UnixVaultPrivateFiles()
  const discovery = new VaultBrokerDiscovery(options.runDirectory, options.userSession, files)
  await files.directory(discovery.directory)
  // Identity, never spelling: /var and /private/var name the same macOS root.
  if ((await realpath(discovery.directory)) !== (await realpath(path.resolve(discovery.directory))))
    throw new Error(UI_TEXT.vault.noAccess)
  const held = await holdVaultStartupLock(
    options.helper,
    path.join(discovery.directory, 'startup.lock'),
  )
  const settlements: { resolve: () => void; reject: (error: unknown) => void }[] = []
  const closed = new Promise<void>((resolve, reject) => {
    settlements.push({ resolve, reject })
  })
  // close() and closed both retain the error; either may be the caller's chosen observer.
  void closed.catch(() => {
    /* Prevent a duplicate unhandled rejection when the caller awaits only close(). */
  })
  const settlement = settlements[0]
  if (!settlement) throw new Error(UI_TEXT.vault.noAccess)
  const done = { ...settlement, promise: closed }
  const lifecycle: { isStarting: boolean; hasLostLock: boolean; isClosing: boolean } = {
    isStarting: true,
    hasLostLock: false,
    isClosing: false,
  }
  let channel: Pick<VaultChannelServer, 'listen' | 'close'> | undefined
  let release: (() => Promise<void>) | undefined
  let closing: Promise<void> | undefined
  // The listener's raw server while its listen/chmod window is open. The
  // channel only learns it once listen returns, so close() stops it here;
  // otherwise a server error during chmod shuts down nothing and leaks it.
  let pendingServer: ReturnType<typeof createServer> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const sockets = new Set<Duplex>()
  const close = (): Promise<void> => {
    lifecycle.isClosing = true
    closing ??= (async () => {
      clearTimeout(timer)
      try {
        if (release) await options.lock()
      } finally {
        try {
          await channel?.close()
        } finally {
          // Own the raw server the channel has not learned yet: a shutdown
          // during the listen/chmod window must still stop it listening.
          // Taken exactly once (the listener clears it on the same test),
          // so this and the post-chmod stop below never close it twice.
          const pending = pendingServer
          pendingServer = undefined
          if (pending?.listening)
            await new Promise<void>((resolve) => {
              pending.close(() => {
                resolve()
              })
            })
          try {
            await options.dispose()
          } finally {
            try {
              await release?.()
            } finally {
              await held.release()
            }
          }
        }
      }
    })()
    void closing.then(done.resolve).catch(done.reject)
    return closing
  }
  const empty = (): void => {
    clearTimeout(timer)
    if (!closing && sockets.size === 0)
      timer = setTimeout(() => {
        void close().catch(done.reject)
      }, idleMs)
  }
  const assertHeld = (): void => {
    if (lifecycle.isClosing || lifecycle.hasLostLock) throw new Error(UI_TEXT.vault.noAccess)
  }
  // The socket server's shutdown handler: subscribed before the chmod await
  // inside listen, so a failure during the permission fix still closes here.
  const onServerError = (): void => {
    void close().catch(done.reject)
  }
  held.onLost(() => {
    lifecycle.hasLostLock = true
    if (!lifecycle.isStarting) void close().catch(done.reject)
  })
  try {
    await clearStale(discovery, options.helper, socketLocation.directory, socketLocation.socket)
    assertHeld()
    const identity = await vaultProcessIdentity(options.helper, process.pid)
    if (identity?.userId !== String(process.getuid?.())) throw new Error(UI_TEXT.vault.noAccess)
    // The broker record in the data folder carries this socket path; clients
    // verify the socket owner before they speak.
    const socket = socketLocation.socket
    const claim = await discovery.claim(identity, socket)
    release = claim.release
    const listener: VaultSecuredListenerPort = {
      listen: async (file, accepted) => {
        if (file !== socket) throw new Error(UI_TEXT.vault.noAccess)
        // The directory is verified again immediately before bind: ownership,
        // mode and type, every start.
        await verifyVaultSocketBase(socketLocation.directory)
        const server = createServer((stream) => {
          if (closing || lifecycle.hasLostLock || sockets.size >= VAULT_BROKER_MAX_CONNECTIONS) {
            stream.destroy()
            return
          }
          clearTimeout(timer)
          sockets.add(stream)
          stream.once('close', () => {
            sockets.delete(stream)
            empty()
          })
          accepted(stream)
        })
        // Stored before any await so close() owns it during the window below.
        pendingServer = server
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(file, () => {
              server.removeListener('error', reject)
              resolve()
            })
          })
          // A server failure during the permission fix must still shut the
          // broker down: subscribe before the chmod await, not after it.
          server.on('error', onServerError)
          await chmod(file, constants.S_IRUSR | constants.S_IWUSR)
        } catch (error: unknown) {
          if (pendingServer === server) pendingServer = undefined
          if (server.listening)
            await new Promise<void>((resolve) =>
              server.close(() => {
                resolve()
              }),
            )
          throw error
        }
        // Shutdown ran while the permission fix was in flight: close() owned
        // only the raw server above, so stop the just-bound server here
        // instead of handing a live one to a closing broker.
        if (lifecycle.isClosing) {
          if (pendingServer === server) pendingServer = undefined
          if (server.listening)
            await new Promise<void>((resolve) => {
              server.close(() => {
                resolve()
              })
            })
          throw new Error(UI_TEXT.vault.noAccess)
        }
        return async () => {
          if (pendingServer === server) pendingServer = undefined
          for (const stream of sockets) stream.destroy()
          await new Promise<void>((resolve, reject) =>
            server.close((error) => {
              if (error) reject(error)
              else resolve()
            }),
          )
        }
      },
    }
    channel = await options.channel(claim.location, listener)
    assertHeld()
    await channel.listen(socket)
    assertHeld()
    lifecycle.isStarting = false
    empty()
    return { location: claim.location, closed: done.promise, close }
  } catch (error: unknown) {
    // No returned handle exists on startup failure, so observe its cleanup settlement here.
    void done.promise.catch(() => {
      /* Startup caller receives the cleanup error below. */
    })
    await close()
    throw error
  }
}
