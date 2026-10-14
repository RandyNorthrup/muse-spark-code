import { type Socket } from 'node:net'
import * as z from 'zod/mini'
import { VAULT_PROTOCOL_VERSION } from '../../../shared/constants'
import {
  vaultBrokerRequestSchema,
  vaultBrokerResponseSchema,
  vaultPrivateReadSchema,
  vaultPrivateMaterialSchema,
} from '../../../shared/vaultProtocol'

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
export interface VaultSecuredListenerPort {
  /** P creates an owner-only, remote-refusing pipe before handing over any accepted socket. */
  listen(path: string, accepted: (socket: Socket) => void): Promise<() => Promise<void>>
}
