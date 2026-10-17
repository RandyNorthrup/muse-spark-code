import { type VaultBroker } from '../broker/broker'
import { type VaultUseLifetime } from '../broker/ports'
import { type VaultItem } from '../../../shared/vault'
import { UI_TEXT, VAULT_TOTP_DIGITS } from '../../../shared/constants'
import { type VaultExecEnvelope } from './schema'
import { type VaultExecLease } from './feeder'

export interface VaultExecBrokerLeaseDeps {
  readonly broker: Pick<VaultBroker, 'redeem' | 'withApprovedMaterial' | 'finish'>
  /** B pins this from its authenticated connection, never the envelope. */
  readonly requesterId: string
  readonly lifetime: (
    approval: VaultExecEnvelope['approvals'][number],
  ) => VaultUseLifetime & { readonly revoked: AbortSignal }
  /** L computes in the broker; only the current code is returned to X. */
  readonly oneTimeCode: (item: VaultItem) => Promise<Uint8Array>
}

function owned(bytes: Uint8Array): Buffer {
  const copy = Buffer.alloc(bytes.length)
  copy.set(bytes)
  return copy
}

/** Called only by B's private performer in the broker process, never by an agent tool. */
export async function redeemVaultExecLease(
  deps: VaultExecBrokerLeaseDeps,
  approval: VaultExecEnvelope['approvals'][number],
  signal: AbortSignal,
): Promise<VaultExecLease> {
  const { ticket, use } = approval
  const lifetime = deps.lifetime(approval)
  const bytes: { value?: Buffer; username: Buffer | null } = { username: null }
  const erase = () => {
    bytes.value?.fill(0)
    bytes.username?.fill(0)
  }
  const abort = () => {
    erase()
    lifetime.close()
  }
  signal.addEventListener('abort', abort, { once: true })
  lifetime.revoked.addEventListener('abort', erase, { once: true })
  let expiresAt = ticket.expiresAt
  try {
    signal.throwIfAborted()
    const result = await deps.broker.redeem(deps.requesterId, ticket, use, lifetime)
    signal.throwIfAborted()
    if (result.kind !== 'ticket') throw new Error(UI_TEXT.vault.noAccess)
    await deps.broker.withApprovedMaterial(ticket.id, deps.requesterId, use, async (item) => {
      signal.throwIfAborted()
      lifetime.revoked.throwIfAborted()
      const material = item.material
      if (use.kind === 'totp') {
        const code = await deps.oneTimeCode(item)
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(code)
          if (
            (text.length !== VAULT_TOTP_DIGITS.standard &&
              text.length !== VAULT_TOTP_DIGITS.extended) ||
            !/^\d+$/u.test(text)
          )
            throw new Error(UI_TEXT.vault.noAccess)
          bytes.value = owned(code)
        } finally {
          code.fill(0)
        }
      } else if (['environment', 'stdin', 'git', 'sudo', 'askpass'].includes(use.kind)) {
        switch (material.kind) {
          case 'secret':
          case 'apiKey': {
            bytes.value = owned(material.value)
            break
          }
          case 'oauth': {
            bytes.value = owned(material.accessToken)
            expiresAt = Math.min(expiresAt, material.expiresAt)
            break
          }
          case 'password': {
            bytes.value = owned(material.password)
            bytes.username =
              use.kind === 'git' && material.username ? owned(material.username) : null
            break
          }
          default: {
            throw new Error(UI_TEXT.vault.noAccess)
          }
        }
      } else throw new Error(UI_TEXT.vault.noAccess)
      if (item.metadata.dates.expiresAt !== null)
        expiresAt = Math.min(expiresAt, item.metadata.dates.expiresAt)
      signal.throwIfAborted()
      lifetime.revoked.throwIfAborted()
    })
    signal.throwIfAborted()
    lifetime.revoked.throwIfAborted()
    if (!bytes.value) throw new Error(UI_TEXT.vault.noAccess)
    const released = bytes.value
    const user = bytes.username
    let isClosed = false
    return {
      value: released,
      username: user,
      expiresAt,
      revoked: lifetime.revoked,
      close: async (succeeded) => {
        released.fill(0)
        user?.fill(0)
        if (isClosed) return
        isClosed = true
        signal.removeEventListener('abort', abort)
        lifetime.revoked.removeEventListener('abort', erase)
        try {
          await deps.broker.finish(ticket.id, succeeded)
        } finally {
          lifetime.close()
        }
      },
    }
  } catch {
    bytes.value?.fill(0)
    bytes.username?.fill(0)
    signal.removeEventListener('abort', abort)
    lifetime.revoked.removeEventListener('abort', erase)
    try {
      await deps.broker.finish(ticket.id, false)
    } finally {
      lifetime.close()
    }
    throw new Error(UI_TEXT.vault.noAccess)
  }
}
