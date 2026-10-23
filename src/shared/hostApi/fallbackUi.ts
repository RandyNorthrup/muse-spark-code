import * as z from 'zod/mini'
import { MHP } from '../constants'
import { idSchema } from './data'
import { failureFrameSchema } from './protocol'

export const fallbackUiMethodSchema = z.enum([
  'ui/confirm',
  'ui/pick',
  'ui/input',
  'ui/notify',
  'ui/status',
  'ui/progress',
  'ui/clipboard',
  'ui/openExternal',
])
export type FallbackUiMethod = z.infer<typeof fallbackUiMethodSchema>
export const fallbackUiCallSchema = z.union([
  z.strictObject({
    jsonrpc: z.literal(MHP.jsonRpcVersion),
    id: idSchema,
    method: fallbackUiMethodSchema,
    params: z.unknown(),
  }),
  z.strictObject({
    jsonrpc: z.literal(MHP.jsonRpcVersion),
    method: z.literal('$/cancelRequest'),
    params: z.strictObject({ id: idSchema }),
  }),
])
export const fallbackUiReplySchema = z.union([
  z.strictObject({ jsonrpc: z.literal(MHP.jsonRpcVersion), id: idSchema, result: z.unknown() }),
  failureFrameSchema,
])
