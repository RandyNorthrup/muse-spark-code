import { type VaultBroker } from '../broker/broker'
import { type RegistrationToken } from '../broker/state'
import {
  type VaultApprovalRequest,
  type VaultRequester,
  type VaultTaint,
  vaultUseSchema,
  vaultTicketSchema,
  vaultRequesterSchema,
} from '../../../shared/vault'
import {
  vaultApprovalResultSchema,
  vaultAuthorizationResultSchema,
  type VaultApprovalResult,
  type VaultAuthorizationResult,
} from '../../../shared/vaultProtocol'
import {
  type SshAccessPort,
  type SshIdentity,
  type SshHardwarePort,
  type SshExternalAgentPort,
} from './ports'
import {
  parsePublicKey,
  signSshData,
  sshFingerprint,
  isSshSignatureValid,
  validateSignFlags,
} from './keys'
import { sshFailure } from './wire'
import { vaultUseDigest } from '../useDigest'

type Broker = Pick<
  VaultBroker,
  'list' | 'request' | 'redeem' | 'withApprovedMaterial' | 'finish' | 'subscribeInvalidation'
>
export interface SshApprovalPort {
  /** Host-owned UI answers through B; on abort it consumes the request with authenticated Deny. */
  wait(request: VaultApprovalRequest, signal: AbortSignal): Promise<VaultApprovalResult>
}
function check(signal: AbortSignal): void {
  if (signal.aborted) throw sshFailure()
}
/** Construct inside the broker process; no private material reaches an extension host. */
export function brokerSshAccess(deps: {
  broker: Broker
  requester: VaultRequester
  registration: RegistrationToken
  taint: () => Promise<VaultTaint>
  approvals: SshApprovalPort
  hardware: SshHardwarePort
  external?: SshExternalAgentPort
}): SshAccessPort {
  const requester = vaultRequesterSchema.parse(deps.requester)
  return {
    async identities(signal) {
      check(signal)
      const items = await deps.broker.list(requester, deps.registration)
      const identities: SshIdentity[] = []
      for (const item of items) {
        if (item.kind !== 'sshKey' || !item.publicKey) continue
        const blob = Buffer.from(item.publicKey.split(' ', 2)[1] ?? '', 'base64')
        parsePublicKey(blob)
        identities.push({ item, blob, source: 'vault' })
      }
      if (deps.external) identities.push(...(await deps.external.identities(signal)))
      check(signal)
      return identities
    },
    async authorize(identity, use, signal) {
      check(signal)
      const resolved = vaultUseSchema.parse(use),
        digest = vaultUseDigest(resolved)
      const taint = await deps.taint()
      check(signal)
      let result: VaultAuthorizationResult = vaultAuthorizationResultSchema.parse(
        await deps.broker.request(
          requester,
          identity.item.handle,
          resolved,
          taint,
          deps.registration,
        ),
      )
      if (result.kind === 'approval')
        result = vaultApprovalResultSchema.parse(await deps.approvals.wait(result.request, signal))
      if (result.kind !== 'ticket') throw sshFailure()
      const ticket = vaultTicketSchema.parse(result.ticket)
      try {
        check(signal)
        // Unproven destinations and forwarding require an explicit, scoped grant from B.
        if (
          resolved.kind === 'ssh' &&
          (resolved.hostKeyFingerprint === null || resolved.forwarding) &&
          result.authority.kind !== 'grant'
        )
          throw sshFailure()
        if (
          ticket.digest !== digest ||
          ticket.requesterId !== requester.id ||
          ticket.itemId !== identity.item.id
        )
          throw sshFailure()
        return ticket
      } catch (error: unknown) {
        await deps.broker.finish(ticket.id, false)
        throw error
      }
    },
    async sign(identity, ticket, use, data, flags, lifetime, signal, release, bindings) {
      check(signal)
      const result = await deps.broker.redeem(
        requester.id,
        ticket,
        use,
        lifetime,
        deps.registration,
      )
      if (result.kind !== 'ticket') throw sshFailure()
      let hasSucceeded = false,
        signature: Buffer | undefined
      try {
        check(signal)
        if (identity.source === 'external') {
          if (!deps.external) throw sshFailure()
          signature = await deps.external.sign(identity.blob, data, flags, signal, bindings)
        } else {
          await deps.broker.withApprovedMaterial(ticket.id, requester.id, use, async (item) => {
            if (
              item.material.kind !== 'sshKey' ||
              item.metadata.fingerprint !== sshFingerprint(identity.blob)
            )
              throw sshFailure()
            if (item.material.storage === 'software')
              signature = signSshData(item.material.privateKey, identity.blob, data, flags)
            else {
              if (flags !== 0 || parsePublicKey(identity.blob).algorithm !== 'ecdsa-sha2-nistp256')
                throw sshFailure()
              signature = await deps.hardware.sign(item.material.keyReference, data, signal)
            }
          })
        }
        check(signal)
        if (
          !signature ||
          !isSshSignatureValid(
            identity.blob,
            data,
            signature,
            validateSignFlags(identity.blob, flags),
          )
        )
          throw sshFailure()
        // The socket owner rechecks generation at its synchronous transport write.
        release(signature)
        hasSucceeded = true
      } finally {
        signature?.fill(0)
        await deps.broker.finish(ticket.id, hasSucceeded)
      }
    },
    subscribeInvalidation(close) {
      return deps.broker.subscribeInvalidation((id, token) => {
        if (
          id === null ||
          (id === requester.id && (token === undefined || token === deps.registration))
        )
          close()
      })
    },
  }
}
