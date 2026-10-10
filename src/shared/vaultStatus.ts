// The vault's status and pushed events: the value-free part of the broker
// protocol that panels read. Kept apart from vaultProtocol.ts so a webview
// (the Models & Agents panel's vault slice) does not carry the request and
// private-frame schemas (D6 budgets).
import * as z from 'zod/mini'
import { VAULT_LIMITS, VAULT_PROTOCOL_VERSION } from './constants'
import { vaultApprovalRequestSchema } from './vault'

/** The wire's shared primitives; vaultProtocol.ts reuses them. */
export const vaultWireId = z.string().check(z.regex(/^[a-f0-9]{32}$/u))
export const vaultWireText = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]*$/u))
export const vaultWireCounter = z.number().check(z.int(), z.nonnegative())
const id = vaultWireId
const text = vaultWireText
const counter = vaultWireCounter

export const vaultStatusSchema = z.strictObject({
  // v2: `uncreated` until Set Up Vault; `setupPending` while the one-time
  // recovery code waits for "I Saved It" (nothing is written before that).
  state: z.enum([
    'uncreated',
    'setupPending',
    'locked',
    'unlocked',
    'unavailable',
    'firstPartyOnly',
  ]),
  lockEpoch: counter,
  tier: z.nullable(
    z.enum(['hardware', 'presence', 'osStore', 'secretStorage', 'passphrase', 'recovery']),
  ),
  provider: z.nullable(text),
  silentUnlock: z.boolean(),
  itemCount: counter,
  reason: z.nullable(
    z.enum([
      'brokerBlocked',
      'slotUnavailable',
      'basicText',
      'rollback',
      'auditInvalid',
      'locked',
      // The anchored vault can no longer be opened by any slot or code; only
      // then is Reset Vault offered (lead decision, 2026-10-10).
      'vaultLost',
    ]),
  ),
})
export type VaultStatus = z.infer<typeof vaultStatusSchema>

export const vaultBrokerEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('locked'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    lockEpoch: counter,
  }),
  z.strictObject({
    kind: z.literal('revoked'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    requesterId: id,
    grantId: z.nullable(id),
  }),
  z.strictObject({
    kind: z.literal('approval'),
    v: z.literal(VAULT_PROTOCOL_VERSION),
    request: vaultApprovalRequestSchema,
  }),
  // v2: an item, grant, slot or setup change committed by any window or the CLI.
  z.strictObject({ kind: z.literal('changed'), v: z.literal(VAULT_PROTOCOL_VERSION) }),
])
export type VaultBrokerEvent = z.infer<typeof vaultBrokerEventSchema>
