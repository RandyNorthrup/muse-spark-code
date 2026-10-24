// Tab on a bring-your-own model (M95c part 7, PLAN.md D73/D74): a
// `museSpark.tabModel` written as a `provider/model` reference names one
// of the person's configured models instead of a Meta tier. The provider
// resolves it per request (a completion sends no tools, so the agent turn's
// tool-calling gate does not apply), and the resolution carries
// everything the request needs: its own client's stream and key, its price
// card for the hard daily ledger, the quote D48's question names, the
// fingerprint consent is keyed by, and its output maximum. Pure of
// `vscode`; activation reads only `isByoTabModel`.

import type { ResolvedModel, ModelPricePolicy } from '../../core/backends/modelapi/modelPolicy'
import type { TabStream } from '../../core/tab/tabEngine'
import type { TabByoQuote } from '../../shared/paid'

/** A Tab model naming one of the person's own models (`provider/model`), never a Meta tier. */
export function isByoTabModel(model: string): boolean {
  return model.includes('/')
}

/** One BYO Tab request's resolution, as the provider uses it. */
export interface TabByoRequest {
  readonly stream: TabStream
  readonly price: ModelPricePolicy
  /** What D48's question quotes: who bills, and at which rates. */
  readonly quote: TabByoQuote
  /** Consent's key: the reference and the card a grant covers. */
  readonly fingerprint: string
  /** The model's output maximum (the entry's own limit, else its record's); undefined when unknown. */
  readonly maxOutputTokens: number | undefined
}

/**
The request a resolution makes, or undefined for a model with no price
card: nothing can be reserved for it, so no request may go (the same
refusal every paid runner states for an unpriced model).
*/
export function tabByoRequest(resolved: ResolvedModel): TabByoRequest | undefined {
  const pricing = resolved.policy.pricing
  if (pricing.kind === 'unpriced') return undefined
  const provider = resolved.policy.identity.provider
  const quote: TabByoQuote =
    pricing.kind === 'priced'
      ? {
          provider,
          kind: 'priced',
          rates: {
            input: pricing.card.input,
            cached: pricing.card.cachedInput ?? pricing.card.input,
            output: pricing.card.output,
            request: pricing.card.request ?? 0,
          },
        }
      : { provider, kind: pricing.kind }
  return {
    stream: (body, signal, budget, admit) =>
      resolved.client.streamResponse(body, signal, undefined, budget, admit),
    price: resolved.price,
    quote,
    fingerprint: JSON.stringify([resolved.ref, quote]),
    maxOutputTokens: resolved.policy.output.maxTokens,
  }
}

/** The window's BYO resolutions: fresh per request, the last kept for synchronous reads. */
export interface TabByoResolutions {
  /**
  Resolves the reference afresh (a moved price or file lands on the next
  request). Undefined for an unpriced model; an unknown or retired
  reference refuses with the registry's own sentence.
  */
  resolve(ref: string): Promise<TabByoRequest | undefined>
  /** The last resolution of `ref`: consent's price key and the usage tally read it. */
  current(ref: string): TabByoRequest | undefined
}

export function createTabByoResolutions(
  resolveModel: (ref: string) => Promise<ResolvedModel>,
): TabByoResolutions {
  const latest = new Map<string, TabByoRequest>()
  return {
    resolve: async (ref) => {
      const request = tabByoRequest(await resolveModel(ref))
      if (request === undefined) latest.delete(ref)
      else latest.set(ref, request)
      return request
    },
    current: (ref) => latest.get(ref),
  }
}
