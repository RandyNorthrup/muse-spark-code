import { connect, type Socket } from 'node:net'
import { VAULT_APPROVAL_TTL_MS } from '../../../shared/constants'
import { vaultItemMetadataSchema, type VaultItemMetadata } from '../../../shared/vault'
import { SSH, parseSshResponse, SshFramer, sshFrame, sshString, uint32, sshFailure } from './wire'
import { type SshExternalAgentPort, type SshIdentity } from './ports'
import { parsePublicKey, sshFingerprint, isSshSignatureValid, validateSignFlags } from './keys'

export interface SshAgentConnection {
  request(frame: Buffer): Promise<Buffer>
  close(): void
}
/** Connects only to an explicitly selected user agent, never to the Windows system pipe. */
export async function connectUserSshAgent(
  address: string,
  verifyServer: (socket: Socket) => Promise<void>,
  signal: AbortSignal,
): Promise<SshAgentConnection> {
  const normalized = address.replaceAll('\\', '/').toLowerCase()
  if (
    normalized === '//./pipe/openssh-ssh-agent' ||
    normalized === '//?/pipe/openssh-ssh-agent' ||
    signal.aborted
  )
    throw sshFailure()
  const socket = connect(address),
    framer = new SshFramer()
  let pending: { resolve: (frame: Buffer) => void; reject: (error: Error) => void } | null = null
  let isClosed = false
  const check = (): void => {
    if (isClosed) throw sshFailure()
  }
  const close = (): void => {
    if (isClosed) return
    isClosed = true
    clearTimeout(timer)
    socket.destroy()
    framer.close()
    signal.removeEventListener('abort', close)
    const waiter = pending
    pending = null
    waiter?.reject(sshFailure())
  }
  signal.addEventListener('abort', close, { once: true })
  const timer = setTimeout(close, VAULT_APPROVAL_TTL_MS)
  socket.on('error', close)
  socket.on('close', close)
  socket.on('data', (bytes: Buffer) => {
    try {
      framer.push(bytes, (frame) => {
        const waiter = pending
        if (!waiter) throw sshFailure()
        pending = null
        waiter.resolve(Buffer.from(frame))
      })
    } catch {
      close()
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (): void => {
        reject(sshFailure())
      }
      socket.once('error', failed)
      socket.once('close', failed)
      socket.once('connect', () => {
        socket.removeListener('error', failed)
        socket.removeListener('close', failed)
        resolve()
      })
    })
    // An abort during server verification must settle this wait: race the
    // verifier so a silent server cannot hold the connection open.
    let onAbort: (() => void) | undefined
    try {
      await Promise.race([
        verifyServer(socket),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            reject(sshFailure())
          }
          if (signal.aborted) onAbort()
          else signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
    } finally {
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
    }
    check()
    return {
      request: async (frame) => {
        if (isClosed || pending) throw sshFailure()
        return await new Promise<Buffer>((resolve, reject) => {
          pending = { resolve, reject }
          socket.write(frame, (error) => {
            if (error) close()
          })
        })
      },
      close: () => {
        clearTimeout(timer)
        close()
      },
    }
  } catch {
    clearTimeout(timer)
    close()
    throw sshFailure()
  }
}

/** Each authorized signature opens a private upstream connection and preserves its bind chain. */
export function frontUserSshAgent(deps: {
  open(signal: AbortSignal): Promise<SshAgentConnection>
  metadata(blob: Buffer): Promise<VaultItemMetadata | null>
}): SshExternalAgentPort {
  return {
    async identities(signal) {
      const connection = await deps.open(signal)
      let response: Buffer | undefined
      try {
        response = await connection.request(sshFrame(SSH.identities))
        const parsed = parseSshResponse(response)
        if (parsed.kind !== 'identities') throw sshFailure()
        // One undecodable upstream blob skips; it must not deny the reviewed rest.
        const keys: Buffer[] = []
        for (const entry of parsed.keys) {
          try {
            parsePublicKey(entry.blob)
          } catch {
            continue
          }
          keys.push(Buffer.from(entry.blob))
        }
        const identities: SshIdentity[] = []
        for (const blob of keys) {
          const supplied = await deps.metadata(blob)
          if (!supplied) continue
          const item = vaultItemMetadataSchema.parse(supplied)
          if (
            item.kind !== 'sshKey' ||
            item.fingerprint !== sshFingerprint(blob) ||
            item.publicKey !== `${parsePublicKey(blob).algorithm} ${blob.toString('base64')}`
          )
            throw sshFailure()
          identities.push({ item, blob, source: 'external' })
        }
        return identities
      } finally {
        response?.fill(0)
        connection.close()
      }
    },
    async sign(blob, data, flags, signal, bindings) {
      const connection = await deps.open(signal)
      let response: Buffer | undefined
      try {
        for (const binding of bindings) {
          const result = await connection.request(binding)
          try {
            if (parseSshResponse(result).kind !== 'success') throw sshFailure()
          } finally {
            result.fill(0)
          }
        }
        response = await connection.request(
          sshFrame(SSH.sign, Buffer.concat([sshString(blob), sshString(data), uint32(flags)])),
        )
        const parsed = parseSshResponse(response)
        if (parsed.kind !== 'signature') throw sshFailure()
        const signature = parsed.signature
        if (!isSshSignatureValid(blob, data, signature, validateSignFlags(blob, flags)))
          throw sshFailure()
        const owned = Buffer.alloc(signature.length)
        signature.copy(owned)
        return owned
      } finally {
        response?.fill(0)
        connection.close()
      }
    },
  }
}
