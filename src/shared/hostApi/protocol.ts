import * as z from 'zod/mini'
import { MHP } from '../constants'
import { errorSchema, idSchema } from './data'
import { MHP_METHODS, type MhpRequestMethod, type MhpResult } from './methods'

const methodSchema = z.enum(Object.keys(MHP_METHODS))
const requestEnvelope = z.strictObject({
  jsonrpc: z.literal(MHP.jsonRpcVersion),
  id: idSchema,
  method: methodSchema,
  params: z.unknown(),
})
const notificationEnvelope = z.strictObject({
  jsonrpc: z.literal(MHP.jsonRpcVersion),
  method: methodSchema,
  params: z.unknown(),
})
export const failureFrameSchema = z.strictObject({
  jsonrpc: z.literal(MHP.jsonRpcVersion),
  id: z.nullable(idSchema),
  error: errorSchema,
})
export type MhpFailureFrame = z.infer<typeof failureFrameSchema>

// A mapped view preserves method/result correlation when indexing the
// heterogeneous table. The compiler verifies every assignment; no cast.
const requestMethods: {
  readonly [M in MhpRequestMethod]: { readonly result: z.ZodMiniType<MhpResult<M>> }
} = MHP_METHODS

// These parsers are also the in-process boundary. Lookup never trusts a
// prototype property; result parsing uses the pending request's method.
export function parseMhpCall(value: unknown) {
  const frame = z.union([requestEnvelope, notificationEnvelope]).parse(value)
  const definition = Object.entries(MHP_METHODS).find(([method]) => method === frame.method)?.[1]
  if (definition === undefined || (definition.kind === 'request') !== 'id' in frame) {
    throw new TypeError('MHP_INVALID_REQUEST')
  }
  return { ...frame, params: definition.params.parse(frame.params) }
}

export function parseMhpResult<M extends MhpRequestMethod>(method: M, value: unknown) {
  const definition = requestMethods[method]
  return z
    .strictObject({
      jsonrpc: z.literal(MHP.jsonRpcVersion),
      id: idSchema,
      result: definition.result,
    })
    .parse(value)
}
