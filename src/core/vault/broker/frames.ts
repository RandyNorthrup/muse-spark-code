// The channel's NDJSON frames, shared by the broker's server (channel.ts) and
// every host's client (client.ts). Kept apart from the server so a host
// bundle carries the frame schemas without the broker engine.

import * as z from 'zod/mini'
import { VAULT_PROTOCOL_VERSION } from '../../../shared/constants'
import {
  vaultBrokerRequestSchema,
  vaultBrokerResponseSchema,
  vaultPrivateRequestSchema,
  vaultPrivateResponseSchema,
} from '../../../shared/vaultProtocol'

const privateEnvelope = z.strictObject({
  v: z.literal(VAULT_PROTOCOL_VERSION),
  sequence: z.number().check(z.int(), z.nonnegative()),
  request: vaultPrivateRequestSchema,
})
export const vaultChannelRequestSchema = z.union([vaultBrokerRequestSchema, privateEnvelope])
export const vaultChannelResponseSchema = z.union([
  vaultBrokerResponseSchema,
  z.strictObject({
    v: z.literal(VAULT_PROTOCOL_VERSION),
    sequence: z.number().check(z.int(), z.nonnegative()),
    response: vaultPrivateResponseSchema,
  }),
])
export type VaultChannelResponse = z.infer<typeof vaultChannelResponseSchema>
