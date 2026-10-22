// Explicit Devices actions only. U supplies QR rendering from publicText;
// I binds the lazy desktop factory, T binds socket closure, E binds grants.
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceHostMessageSchema,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DeviceWebviewRequest,
} from '../../shared/devicesPanel'
import {
  deviceInvitationSchema,
  type DeviceDispatch,
  type DeviceInvitation,
} from '../../shared/devices'
import {
  DevicePairingError,
  createDeviceInvitation,
  parseDeviceInvitationText,
  confirmDeviceFingerprint,
  validateDevicePair,
} from '../../core/devices/pairing'
import { assertDeviceGrant, deviceGrantSchema, type DeviceGrant } from '../../core/devices/grants'
import {
  type DeviceSecrets,
  assertLocalDeviceHost,
  type DeviceExecutionHost,
} from './deviceSecrets'
import { type DeviceStore, type DeviceStoreState } from './deviceStore'

type Setup = NonNullable<DeviceHostMessage['setup']>
export interface DevicePairingDeps {
  readonly store: DeviceStore
  readonly secrets: DeviceSecrets
  readonly host: DeviceExecutionHost
  readonly now: () => number
  readonly receiverIncarnationId: string
  readonly setup: () => Promise<{
    endpoint: DeviceInvitation['endpoint']
    certificateExpiresAt: number
    listenerApplication: string
    interfaceLabel: string
  }>
  /** Synchronous: close this pair's sockets and block admission before persistence. */
  readonly disconnectPair: (pairId: string) => void
  /** T/E/S handle their actions through real injected ports; P never fakes them. */
  readonly otherAction: (request: DeviceWebviewRequest) => Promise<Setup>
}
export class DevicePairing {
  public static publicText(value: unknown): string {
    const invitation = deviceInvitationSchema.safeParse(value)
    if (!invitation.success) throw new DevicePairingError('invalid-frame')
    return JSON.stringify(invitation.data)
  }
  private readonly revoked = new Set<string>()
  private readonly blocked = new Set<string>()
  // A later Pause survives older mutations clearing their temporary blocks.
  private readonly pauseRequests = new Map<string, { pending: boolean }>()
  private queue = Promise.resolve()
  public constructor(private readonly deps: DevicePairingDeps) {}
  private async perform(request: DeviceWebviewRequest): Promise<Setup> {
    const setup: Setup = { viewId: request.viewId, requestId: request.requestId }
    try {
      assertLocalDeviceHost(this.deps.host)
      const action = request.action
      switch (action.kind) {
        case 'pair': {
          Object.assign(setup, await this.begin())
          break
        }
        case 'importInvitation': {
          setup.invitation = await this.importInvitation(action.text)
          break
        }
        case 'confirmFingerprint': {
          setup.confirmation = await this.confirm(action.invitationId, action.fingerprint)
          break
        }
        case 'importConfirmation': {
          await this.complete(action.confirmation)
          break
        }
        case 'unlink': {
          await this.unlink(action.pairId)
          break
        }
        case 'pauseOffers': {
          await this.pause(action.pairId)
          break
        }
        case 'setAddress': {
          await this.material(action.pairId, undefined, false)
          this.blocked.add(action.pairId)
          this.deps.disconnectPair(action.pairId)
          await this.deps.store.update((state) => {
            const row = this.row(state, action.pairId)
            row.endpoint = action.endpoint
            return state
          })
          this.blocked.delete(action.pairId)
          break
        }
        default: {
          const reply = parseSetup(await this.deps.otherAction(request))
          if (reply.requestId !== request.requestId || reply.viewId !== request.viewId)
            throw new DevicePairingError('invalid-frame')
          return reply
        }
      }
    } catch (error) {
      setup.failure = error instanceof DevicePairingError ? error.reason : 'storage'
    }
    return parseSetup(setup)
  }
  private async begin(): Promise<Partial<Setup>> {
    const state = await this.deps.store.read()
    if (state.pairs.length >= DEVICE_LIMITS.pairedDevices) throw new DevicePairingError('capacity')
    const existing = state.pending[0]
    if (existing !== undefined) {
      if (this.deps.now() >= existing.local.expiresAt) {
        await this.deps.secrets.remove(existing.local.invitationId)
        await this.deps.store.update((current) => {
          current.usedInvitationIds.push(existing.local.invitationId)
          if (existing.peer !== undefined)
            current.usedInvitationIds.push(existing.peer.invitationId)
          current.pending = []
          return current
        })
        return await this.begin()
      }
      parseDeviceInvitationText(DevicePairing.publicText(existing.local), this.deps.now())
      await this.deps.secrets.key(existing.local, this.deps.now())
      return {
        invitation: existing.local,
        listenerApplication: existing.listenerApplication,
        interfaceLabel: existing.interfaceLabel,
        ...(existing.confirmation !== undefined && { confirmation: existing.confirmation }),
      }
    }
    const facts = await this.deps.setup()
    const generated = createDeviceInvitation(
      facts.endpoint,
      state.deviceId,
      this.deps.now(),
      facts.certificateExpiresAt,
    )
    let hasStored = false
    try {
      await this.deps.secrets.save(generated.invitation, generated.privateKeyPem, this.deps.now())
      hasStored = true
      await this.deps.store.update((current) => {
        if (current.pending.length > 0) throw new DevicePairingError('storage')
        current.pending.push({
          local: generated.invitation,
          listenerApplication: facts.listenerApplication,
          interfaceLabel: facts.interfaceLabel,
        })
        return current
      })
    } catch {
      if (hasStored) await this.deps.secrets.remove(generated.invitation.invitationId)
      throw new DevicePairingError('storage')
    } finally {
      generated.privateKeyPem = ''
    }
    return {
      invitation: generated.invitation,
      listenerApplication: facts.listenerApplication,
      interfaceLabel: facts.interfaceLabel,
    }
  }
  private pending(state: DeviceStoreState) {
    const pending = state.pending[0]
    if (pending === undefined) throw new DevicePairingError('unpaired')
    parseDeviceInvitationText(DevicePairing.publicText(pending.local), this.deps.now())
    return pending
  }
  private async importInvitation(text: string): Promise<DeviceInvitation> {
    const peer = parseDeviceInvitationText(text, this.deps.now())
    const state = await this.deps.store.read()
    const pending = this.pending(state)
    if (
      state.usedInvitationIds.includes(peer.invitationId) ||
      peer.deviceId === state.deviceId ||
      peer.invitationId === pending.local.invitationId ||
      peer.fingerprint === pending.local.fingerprint ||
      (pending.peer !== undefined &&
        DevicePairing.publicText(pending.peer) !== DevicePairing.publicText(peer))
    )
      throw new DevicePairingError('unpaired')
    await this.deps.store.update((current) => {
      this.pending(current).peer = peer
      return current
    })
    return peer
  }
  private async confirm(invitationId: string, fingerprint: string) {
    const state = await this.deps.store.read()
    const pending = this.pending(state)
    const peer = pending.peer
    if (peer?.invitationId !== invitationId) throw new DevicePairingError('unpaired')
    const key = await this.deps.secrets.key(pending.local, this.deps.now())
    const confirmation = confirmDeviceFingerprint(
      pending.local,
      peer,
      key,
      fingerprint,
      this.deps.now(),
    )
    await this.deps.store.update((current) => {
      this.pending(current).confirmation = confirmation
      return current
    })
    return confirmation
  }
  private async complete(peerConfirmation: NonNullable<Setup['confirmation']>): Promise<void> {
    const state = await this.deps.store.read()
    const pending = this.pending(state)
    if (pending.peer === undefined || pending.confirmation === undefined)
      throw new DevicePairingError('unpaired')
    const pair = {
      local: pending.local,
      peer: pending.peer,
      localConfirmation: pending.confirmation,
      peerConfirmation,
    }
    const pairId = validateDevicePair(pair, this.deps.now(), true)
    await this.deps.secrets.key(pair.local, this.deps.now())
    await this.deps.store.update((current) => {
      if (
        current.usedInvitationIds.includes(pair.local.invitationId) ||
        current.usedInvitationIds.includes(pair.peer.invitationId) ||
        current.revokedPairIds.includes(pairId)
      )
        throw new DevicePairingError('unpaired')
      current.pairs.push({
        pairId,
        pair,
        endpoint: pair.peer.endpoint,
        completedAt: this.deps.now(),
        paused: true,
        grants: [],
      })
      current.usedInvitationIds.push(pair.local.invitationId, pair.peer.invitationId)
      current.pending = []
      return current
    })
  }
  private row(state: DeviceStoreState, pairId: string) {
    if (this.revoked.has(pairId) || state.revokedPairIds.includes(pairId))
      throw new DevicePairingError('revoked')
    const row = state.pairs.find((candidate) => candidate.pairId === pairId)
    if (row === undefined) throw new DevicePairingError('unpaired')
    return row
  }
  private async pause(pairId: string): Promise<void> {
    await this.deps.store.update((state) => {
      this.row(state, pairId).paused = true
      return state
    })
  }
  private async ordered<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.queue
    const execute = async (): Promise<T> => {
      await previous
      return await work()
    }
    const operation = execute()
    this.queue = settled(operation)
    return await operation
  }
  public async handle(input: unknown): Promise<Setup> {
    const parsed = parseDeviceWebviewRequest(input)
    if (!parsed.ok) throw new DevicePairingError('invalid-frame')
    const request = parsed.message
    try {
      assertLocalDeviceHost(this.deps.host)
      if (request.action.kind === 'pauseOffers') {
        // Pause closes admission before waiting for an earlier queued secret read.
        this.pauseRequests.set(request.action.pairId, { pending: true })
        this.blocked.add(request.action.pairId)
        this.deps.disconnectPair(request.action.pairId)
      }
    } catch (error) {
      return parseSetup({
        viewId: request.viewId,
        requestId: request.requestId,
        failure: error instanceof DevicePairingError ? error.reason : 'storage',
      })
    }
    return await this.ordered(async () => await this.perform(request))
  }
  /** T calls at handshake and per frame; E still checks local trust/consent. */
  public async material(pairId: string, peerPin: string | undefined, requiresOffer = true) {
    assertLocalDeviceHost(this.deps.host)
    const row = this.row(await this.deps.store.read(), pairId)
    validateDevicePair(row.pair, this.deps.now())
    if (
      requiresOffer &&
      (this.blocked.has(pairId) ||
        this.pauseRequests.get(pairId)?.pending === true ||
        row.paused ||
        row.grants.every(
          (grant) => grant.offer.receiverIncarnationId !== this.deps.receiverIncarnationId,
        ))
    )
      throw new DevicePairingError('grant')
    if (peerPin !== undefined && peerPin !== row.pair.peer.fingerprint)
      throw new DevicePairingError('unpaired')
    const key = await this.deps.secrets.key(row.pair.local, this.deps.now())
    // Revocation/pause may have raced the asynchronous secret-store read.
    const current = this.row(await this.deps.store.read(), pairId)
    if (
      current.pair.peer.fingerprint !== row.pair.peer.fingerprint ||
      (requiresOffer &&
        (this.blocked.has(pairId) ||
          this.pauseRequests.get(pairId)?.pending === true ||
          current.paused ||
          current.grants.every(
            (grant) => grant.offer.receiverIncarnationId !== this.deps.receiverIncarnationId,
          )))
    )
      throw new DevicePairingError('grant')
    return {
      row: {
        ...current,
        grants: current.grants.filter(
          (grant) => grant.offer.receiverIncarnationId === this.deps.receiverIncarnationId,
        ),
      },
      key,
    }
  }
  public async grant(candidate: DeviceGrant): Promise<void> {
    const grant = deviceGrantSchema.parse(candidate)
    const pause = this.pauseRequests.get(grant.pairId)
    await this.ordered(async () => {
      assertLocalDeviceHost(this.deps.host)
      const before = this.row(await this.deps.store.read(), grant.pairId)
      const wasBlocked = this.blocked.has(grant.pairId)
      await this.material(grant.pairId, undefined, false)
      await this.deps.store.update((state) => {
        const row = this.row(state, grant.pairId)
        if (
          row.paused !== before.paused ||
          this.blocked.has(grant.pairId) !== wasBlocked ||
          this.pauseRequests.get(grant.pairId) !== pause ||
          JSON.stringify(row.grants) !== JSON.stringify(before.grants) ||
          grant.offer.deviceId !== state.deviceId ||
          grant.offer.receiverIncarnationId !== this.deps.receiverIncarnationId
        )
          throw new DevicePairingError('grant')
        const previous = row.grants.find((item) => item.offer.grantId === grant.offer.grantId)
        if (previous !== undefined && grant.offer.grantRevision <= previous.offer.grantRevision)
          throw new DevicePairingError('grant')
        this.blocked.add(grant.pairId)
        this.deps.disconnectPair(grant.pairId)
        row.grants = [
          ...row.grants.filter(
            (item) =>
              item.offer.repositoryId !== grant.offer.repositoryId &&
              item.offer.grantId !== grant.offer.grantId,
          ),
          grant,
        ]
        row.paused = false
        return state
      })
      this.blocked.delete(grant.pairId)
      if (pause !== undefined) pause.pending = false
    })
  }
  public async authorize(peerPin: string, request: DeviceDispatch) {
    if (request.identity.receiverIncarnationId !== this.deps.receiverIncarnationId)
      throw new DevicePairingError('grant')
    const { row } = await this.material(request.identity.pairId, peerPin)
    return assertDeviceGrant(
      row.grants.find((grant) => grant.offer.grantId === request.grantId),
      request,
    )
  }
  public async unlink(pairId: string): Promise<void> {
    assertLocalDeviceHost(this.deps.host)
    this.revoked.add(pairId)
    this.deps.disconnectPair(pairId)
    const state = await this.deps.store.read()
    const row = state.pairs.find((pair) => pair.pairId === pairId)
    if (row === undefined) {
      const retired = state.revokedKeys.find((key) => key.pairId === pairId)
      if (retired === undefined) throw new DevicePairingError('unpaired')
      await this.deps.secrets.remove(retired.invitationId)
      return
    }
    try {
      await this.deps.store.update((current) => {
        current.pairs = current.pairs.filter((pair) => pair.pairId !== pairId)
        current.revokedPairIds.push(pairId)
        current.revokedKeys.push({ pairId, invitationId: row.pair.local.invitationId })
        return current
      })
    } finally {
      await this.deps.secrets.remove(row.pair.local.invitationId)
    }
  }
}

function parseSetup(candidate: unknown): Setup {
  const setup = deviceHostMessageSchema.shape.setup.safeParse(candidate)
  if (!setup.success || setup.data === undefined) throw new DevicePairingError('invalid-frame')
  return setup.data
}

async function settled(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch {
    return
  }
}
