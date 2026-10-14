import { chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  VAULT_PROTOCOL_VERSION,
  VAULT_APPROVAL_TTL_MS,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  vaultBrokerRequestSchema,
  vaultBrokerResponseSchema,
  vaultPrivateReadSchema,
  vaultPrivateMaterialSchema,
  type VaultBrokerRequest,
  type VaultBrokerResponse,
} from '../../../shared/vaultProtocol'
import {
  type VaultRequester,
  type VaultUse,
  type VaultTaint,
  type VaultAuditRecord,
} from '../../../shared/vault'
import { vaultPrivateDirectory } from './files'
import pathModule from 'node:path'
import { type VaultBroker } from './broker'
import { isVaultBootTokenMatch } from './broker'
import { type VaultUseLifetime, type VaultConnectionIdentity } from './ports'
import { type RegistrationToken, type ConnectionToken } from './state'
import { type VaultCeiling } from './policy'
import { type VaultPeerVerifier, type VaultProcessIdentity } from './peer'

const privateEnvelope = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  sequence: z.number().check(z.int(), z.nonnegative()),
  request: vaultPrivateReadSchema,
})
export const vaultChannelRequestSchema = z.union([vaultBrokerRequestSchema, privateEnvelope])
export const vaultChannelResponseSchema = z.union([
  vaultBrokerResponseSchema,
  z.strictObject({
    v: z.literal(VAULT_PROTOCOL_VERSION),
    sequence: z.number().check(z.int(), z.nonnegative()),
    response: vaultPrivateMaterialSchema,
  }),
])
export type VaultChannelResponse = z.infer<typeof vaultChannelResponseSchema>
export type { VaultConnectionIdentity } from './ports'
export interface VaultSecuredListenerPort {
  /** P creates an owner-only, remote-refusing pipe before handing over any accepted socket. */
  listen(path: string, accepted: (socket: Socket) => void): Promise<() => Promise<void>>
}
export interface VaultChannelDeps {
  listener?: VaultSecuredListenerPort
  /** T's trusted provenance, including Muse Code's sticky session taint; frame claims cannot clear it. */
  taint(requester: VaultRequester): Promise<VaultTaint>
  broker: VaultBroker
  peers: VaultPeerVerifier
  bootToken: string
  brokerId: string
  /** Compare OS pid/start/image to the host launch registry, and bind the channel. */
  identify(
    identity: VaultProcessIdentity,
    hostId: string,
    hostSession: string,
  ): Promise<VaultConnectionIdentity>
  ceiling(requester: VaultRequester): VaultCeiling
  /** S/X/L/O dispatch only here after redemption. This never returns values on a public frame. */
  lifetime(requester: VaultRequester, socket: Socket): VaultUseLifetime
  perform(requester: VaultRequester, ticketId: string, use: VaultUse, socket: Socket): Promise<void>
  scrub(text: string): Promise<string>
}
/** NDJSON with a byte limit and validation before dispatch; one sequential stream per pinned peer. */
export class VaultChannelServer {
  private server: Server | null = null
  private isClosed = false
  private securedClose: (() => Promise<void>) | null = null
  private readonly sockets = new Set<Socket>()
  private readonly identities = new Map<
    Socket,
    { identity: VaultConnectionIdentity; token?: RegistrationToken }
  >()
  private readonly unsubscribe: () => void
  constructor(private readonly deps: VaultChannelDeps) {
    this.unsubscribe = deps.broker.subscribeInvalidation((requesterId, token) => {
      for (const [socket, held] of this.identities) {
        const identity = held.identity
        if (
          identity.requester &&
          (requesterId === null ||
            (identity.requester.id === requesterId && (!token || held.token === token)))
        )
          socket.destroy()
      }
    })
  }
  private async dispatch(
    identity: VaultConnectionIdentity,
    request: VaultBrokerRequest['request'],
    socket: Socket,
    token: RegistrationToken | undefined,
    connection: ConnectionToken,
  ): Promise<VaultBrokerResponse['response']> {
    const broker = this.deps.broker
    const requester = identity.requester
    const denied = { kind: 'denied', reason: 'peer' } as const
    switch (request.kind) {
      case 'hello': {
        return denied
      }
      case 'status': {
        return { kind: 'status', status: await broker.status() }
      }
      case 'lock': {
        if (!identity.manage) return denied
        await broker.lock()
        return { kind: 'ok' }
      }
      case 'unlock': {
        if (!identity.manage) return denied
        await broker.unlock(request.slotId)
        return { kind: 'ok' }
      }
      case 'registerRequester': {
        if (requester || !identity.manage) return denied
        // A host conversation takes its own incarnation-bound connection.
        if (request.requester.peerProcessId === identity.peer.processId) {
          const bound = await broker.registerOnConnection(
            identity.peer,
            request.requester,
            this.deps.ceiling(request.requester),
            connection,
          )
          identity.requester = structuredClone(request.requester)
          identity.firstParty = false
          identity.manage = false
          this.identities.set(socket, { identity, token: bound })
        } else
          await broker.register(
            identity.peer,
            request.requester,
            this.deps.ceiling(request.requester),
          )
        return { kind: 'ok' }
      }
      case 'endRequester': {
        if (!identity.manage && requester?.id !== request.requesterId) return denied
        await broker.endRequester(request.requesterId, null, identity.manage ? undefined : token)
        return { kind: 'ok' }
      }
      case 'list': {
        return requester
          ? { kind: 'items', items: [...(await broker.list(requester, token))] }
          : denied
      }
      case 'requestUse': {
        if (!requester) return denied
        const taint = await this.deps.taint(requester)
        // Cancellation closes this incarnation's socket, including while provenance is loading.
        if (socket.destroyed) return denied
        const result = await broker.request(
          requester,
          request.proposal.handle,
          request.proposal.use,
          taint,
          token,
        )
        return socket.writable ? result : denied
      }
      case 'answer': {
        return identity.peer.ui && identity.manage
          ? await broker.answer(identity.peer, request.answer)
          : denied
      }
      case 'grant': {
        if (!identity.manage) return denied
        await broker.grant(identity.peer, request.grant)
        return { kind: 'ok' }
      }
      case 'revoke': {
        if (!identity.manage) return denied
        await broker.revoke(identity.peer, request.grantId)
        return { kind: 'ok' }
      }
      case 'audit': {
        if (!identity.manage) return denied
        const records: VaultAuditRecord[] = []
        let bytes = Buffer.byteLength(
          JSON.stringify({
            v: VAULT_PROTOCOL_VERSION,
            sequence: Number.MAX_SAFE_INTEGER,
            response: { kind: 'audit', records },
          }),
        )
        const available = await broker.readAudit(identity.peer, connection)
        for (const record of available) {
          if (
            record.generation <= request.afterGeneration ||
            (request.item !== null && record.handle !== request.item) ||
            (request.requesterId !== null && record.requester.id !== request.requesterId)
          )
            continue
          const size = Buffer.byteLength(JSON.stringify(record)) + (records.length === 0 ? 0 : 1)
          if (records.length >= VAULT_LIMITS.items || bytes + size > VAULT_LIMITS.frameBytes) break
          bytes += size
          records.push(record)
        }
        return { kind: 'audit', records }
      }
      case 'scrub': {
        return identity.manage
          ? { kind: 'scrubbed', text: await this.deps.scrub(request.text) }
          : denied
      }
      case 'redeem': {
        if (!requester) return denied
        const result = await broker.redeem(
          requester.id,
          request.ticket,
          request.use,
          this.deps.lifetime(requester, socket),
          token,
        )
        if (result.kind === 'ticket')
          await this.deps.perform(requester, result.ticket.id, request.use, socket)
        return result
      }
    }
  }
  async listen(path: string): Promise<void> {
    if (this.isClosed || this.server || this.securedClose) throw new Error(UI_TEXT.vault.noAccess)
    if (this.deps.listener) {
      this.securedClose = await this.deps.listener.listen(path, (socket) => {
        this.accept(socket)
      })
      return
    }
    if (process.platform === 'win32') throw new Error(UI_TEXT.vault.noAccess)
    await vaultPrivateDirectory(pathModule.dirname(path))
    const server = createServer((socket) => {
      this.accept(socket)
    })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    await chmod(path, constants.S_IRUSR | constants.S_IWUSR)
  }
  /** P's Windows named-pipe adapter may deliver an already accepted secured socket. */
  accept(socket: Socket): void {
    if (this.isClosed) {
      socket.destroy()
      return
    }
    const connection = this.deps.broker.beginConnection()
    let token: RegistrationToken | undefined
    this.sockets.add(socket)
    socket.pause()
    const cancellation = new AbortController()
    let identity: VaultConnectionIdentity | null = null
    let sequence = 0
    let buffer = Buffer.alloc(0)
    let queuedBytes = 0
    let tail: Promise<unknown> = Promise.resolve()
    const timeout = setTimeout(() => socket.destroy(), VAULT_APPROVAL_TTL_MS)
    const close = (): void => {
      try {
        clearTimeout(timeout)
        cancellation.abort()
        socket.destroy()
      } finally {
        buffer.fill(0)
        buffer = Buffer.alloc(0)
      }
    }
    const write = async (frame: unknown): Promise<void> => {
      const parsed = vaultChannelResponseSchema.parse(frame)
      const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`)
      try {
        if (bytes.byteLength > VAULT_LIMITS.frameBytes) throw new Error(UI_TEXT.vault.noAccess)
        await new Promise<void>((resolve, reject) =>
          socket.write(bytes, (error) => {
            if (error) reject(error)
            else resolve()
          }),
        )
      } finally {
        bytes.fill(0)
      }
    }
    const authorize = async (
      message: z.infer<typeof vaultChannelRequestSchema>,
      peer: VaultProcessIdentity,
    ): Promise<void> => {
      if (message.sequence !== sequence) {
        close()
        return
      }
      sequence += 1
      const request = message.request
      if (request.kind === 'hello') {
        if (
          identity ||
          message.sequence !== 0 ||
          !isVaultBootTokenMatch(this.deps.bootToken, request.bootToken)
        ) {
          close()
          return
        }
        const authenticated = await this.deps.broker.authenticate(connection, () =>
          this.deps.identify(peer, request.hostId, request.hostSession),
        )
        const verified = authenticated.identity
        token = authenticated.token
        if (
          verified.peer.hostId !== request.hostId ||
          verified.peer.processId !== peer.processId ||
          verified.peer.userId !== peer.userId
        ) {
          close()
          return
        }
        identity = structuredClone(verified)
        this.identities.set(socket, { identity, ...(token && { token }) })
        clearTimeout(timeout)
        const status = await this.deps.broker.status()
        await write({
          v: VAULT_PROTOCOL_VERSION,
          sequence: message.sequence,
          response: { kind: 'hello', brokerId: this.deps.brokerId, lockEpoch: status.lockEpoch },
        })
        return
      }
      if (!identity) {
        close()
        return
      }
      let response: VaultChannelResponse['response']
      if (request.kind === 'firstPartyRead') {
        if (!identity.firstParty || identity.requester !== null)
          response = { kind: 'denied', reason: 'peer' }
        else {
          await this.deps.broker.sendFirstParty(
            identity.peer,
            request,
            (material) => {
              const response = vaultPrivateMaterialSchema.parse({
                v: VAULT_PROTOCOL_VERSION,
                kind: 'material',
                requestId: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
                encoding: 'base64',
                bytes: material.toString('base64'),
              })
              const frame = vaultChannelResponseSchema.parse({
                v: VAULT_PROTOCOL_VERSION,
                sequence: message.sequence,
                response,
              })
              const encoded = `${JSON.stringify(frame)}\n`
              if (
                socket.destroyed ||
                !socket.writable ||
                Buffer.byteLength(encoded) > VAULT_LIMITS.frameBytes
              )
                throw new Error(UI_TEXT.vault.noAccess)
              socket.write(encoded)
            },
            cancellation.signal,
            connection,
          )
          return
        }
      } else
        response = await this.dispatch(
          identity,
          request,
          socket,
          this.identities.get(socket)?.token,
          connection,
        )
      await write({ v: VAULT_PROTOCOL_VERSION, sequence: message.sequence, response })
    }
    socket.once('close', () => {
      buffer.fill(0)
      buffer = Buffer.alloc(0)
      cancellation.abort()
      clearTimeout(timeout)
      this.identities.delete(socket)
      this.sockets.delete(socket)
      void this.deps.broker.closeConnection(connection).catch(close)
    })
    socket.on('error', close)
    let authenticatedPeer: VaultProcessIdentity | null = null
    const drain = (): void => {
      const peer = authenticatedPeer
      if (!peer) return
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        const line = buffer.subarray(0, end + 1)
        buffer = buffer.subarray(end + 1)
        let message: z.infer<typeof vaultChannelRequestSchema>
        try {
          message = vaultChannelRequestSchema.parse(JSON.parse(line.toString('utf8')))
        } catch {
          close()
          return /* No frame is decoded before native authentication. */
        } finally {
          line.fill(0)
        }
        const previous = tail
        tail = (async () => {
          try {
            await previous
            queuedBytes -= line.length
            if (!socket.destroyed) await authorize(message, peer)
          } catch {
            close() /* Refuse without returning private diagnostics. */
          }
        })()
        end = buffer.indexOf('\n')
      }
    }
    // Node flushes inherited stdio streams at helper exit. Hold bounded bytes before verify;
    // install this listener first so its resume cannot discard the client's early hello.
    socket.on('data', (bytes: Buffer) => {
      queuedBytes += bytes.length
      if (queuedBytes > VAULT_LIMITS.frameBytes) {
        close()
        return
      }
      const previous = buffer
      try {
        buffer = Buffer.concat([previous, bytes])
      } finally {
        previous.fill(0)
      }
      drain()
    })
    void (async () => {
      try {
        authenticatedPeer = await this.deps.peers.verify(socket)
        drain()
        socket.resume()
      } catch {
        close() /* Native authentication failure closes before any frame is decoded. */
      }
    })()
  }
  async close(): Promise<void> {
    this.isClosed = true
    this.unsubscribe()
    for (const socket of this.sockets) socket.destroy()
    const securedClose = this.securedClose
    this.securedClose = null
    if (securedClose) await securedClose()
    const server = this.server
    this.server = null
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        }),
      )
  }
}
