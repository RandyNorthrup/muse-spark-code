// The model-request relay (M110c lane F2, D90.7): a worker without a key
// asks its orchestrator to run a model call. The envelope carries the call
// and never a credential: the schemas are strict, so a smuggled key field
// fails to parse, and the orchestrator injects its own key server-side.
// Every completed call settles usage onto the payer's ledger. The provider
// call itself (M95) and the transport (M100's lane T) are the legs that wait.
import * as z from 'zod/mini'

export const modelRelayRequestSchema = z.strictObject({
  provider: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  payload: z.record(z.string(), z.unknown()),
  attemptKey: z.string().check(z.minLength(1)),
})
export type ModelRelayRequest = z.infer<typeof modelRelayRequestSchema>

export const modelRelayUsageSchema = z.strictObject({
  inputTokens: z.int().check(z.gte(0)),
  outputTokens: z.int().check(z.gte(0)),
})
export type ModelRelayUsage = z.infer<typeof modelRelayUsageSchema>

export const modelRelayResponseSchema = z.strictObject({
  attemptKey: z.string().check(z.minLength(1)),
  ok: z.boolean(),
  body: z.optional(z.record(z.string(), z.unknown())),
  failure: z.optional(z.string()),
  usage: modelRelayUsageSchema,
})
export type ModelRelayResponse = z.infer<typeof modelRelayResponseSchema>

export function encodeModelRelayRequest(request: ModelRelayRequest): string {
  return JSON.stringify(modelRelayRequestSchema.parse(request))
}

export function decodeModelRelayRequest(encoded: string): ModelRelayRequest {
  const parsed: unknown = JSON.parse(encoded)
  return modelRelayRequestSchema.parse(parsed)
}

export function encodeModelRelayResponse(response: ModelRelayResponse): string {
  return JSON.stringify(modelRelayResponseSchema.parse(response))
}

export function decodeModelRelayResponse(encoded: string): ModelRelayResponse {
  const parsed: unknown = JSON.parse(encoded)
  return modelRelayResponseSchema.parse(parsed)
}

export const modelRelayLedgerEntrySchema = z.strictObject({
  payer: z.string().check(z.minLength(1)),
  provider: z.string().check(z.minLength(1)),
  model: z.string().check(z.minLength(1)),
  attemptKey: z.string().check(z.minLength(1)),
  at: z.int().check(z.gte(0)),
  usage: modelRelayUsageSchema,
})
export type ModelRelayLedgerEntry = z.infer<typeof modelRelayLedgerEntrySchema>

/** Settle one completed call onto the payer's ledger; failures settle too. */
export function settleModelRelayUsage(
  ledger: readonly ModelRelayLedgerEntry[],
  entry: {
    readonly payer: string
    readonly provider: string
    readonly model: string
    readonly attemptKey: string
    readonly at: number
    readonly usage: ModelRelayUsage
  },
): readonly ModelRelayLedgerEntry[] {
  return [...ledger, modelRelayLedgerEntrySchema.parse(entry)]
}

export interface ModelRelayTotals {
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
}

export function modelRelayTotalsFor(
  ledger: readonly ModelRelayLedgerEntry[],
  payer: string,
): ModelRelayTotals {
  let calls = 0
  let inputTokens = 0
  let outputTokens = 0
  for (const entry of ledger) {
    if (entry.payer !== payer) continue
    calls += 1
    inputTokens += entry.usage.inputTokens
    outputTokens += entry.usage.outputTokens
  }
  return { calls, inputTokens, outputTokens }
}
