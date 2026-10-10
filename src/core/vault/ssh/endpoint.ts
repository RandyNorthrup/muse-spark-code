import { createServer, type Socket } from 'node:net'
import { chmod, lstat } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { VAULT_LIMITS } from '../../../shared/constants'
import { vaultPrivateDirectory } from '../broker/files'
import { type VaultPeerVerifier, type VaultProcessIdentity } from '../broker/peer'
import { VaultSshSession } from './session'
import { type SshSessionDeps, type SshAccessPort } from './ports'
import { sshFailure } from './wire'

export interface SshListenerPort {
  readonly kind: 'unix' | 'windowsOwnerOnly'
  /** Windows implementation must create an owner-only DACL and reject remote clients before accept. */
  listen(address: string, accept: (socket: Socket) => void): Promise<{ close(): Promise<void> }>
}
/** Unix sockets live in the owner-only run directory; never replace an existing pathname. */
export const unixSshListener: SshListenerPort = {
  kind: 'unix',
  async listen(address, accept) {
    const directory = path.dirname(address)
    await vaultPrivateDirectory(directory)
    try {
      await lstat(address)
      throw sshFailure()
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const accepted = new Set<Socket>()
    const server = createServer((socket) => {
      accepted.add(socket)
      socket.once('close', () => {
        accepted.delete(socket)
      })
      accept(socket)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(address, () => {
          server.removeListener('error', reject)
          resolve()
        })
      })
      await chmod(address, fsConstants.S_IRUSR | fsConstants.S_IWUSR)
    } catch {
      for (const socket of accepted) socket.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
      throw sshFailure()
    }
    return {
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      },
    }
  },
}

export async function createSshEndpoint(deps: {
  platform: NodeJS.Platform
  runDirectory: string
  /** On Windows this is P/W's protected listener, never Node's default named-pipe ACL. */
  listener: SshListenerPort
  peers: VaultPeerVerifier
  /** The trusted launcher verifies the peer's pid/start/image belongs to this requester. */
  access(peer: VaultProcessIdentity, signal: AbortSignal): Promise<SshAccessPort>
  knownHosts: SshSessionDeps['knownHosts']
  destination?: string
  terminate(peer: VaultProcessIdentity): Promise<boolean>
}): Promise<{ address: string; close(): Promise<void> }> {
  if ((deps.platform === 'win32') !== (deps.listener.kind === 'windowsOwnerOnly'))
    throw sshFailure()
  const token = randomBytes(VAULT_LIMITS.idBytes).toString(
    deps.platform === 'win32' ? 'hex' : 'base64url',
  )
  const address =
    deps.platform === 'win32'
      ? String.raw`\\.\pipe\muse-spark-vault-ssh-${token}`
      : path.join(deps.runDirectory, `s-${token}.sock`)
  const sockets = new Set<Socket>(),
    sessions = new Set<VaultSshSession>(),
    controller = new AbortController()
  let isClosed = false
  let listener: Awaited<ReturnType<SshListenerPort['listen']>>
  try {
    listener = await deps.listener.listen(address, (socket) => {
      if (isClosed) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      const connection = new AbortController()
      const stop = (): void => {
        connection.abort()
        socket.destroy()
      }
      controller.signal.addEventListener('abort', stop, { once: true })
      socket.on('error', () => {
        socket.destroy()
      })
      socket.pause()
      let session: VaultSshSession | undefined
      socket.once('close', () => {
        connection.abort()
        session?.close()
        if (session) sessions.delete(session)
        sockets.delete(socket)
        controller.signal.removeEventListener('abort', stop)
      })
      void (async () => {
        const check = (): void => {
          if (isClosed || connection.signal.aborted || socket.destroyed) throw sshFailure()
        }
        try {
          const peer = await deps.peers.verify(socket)
          check()
          const access = await deps.access(peer, connection.signal)
          check()
          session = new VaultSshSession({
            access,
            knownHosts: deps.knownHosts,
            ...(deps.destination && { destination: deps.destination }),
            send: (bytes) => {
              if (socket.destroyed || !socket.writable) throw sshFailure()
              socket.write(bytes)
            },
            close: () => {
              socket.destroy()
            },
            terminate: () => deps.terminate(peer),
          })
          sessions.add(session)
          const active = session
          socket.on('data', (bytes: Buffer) => {
            active.receive(bytes)
          })
          socket.resume()
        } catch {
          socket.destroy()
        }
      })()
    })
  } catch {
    isClosed = true
    controller.abort()
    for (const session of sessions) session.close()
    for (const socket of sockets) socket.destroy()
    throw sshFailure()
  }
  return {
    address,
    close: async () => {
      if (isClosed) return
      isClosed = true
      controller.abort()
      for (const session of sessions) session.close()
      for (const socket of sockets) socket.destroy()
      await listener.close()
    },
  }
}

/** Windows compatibility is a capture fact, supplied by W, not inferred from the executable name. */
export function sshProcessEnvironment(
  address: string,
  choice: { platform: NodeJS.Platform; gitSshSupportsPipe: boolean; windowsOpenSshPath?: string },
): Record<string, string> {
  const normalized = address.replaceAll('\\', '/').toLowerCase()
  if (normalized === '//./pipe/openssh-ssh-agent' || normalized === '//?/pipe/openssh-ssh-agent')
    throw sshFailure()
  if (choice.platform !== 'win32') return { SSH_AUTH_SOCK: address }
  if (!/^\/\/\.\/pipe\/muse-spark-vault-ssh-[a-f0-9]+$/u.test(normalized)) throw sshFailure()
  if (choice.gitSshSupportsPipe) return { SSH_AUTH_SOCK: address }
  const executable = choice.windowsOpenSshPath?.replaceAll('\\', '/')
  if (
    !executable ||
    !/^[a-z]:\//iu.test(executable) ||
    /['"\r\n\0]/u.test(executable) ||
    !executable.toLowerCase().endsWith('/openssh/ssh.exe')
  )
    throw sshFailure()
  return { SSH_AUTH_SOCK: address, GIT_SSH_COMMAND: `'${executable}'` }
}
