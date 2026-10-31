import { chmod } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { type Duplex } from 'node:stream'
import { randomBytes } from 'node:crypto'
import type * as z from 'zod/mini'
import {
  VAULT_PROTOCOL_VERSION,
  VAULT_TRANSPORT_TIMEOUT_MS,
  VAULT_LIMITS,
  UI_TEXT,
} from '../../../shared/constants'
import {
  vaultBrokerEventFrameSchema,
  vaultPrivateExecMaterialSchema,
  vaultPrivateExecRefusedSchema,
  vaultPrivateMaterialSchema,
  vaultPrivateRecoveryCodeSchema,
  type VaultBrokerRequest,
  type VaultBrokerResponse,
  type VaultPrivateRequest,
} from '../../../shared/vaultProtocol'
import {
  vaultItemSchema,
  type VaultItem,
  type VaultRequester,
  type VaultTaint,
  type VaultAuditRecord,
} from '../../../shared/vault'
import { decodeVaultMaterial, eraseVaultMaterial, VaultError, VaultWriterError } from '../crypto'
import { vaultPrivateDirectory } from './files'
import pathModule from 'node:path'
import { type VaultBroker } from './broker'
import { isVaultBootTokenMatch } from './broker'
import {
  VaultManagementError,
  VaultStoreUnavailableError,
  type VaultManagementPort,
  type VaultManagementRefusal,
  type VaultSecuredListenerPort,
  type VaultUseLifetime,
  type VaultConnectionIdentity,
} from './ports'
import { type RegistrationToken, type ConnectionToken } from './state'
import { combineVaultTaint } from '../taint'
import { redeemVaultExecLease } from '../exec/brokerLease'
import { type VaultExecLease } from '../exec/feeder'
import { type VaultCeiling } from './policy'
import { type VaultPeerVerifier, type VaultProcessIdentity } from './peer'

import {
  vaultChannelRequestSchema,
  vaultChannelResponseSchema,
  type VaultChannelResponse,
} from './frames'
export type { VaultConnectionIdentity } from './ports'
export interface VaultChannelDeps {
  listener?: VaultSecuredListenerPort
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
  /** D243: the person vault policy's ceiling for this workspace and role. */
  ceiling(requester: VaultRequester): Promise<VaultCeiling>
  /** L computes in the broker; only the current TOTP code reaches a feeder. */
  oneTimeCode(item: VaultItem): Promise<Uint8Array>
  scrub(text: string): Promise<string>
  /** Protocol v2's management side; only manage connections reach it. */
  manage: VaultManagementPort
}
type ManageRequest = Extract<
  VaultBrokerRequest['request'],
  {
    kind:
      | 'snapshot'
      | 'editMetadata'
      | 'remove'
      | 'import'
      | 'publicKey'
      | 'confirmSetup'
      | 'cancelSetup'
      | 'importKeep'
      | 'importDelete'
      | 'resetBegin'
      | 'resetConfirm'
  }
>
/** Store and management failures become a fixed reason, never exception text. */
function refusal(
  error: unknown,
): Extract<VaultBrokerResponse['response'], { kind: 'refused' }> | null {
  let reason: VaultManagementRefusal
  if (error instanceof VaultManagementError) reason = error.reason
  else if (error instanceof VaultStoreUnavailableError) reason = 'storeUnavailable'
  else if (error instanceof VaultError)
    reason = error.code === 'authentication' ? 'invalid' : error.code
  else return null
  return {
    kind: 'refused',
    reason,
    ...(error instanceof VaultWriterError && { writer: error.writer }),
  }
}

type ManagePrivateRequest = Extract<VaultPrivateRequest, { kind: 'add' | 'edit' | 'recover' }>
const MANAGE_PRIVATE_KINDS = new Set<string>(['add', 'edit', 'recover'])
function isManagePrivate(
  request: z.infer<typeof vaultChannelRequestSchema>['request'],
): request is ManagePrivateRequest {
  return MANAGE_PRIVATE_KINDS.has(request.kind)
}
/** A private add/edit frame's item, owned here; the caller erases it. */
function privateItem(request: Extract<VaultPrivateRequest, { kind: 'add' | 'edit' }>) {
  const bytes = Buffer.from(request.material, 'base64')
  try {
    const material = decodeVaultMaterial(bytes)
    const parsed = vaultItemSchema.safeParse({ metadata: request.metadata, material })
    if (!parsed.success) {
      eraseVaultMaterial(material)
      throw new VaultManagementError('invalid')
    }
    return parsed.data
  } finally {
    bytes.fill(0)
  }
}
/** NDJSON with a byte limit and validation before dispatch; one sequential stream per pinned peer. Served by the broker entry. */
export class VaultChannelServer {
  private server: Server | null = null
  private isClosed = false
  private securedClose: (() => Promise<void>) | null = null
  private readonly sockets = new Set<Duplex>()
  private readonly identities = new Map<
    Duplex,
    { identity: VaultConnectionIdentity; token?: RegistrationToken }
  >()
  /** D243 lane T: provenance reported per incarnation-bound connection. */
  private readonly provenance = new Map<Duplex, VaultTaint>()
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
    socket: Duplex,
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
        try {
          await broker.unlock(request.slotId)
        } catch (error: unknown) {
          // A fixed reason (an unusable OS store) reaches the person; anything
          // else still closes the connection without diagnostics.
          const refused = refusal(error)
          if (refused === null) throw error
          return refused
        }
        return { kind: 'ok' }
      }
      case 'registerRequester': {
        if (requester || !identity.manage) return denied
        // A host conversation takes its own incarnation-bound connection.
        if (request.requester.peerProcessId === identity.peer.processId) {
          const bound = await broker.registerOnConnection(
            identity.peer,
            request.requester,
            await this.deps.ceiling(request.requester),
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
            await this.deps.ceiling(request.requester),
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
      case 'reportProvenance': {
        // D243 lane T: only the incarnation-bound connection reports, and a
        // report can only add taint for the rest of the connection's life.
        if (!requester || !token) return denied
        const reported = this.provenance.get(socket)
        this.provenance.set(
          socket,
          reported ? combineVaultTaint([reported, request.taint]) : request.taint,
        )
        return { kind: 'ok' }
      }
      case 'delegate': {
        if (!requester || !token) return denied
        const isDelegated = await broker.delegate(
          request.ticketId,
          request.feeder,
          request.envelopeDigest,
          token,
        )
        return isDelegated ? { kind: 'ok' } : denied
      }
      case 'requestUse': {
        if (!requester) return denied
        // D243: the reported provenance is evaluated, validated against
        // this registration; a proposal may add taint, never clear it. A
        // host that has not reported has no provenance owner: refuse.
        const reported = this.provenance.get(socket)
        if (!reported || !token) return denied
        if (socket.destroyed) return denied
        const result = await broker.request(
          requester,
          request.proposal.handle,
          request.proposal.use,
          combineVaultTaint([reported, request.proposal.taint]),
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
        // D243: material never travels on the requester socket. Exec uses
        // redeem through a delegation on the feeder's own connection
        // (private `execRedeem`); the host's own in-process redemptions
        // keep the broker API's object-identity binding.
        return denied
      }
      case 'snapshot':
      case 'editMetadata':
      case 'remove':
      case 'import':
      case 'publicKey':
      case 'confirmSetup':
      case 'cancelSetup':
      case 'importKeep':
      case 'importDelete':
      case 'resetBegin':
      case 'resetConfirm': {
        return identity.manage ? await this.manageCall(request, socket) : denied
      }
      case 'setup':
      case 'watch': {
        // authorize() answers both: setup's code is a private frame, watch streams events.
        return denied
      }
    }
  }
  private async manageCall(
    request: ManageRequest,
    socket: Duplex,
  ): Promise<VaultBrokerResponse['response']> {
    const manage = this.deps.manage
    // A requester that closed its connection has cancelled: nothing commits.
    const isCurrent = () => !socket.destroyed && socket.writable
    try {
      switch (request.kind) {
        case 'snapshot': {
          return { kind: 'snapshot', snapshot: await manage.snapshot() }
        }
        case 'publicKey': {
          return { kind: 'publicKey', publicKey: await manage.publicKey(request.itemId) }
        }
        case 'editMetadata': {
          await manage.editMetadata(request.metadata)
          break
        }
        case 'remove': {
          await manage.remove(request.itemId)
          break
        }
        case 'import': {
          const report = await manage.importFile(request.path, isCurrent)
          return { kind: 'imported', receipt: report.receipt, items: [...report.items] }
        }
        case 'importKeep': {
          await manage.keepImport(request.receipt)
          break
        }
        case 'importDelete': {
          await manage.deleteImport(request.receipt, isCurrent)
          break
        }
        case 'resetBegin': {
          const challenge = await manage.resetBegin()
          return { kind: 'resetChallenge', ...challenge }
        }
        case 'resetConfirm': {
          await manage.resetConfirm(request.resetId, request.word)
          break
        }
        case 'confirmSetup': {
          await manage.confirmSetup(request.setupId)
          break
        }
        case 'cancelSetup': {
          await manage.cancelSetup(request.setupId)
          break
        }
      }
      return { kind: 'ok' }
    } catch (error: unknown) {
      const refused = refusal(error)
      if (refused === null) throw error
      return refused
    }
  }
  /** Private v2 writes and recovery: manage-only, values never on a public frame. */
  private async managePrivate(
    request: Extract<VaultPrivateRequest, { kind: 'add' | 'edit' | 'recover' }>,
  ): Promise<VaultBrokerResponse['response']> {
    try {
      if (request.kind === 'recover') {
        const code = Buffer.from(request.code, 'ascii')
        try {
          await this.deps.manage.recover(code)
        } finally {
          code.fill(0)
        }
      } else {
        const item = privateItem(request)
        try {
          if (request.kind === 'add') await this.deps.manage.add(item)
          else await this.deps.manage.edit(item)
        } finally {
          eraseVaultMaterial(item.material)
        }
      }
      return { kind: 'ok' }
    } catch (error: unknown) {
      const refused = refusal(error)
      if (refused === null) throw error
      return refused
    }
  }
  /**
  D243 lane X: one feeder frame on a connection that never helloed as a
  host. `peer` is the kernel record of this socket; admission itself is
  the broker state's (delegation + ancestry). Material leaves only on
  this socket, and the lease lives until `execFinish`, a lock or a
  revoke (the lifetime), or the socket's death.
  */
  private async feederFrame(
    request: Extract<VaultPrivateRequest, { kind: 'execRedeem' | 'execFinish' }>,
    peer: VaultProcessIdentity,
    socket: Duplex,
    sequence: number,
    write: (frame: unknown) => Promise<void>,
    leases: Map<string, VaultExecLease>,
    signal: AbortSignal,
  ): Promise<void> {
    if (request.kind === 'execFinish') {
      const lease = leases.get(request.ticketId)
      leases.delete(request.ticketId)
      if (lease) await lease.close(request.succeeded)
      await write({
        v: VAULT_PROTOCOL_VERSION,
        sequence,
        response: { kind: 'ok' },
      })
      return
    }
    const refused = async (): Promise<void> => {
      await write({
        v: VAULT_PROTOCOL_VERSION,
        sequence,
        response: vaultPrivateExecRefusedSchema.parse({
          v: VAULT_PROTOCOL_VERSION,
          kind: 'execRefused',
          ticketId: request.ticket.id,
        }),
      })
    }
    // First increment (D243.1): environment/stdin uses only on this
    // transport; git/askpass/sudo/SSH uses refuse here, before any
    // ticket or delegation is spent.
    if (request.use.kind !== 'environment' && request.use.kind !== 'stdin') {
      await refused()
      return
    }
    if (leases.has(request.ticket.id)) {
      await refused()
      return
    }
    const revoked = new AbortController()
    const lifetime: VaultUseLifetime & { readonly revoked: AbortSignal } = {
      // A broker close (lock, revoke, finish) revokes this lease; the
      // feeder ends its command tree on the revoked signal.
      close: () => {
        revoked.abort()
      },
      // Termination also cuts the connection: a feeder that ignores the
      // revoked signal loses its material source and its leases alike.
      // The broker cannot prove the tree died, so it reports false.
      terminate: () => {
        revoked.abort()
        socket.destroy()
        return Promise.resolve(false)
      },
      revoked: revoked.signal,
    }
    const broker = this.deps.broker
    let lease: VaultExecLease
    try {
      lease = await redeemVaultExecLease(
        {
          broker: {
            redeem: (_requesterId, ticket, use, held) =>
              broker.redeemDelegated(ticket, use, held, peer, request.envelopeDigest),
            withApprovedMaterial: async (ticketId, requesterId, use, run) => {
              await broker.withApprovedMaterial(ticketId, requesterId, use, run)
            },
            finish: async (ticketId, succeeded) => {
              await broker.finish(ticketId, succeeded)
            },
          },
          requesterId: request.ticket.requesterId,
          lifetime: () => lifetime,
          oneTimeCode: async (item) => await this.deps.oneTimeCode(item),
        },
        { ticket: request.ticket, use: request.use },
        signal,
      )
    } catch (error: unknown) {
      // A vault refusal (or the socket's own cancellation) is the named
      // outcome: the feeder gets the fixed refusal. Anything else is a
      // broker fault and keeps propagating to the socket's close path.
      if (error instanceof VaultError) {
        await refused()
        return
      }
      if (signal.aborted) {
        await refused()
        return
      }
      throw error
    }
    leases.set(request.ticket.id, lease)
    try {
      await write({
        v: VAULT_PROTOCOL_VERSION,
        sequence,
        response: vaultPrivateExecMaterialSchema.parse({
          v: VAULT_PROTOCOL_VERSION,
          kind: 'execMaterial',
          ticketId: request.ticket.id,
          encoding: 'base64',
          value: Buffer.from(lease.value).toString('base64'),
          username: lease.username === null ? null : Buffer.from(lease.username).toString('base64'),
          expiresAt: lease.expiresAt,
        }),
      })
    } catch (error: unknown) {
      leases.delete(request.ticket.id)
      await lease.close(false)
      throw error
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
  accept(socket: Duplex): void {
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
    const feederLeases = new Map<string, VaultExecLease>()
    let sequence = 0
    let isWatching = false
    let buffer = Buffer.alloc(0)
    let queuedBytes = 0
    let tail: Promise<unknown> = Promise.resolve()
    const timeout = setTimeout(() => socket.destroy(), VAULT_TRANSPORT_TIMEOUT_MS)
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
      if (!identity && (request.kind === 'execRedeem' || request.kind === 'execFinish')) {
        await this.feederFrame(
          request,
          peer,
          socket,
          message.sequence,
          write,
          feederLeases,
          cancellation.signal,
        )
        return
      }
      if (!identity || isWatching) {
        close()
        return
      }
      let response: VaultChannelResponse['response']
      const denied = { kind: 'denied', reason: 'peer' } as const
      if (isManagePrivate(request)) {
        response = identity.manage ? await this.managePrivate(request) : denied
        await write({ v: VAULT_PROTOCOL_VERSION, sequence: message.sequence, response })
        return
      }
      if (request.kind === 'setup' && identity.manage) {
        let created: { setupId: string; code: Buffer } | undefined
        try {
          created = await this.deps.manage.setup()
        } catch (error: unknown) {
          const refused = refusal(error)
          if (refused === null) throw error
          response = refused
          await write({ v: VAULT_PROTOCOL_VERSION, sequence: message.sequence, response })
          return
        }
        try {
          // Shown once: the code leaves only on this private frame, then is erased.
          await write({
            v: VAULT_PROTOCOL_VERSION,
            sequence: message.sequence,
            response: vaultPrivateRecoveryCodeSchema.parse({
              v: VAULT_PROTOCOL_VERSION,
              kind: 'recoveryCode',
              setupId: created.setupId,
              code: created.code.toString('ascii'),
            }),
          })
        } finally {
          created.code.fill(0)
        }
        return
      }
      if (request.kind === 'watch' && identity.manage) {
        await write({
          v: VAULT_PROTOCOL_VERSION,
          sequence: message.sequence,
          response: { kind: 'ok' },
        })
        isWatching = true
        const unsubscribe = this.deps.manage.subscribe((event) => {
          if (socket.destroyed || !socket.writable) return
          // A wedged watcher must not grow the shared broker's heap without
          // bound: past one frame's worth of queued bytes the watcher is
          // closed and the client starts a fresh watch.
          if (socket.writableLength > VAULT_LIMITS.frameBytes) {
            socket.destroy()
            return
          }
          const frame = vaultBrokerEventFrameSchema.parse({ v: VAULT_PROTOCOL_VERSION, event })
          socket.write(`${JSON.stringify(frame)}\n`)
        })
        socket.once('close', unsubscribe)
        if (socket.destroyed) unsubscribe()
        return
      }
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
      } else if (request.kind === 'execRedeem' || request.kind === 'execFinish')
        // Feeder frames on a host connection: material is never served here.
        response = denied
      else
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
      this.provenance.delete(socket)
      this.sockets.delete(socket)
      // A feeder that vanished mid-use finishes every lease as failed; a
      // finish that fails ends the connection's teardown, as the broker's own
      // close below does (the broker's finish keeps the record).
      for (const lease of feederLeases.values()) void lease.close(false).catch(close)
      feederLeases.clear()
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
          // No frame is decoded before native authentication: the connection
          // closes and the requester reports its own failure.
          close()
          return
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
            // Refuse without returning private diagnostics: the connection
            // closes and the requester reports its own failure.
            close()
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
        // This listener is the chunk's only reader: once copied, it is wiped.
        previous.fill(0)
        bytes.fill(0)
      }
      drain()
    })
    void (async () => {
      try {
        authenticatedPeer = await this.deps.peers.verify(socket)
        drain()
        socket.resume()
      } catch {
        // Native authentication failure closes before any frame is decoded;
        // the requester reports its own failure.
        close()
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
