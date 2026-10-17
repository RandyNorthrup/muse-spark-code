import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  UI_TEXT,
  VAULT_LIMITS,
  VAULT_PROTOCOL_VERSION,
  VAULT_TOTP_DIGITS,
} from '../../shared/constants'
import {
  vaultRequesterSchema,
  vaultUseSchema,
  type VaultApprovalRequest,
  type VaultTicket,
  type VaultUse,
} from '../../shared/vault'
import {
  vaultRemoteRequestSchema,
  vaultAuthorizationResultSchema,
  vaultApprovalResultSchema,
  vaultUseProposalSchema,
  type VaultAuthenticatedPeer,
} from '../../shared/vaultProtocol'
import { type VaultBroker } from './broker/broker'
import { vaultUseDigest } from './useDigest'
import { awaitVaultApproval } from './fleet'

type RemoteRequest = ReturnType<typeof vaultRemoteRequestSchema.parse>
const id = vaultRemoteRequestSchema.shape.id
const digest = z.string().check(z.regex(/^[a-f0-9]{64}$/u))
const code = z
  .string()
  .check(
    z.refine(
      (value) =>
        Array.of<number>(VAULT_TOTP_DIGITS.standard, VAULT_TOTP_DIGITS.extended).includes(
          value.length,
        ) && /^\d+$/u.test(value),
    ),
  )
/** The paired channel carries only the resulting capability. Never a ticket, item, grant or approval. */
export const vaultRemoteResponseSchema = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  id,
  result: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('signature'),
      signature: z
        .string()
        .check(
          z.minLength(1),
          z.maxLength(VAULT_LIMITS.frameBytes),
          z.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
        ),
    }),
    z.strictObject({ kind: z.literal('code'), code }),
    z.strictObject({ kind: z.literal('denied') }),
  ]),
})
type Response = ReturnType<typeof vaultRemoteResponseSchema.parse>
const identitySchema = z
  .strictObject({
    pinnedMutualTls: z.literal(true),
    deviceId: id,
    owningDeviceId: id,
    requester: vaultRequesterSchema,
  })
  .check(
    z.refine(
      (value) => value.requester.deviceId === value.deviceId && value.requester.source === 'device',
    ),
  )
type Identity = ReturnType<typeof identitySchema.parse>
export interface VaultRemoteChannelPort {
  /** M100 returns verified pair/lease facts, never facts copied from a request payload. */
  authenticate(): Promise<Identity>
  subscribeClose(listener: () => void): () => void
  /** Synchronous final transport write. The implementation never forwards this to model context. */
  send(response: Response): void
}
export interface VaultRemoteApprovalCard {
  request: VaultApprovalRequest
  remote: RemoteRequest
  digest: string
}
const remoteAnswerSchema = z.strictObject({
  requestId: id,
  digest,
  decision: z.enum(['allowOnce', 'deny']),
})
export interface VaultRemotePorts {
  owningDeviceId: string
  peer: VaultAuthenticatedPeer
  broker: Pick<
    VaultBroker,
    'clock' | 'register' | 'request' | 'answer' | 'endRequester' | 'subscribeInvalidation'
  >
  /** Local selection only. Offers/status never enumerate owner-side items. */
  select(request: RemoteRequest, identity: Identity, signal: AbortSignal): Promise<unknown>
  /** S/L resolve the verified SSH exchange, or the receiver's command-bound code sink.
   * Resolution must prove the exact sessionDigest/origin, not a caller-supplied command. */
  resolve(request: RemoteRequest, identity: Identity, signal: AbortSignal): Promise<VaultUse>
  /** Authenticated owner-side UI, with both remote origin/session and broker's exact use shown. */
  approve(card: VaultRemoteApprovalCard, signal: AbortSignal): Promise<unknown>
  /** Runs IN the broker. Redeems the ticket against current policy and returns only signature/code bytes.
   * It keeps the admission alive through canRelease, never returns an item or seed. */
  execute(
    ticket: VaultTicket,
    use: VaultUse,
    request: RemoteRequest,
    signal: AbortSignal,
    canRelease: () => boolean,
  ): Promise<Uint8Array>
}
const ownerChannelSchema = z.strictObject({ pinnedMutualTls: z.literal(true), owningDeviceId: id })
export interface VaultRemoteConsumerPorts {
  /** Trusted M100 receiver/lease facts; request frames cannot clear unattended marking. */
  requester: Identity['requester']
  authenticate(): Promise<ReturnType<typeof ownerChannelSchema.parse>>
  subscribeClose(listener: () => void): () => void
  exchange(request: RemoteRequest, signal: AbortSignal): Promise<unknown>
  /** S/X/L consume in the pinned SSH exchange, private stdin or fill only, never a model/tool result.
   * They call canDeliver at the physical delivery and retain no byte reference afterwards. */
  deliver(
    kind: 'ssh' | 'totp',
    bytes: Uint8Array,
    request: RemoteRequest,
    canDeliver: () => boolean,
  ): Promise<void>
}

/** Receiver-side boundary: validate the bound reply, deliver privately, return only success. */
export async function hasConsumedVaultRemoteUse(
  input: unknown,
  ports: VaultRemoteConsumerPorts,
  signal: AbortSignal,
): Promise<boolean> {
  const remote = vaultRemoteRequestSchema.parse(input)
  const requester = vaultRequesterSchema.parse(ports.requester)
  if (requester.unattended || signal.aborted) return false
  const controller = new AbortController()
  const canDeliver = (): boolean => !controller.signal.aborted
  const abort = (): void => {
    controller.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  let unsubscribe: (() => void) | undefined
  let bytes: Buffer | undefined
  try {
    unsubscribe = ports.subscribeClose(abort)
    const channel = ownerChannelSchema.parse(await ports.authenticate())
    if (channel.owningDeviceId !== remote.owningDeviceId || !canDeliver()) return false
    const response = vaultRemoteResponseSchema.parse(
      await ports.exchange(structuredClone(remote), controller.signal),
    )
    if (
      response.id !== remote.id ||
      response.result.kind === 'denied' ||
      !canDeliver() ||
      (remote.use.kind === 'ssh') !== (response.result.kind === 'signature')
    )
      return false
    const result = response.result
    const decoded =
      result.kind === 'signature'
        ? Buffer.from(result.signature, 'base64')
        : Buffer.from(result.code, 'utf8')
    try {
      if (
        decoded.byteLength === 0 ||
        decoded.byteLength > VAULT_LIMITS.valueBytes ||
        (result.kind === 'signature' && decoded.toString('base64') !== result.signature)
      )
        return false
      bytes = Buffer.alloc(decoded.byteLength)
      bytes.set(decoded)
    } finally {
      decoded.fill(0)
    }
    if (!canDeliver()) return false
    await ports.deliver(remote.use.kind, bytes, structuredClone(remote), canDeliver)
    return canDeliver()
  } catch {
    return false
  } finally {
    bytes?.fill(0)
    controller.abort()
    signal.removeEventListener('abort', abort)
    unsubscribe?.()
  }
}
interface Operation {
  requester: Identity['requester'] | null
  controller: AbortController
  generation: number
}
function approvalDigest(request: VaultApprovalRequest, remote: RemoteRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([request.id, request.digest, remote]))
    .digest('hex')
}

/** Owner-side remote uses: no automatic consent, no unattended caller, no transferable approval. */
export class VaultRemoteOwner {
  private readonly operations = new Set<Operation>()
  private readonly seen = new Set<string>()
  private generation = 0
  private disposed = false
  private readonly unsubscribe: () => void
  constructor(private readonly ports: VaultRemotePorts) {
    id.parse(ports.owningDeviceId)
    this.unsubscribe = ports.broker.subscribeInvalidation((requesterId) => {
      if (requesterId === null) this.generation += 1
      for (const operation of this.operations)
        if (requesterId === null || operation.requester?.id === requesterId)
          operation.controller.abort()
    })
  }
  private current(operation: Operation): boolean {
    return (
      !this.disposed &&
      !operation.controller.signal.aborted &&
      operation.generation === this.generation
    )
  }
  async serve(channel: VaultRemoteChannelPort, input: unknown): Promise<void> {
    // Strict parse precedes authentication, selection or broker effects; no invalid input is echoed.
    const parsed = vaultRemoteRequestSchema.safeParse(input)
    if (!parsed.success || this.disposed) throw new Error(UI_TEXT.vault.noAccess)
    const remote = parsed.data
    const operation: Operation = {
      requester: null,
      controller: new AbortController(),
      generation: this.generation,
    }
    this.operations.add(operation)
    const signal = operation.controller.signal
    let unsubscribe: (() => void) | undefined
    let bytes: Uint8Array | undefined
    let encoded: Buffer | undefined
    let hasSent = false
    try {
      unsubscribe = channel.subscribeClose(() => {
        operation.controller.abort()
      })
      const identity = identitySchema.parse(await channel.authenticate())
      if (
        !this.current(operation) ||
        identity.owningDeviceId !== this.ports.owningDeviceId ||
        remote.owningDeviceId !== this.ports.owningDeviceId ||
        identity.requester.hostId !== this.ports.peer.hostId ||
        identity.requester.unattended ||
        !this.ports.peer.ui
      )
        throw new Error(UI_TEXT.vault.noAccess)
      const replay = JSON.stringify([identity.deviceId, remote.id])
      if (this.seen.has(replay) || this.seen.size >= VAULT_LIMITS.items)
        throw new Error(UI_TEXT.vault.noAccess)
      this.seen.add(replay)
      const requester = vaultRequesterSchema.parse({
        ...identity.requester,
        id: randomBytes(VAULT_LIMITS.idBytes).toString('hex'),
      })
      operation.requester = requester
      const handle = vaultUseProposalSchema.shape.handle.parse(
        await this.ports.select(structuredClone(remote), structuredClone(identity), signal),
      )
      if (!this.current(operation)) throw new Error(UI_TEXT.vault.noAccess)
      const use = vaultUseSchema.parse(
        await this.ports.resolve(structuredClone(remote), structuredClone(identity), signal),
      )
      if (remote.use.kind === 'ssh') {
        if (
          use.kind !== 'ssh' ||
          use.host !== remote.use.host ||
          use.hostKeyFingerprint !== remote.use.hostKeyFingerprint ||
          use.remoteUser !== remote.use.remoteUser ||
          use.forwarding ||
          use.sessionId === null
        )
          throw new Error(UI_TEXT.vault.useChanged)
        const session = Buffer.from(use.sessionId, 'base64')
        try {
          if (createHash('sha256').update(session).digest('hex') !== remote.use.sessionDigest)
            throw new Error(UI_TEXT.vault.useChanged)
        } finally {
          session.fill(0)
        }
      } else if (use.kind !== 'totp') throw new Error(UI_TEXT.vault.useChanged)
      if (!this.current(operation)) throw new Error(UI_TEXT.vault.noAccess)
      await this.ports.broker.register(this.ports.peer, structuredClone(requester), [handle])
      if (!this.current(operation)) throw new Error(UI_TEXT.vault.noAccess)
      const authorization = vaultAuthorizationResultSchema.parse(
        await this.ports.broker.request(structuredClone(requester), handle, structuredClone(use), {
          tainted: true,
          reasons: [{ source: 'device', label: UI_TEXT.vault.remoteWarning }],
        }),
      )
      // An automatic ticket is a protocol violation here, even if the item's mode is Always.
      if (!this.current(operation) || authorization.kind !== 'approval')
        throw new Error(UI_TEXT.vault.noAccess)
      const request = authorization.request
      if (
        request.requester.id !== requester.id ||
        request.requester.deviceId !== identity.deviceId ||
        request.item.handle !== handle ||
        request.digest !== vaultUseDigest(use)
      )
        throw new Error(UI_TEXT.vault.useChanged)
      const card = { request, remote, digest: approvalDigest(request, remote) }
      const answer = remoteAnswerSchema.parse(
        await awaitVaultApproval(this.ports.approve(structuredClone(card), signal), signal),
      )
      if (
        !this.current(operation) ||
        answer.requestId !== request.id ||
        answer.digest !== card.digest ||
        this.ports.broker.clock.now() >= request.expiresAt
      )
        throw new Error(UI_TEXT.vault.approvalExpired)
      const result = vaultApprovalResultSchema.parse(
        await this.ports.broker.answer(this.ports.peer, {
          requestId: request.id,
          digest: request.digest,
          decision: answer.decision,
        }),
      )
      if (answer.decision !== 'allowOnce' || !this.current(operation) || result.kind !== 'ticket')
        throw new Error(UI_TEXT.vault.noAccess)
      const ticket = result.ticket
      const canRelease = (): boolean =>
        this.current(operation) &&
        ticket.requesterId === requester.id &&
        ticket.requestId === request.id &&
        ticket.itemId === request.item.id &&
        ticket.digest === request.digest &&
        this.ports.broker.clock.now() < ticket.expiresAt
      if (!canRelease()) throw new Error(UI_TEXT.vault.noAccess)
      bytes = await this.ports.execute(
        structuredClone(ticket),
        structuredClone(use),
        structuredClone(remote),
        signal,
        canRelease,
      )
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength === 0 ||
        bytes.byteLength > VAULT_LIMITS.valueBytes ||
        !canRelease()
      )
        throw new Error(UI_TEXT.vault.noAccess)
      encoded = Buffer.alloc(bytes.byteLength)
      encoded.set(bytes)
      const response = vaultRemoteResponseSchema.parse({
        v: VAULT_PROTOCOL_VERSION,
        id: remote.id,
        result:
          remote.use.kind === 'ssh'
            ? { kind: 'signature', signature: encoded.toString('base64') }
            : { kind: 'code', code: encoded.toString('utf8') },
      })
      if (canRelease()) {
        hasSent = true
        channel.send(response)
      } else throw new Error(UI_TEXT.vault.noAccess)
    } catch {
      if (hasSent) throw new Error(UI_TEXT.vault.noAccess)
      if (this.current(operation)) {
        try {
          channel.send({ v: VAULT_PROTOCOL_VERSION, id: remote.id, result: { kind: 'denied' } })
        } catch {
          throw new Error(UI_TEXT.vault.noAccess)
        }
      }
    } finally {
      // Wipe before fallible channel/registration cleanup; stale effects own only their bytes.
      bytes?.fill(0)
      encoded?.fill(0)
      operation.controller.abort()
      this.operations.delete(operation)
      try {
        unsubscribe?.()
      } finally {
        if (operation.requester) await this.ports.broker.endRequester(operation.requester.id)
      }
    }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    for (const operation of this.operations) operation.controller.abort()
    let hasCleanupFailed: boolean
    try {
      this.unsubscribe()
    } finally {
      const results = await Promise.allSettled(
        Array.from(this.operations, (operation) =>
          operation.requester
            ? this.ports.broker.endRequester(operation.requester.id)
            : Promise.resolve(),
        ),
      )
      hasCleanupFailed = results.some((result) => result.status === 'rejected')
    }
    if (hasCleanupFailed) throw new Error(UI_TEXT.vault.noAccess)
  }
}
