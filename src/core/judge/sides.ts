// The one production side-factory port (M98 phase 2 redesign, RVM98P2BF
// finding 2) and the one technique selector (finding 3). The window and the
// CLI/ACP/MCP runtime both build their separate source here, inside the
// lazy judge sources bundle, from the configured id and the surface's own
// I/O. A side that cannot be built returns the exact gap, and the surface
// keeps the working phase-1 same-model judge.
import type { ModelCapabilityRecord } from '../providers/capabilityRecord'
import { JUDGE_LOCAL_SEPARATE_PREFIX, type JUDGE_SEPARATE_GAPS } from '../../shared/constants'
import type { Phase2SeparateSource } from './binding'
import type { JudgeRuntime } from './engine'
import { chooseByoTechnique } from './providers/decide'
import type { JudgeCapability, JudgeProfileIdentity, JudgeQuestion } from './schema'
import { compareUsdAmounts } from '../../shared/usd'
import type { UsdAmount } from '../../shared/usdSchema'
import * as z from 'zod/mini'
import {
  createSystemOneSide,
  pinnedSystemOnePost,
  systemOneKey,
  systemOneRoute,
  type SystemOneSideIo,
  type SystemOneTransportSeams,
} from './systemone/side'

/** The only status whose body lane C reads as a SystemOne result. */
const SYSTEMONE_HTTP_OK = 200

/**
The one technique selector for a judge side. A bring-your-own side's
captured M95 record decides through `chooseByoTechnique`, exactly as its
runtime decides at dispatch; a SystemOne side serves only the SystemOne
wire its captured capability names. Anything else supports no technique,
so its profiles are never read and never qualify a mode. Top-1 cannot be
calibrated, so it qualifies nothing either.
*/
export function judgeSideTechnique(input: {
  readonly capability: JudgeCapability
  readonly record?: ModelCapabilityRecord | undefined
  readonly kind: JudgeQuestion['type']
}): JudgeProfileIdentity['technique'] | undefined {
  if (input.record === undefined) return input.capability.systemone ? 'systemone' : undefined
  const decision = chooseByoTechnique(input.record, input.capability, input.kind)
  return decision.outcome !== 'chosen' || decision.choice.technique === 'top1'
    ? undefined
    : decision.choice.technique
}

/**
Why a configured separate id has no side in this build, in the status
line's own words (`judgeSeparateGap*`):
- `key`: a SystemOne route whose provider key is not in M95's store;
- `capture`: a bring-your-own provider model, waiting on
  L98P2-CAPABILITY's bounded capture of a structured or logprob request;
- `install`: the local judge, waiting on vetted install
  records and a certified platform;
- `unknown`: an id that names no source kind.
*/
export type SeparateSourceGap = (typeof JUDGE_SEPARATE_GAPS)[number]

export type SeparateSourceBuild =
  | {
      readonly kind: 'built'
      readonly source: Phase2SeparateSource
      /** One request's ceiling at the route's captured rate (the CLI cap). */
      readonly worstCaseUsd: UsdAmount
      /** Where judged state is sent, for the consent popup and PRIVACY. */
      readonly recipient: string
      readonly model: string
    }
  | { readonly kind: 'gap'; readonly gap: SeparateSourceGap }

/** One sent SystemOne call, as the surface's usage tally sees it. */
export interface SeparateSourceCall {
  /** The call reached the service but no settled receipt followed. */
  failed(): void
  /** The call settled at this cost, with its reported token usage when read. */
  settled(
    usage: { readonly inputTokens: number; readonly outputTokens: number } | undefined,
    costUsd: UsdAmount,
  ): void
}

export interface SeparateSourcePorts {
  /** The surface's key, ledger, consent and policy readers. */
  readonly systemOne: Omit<SystemOneSideIo, 'post' | 'measureTokens'>
  /** Tests' seams for the M95 pinned transport; production passes none. */
  readonly transport?: SystemOneTransportSeams | undefined
  /**
  Whether M95's store holds a usable, origin-bound key for this provider
  id. `undefined` means not read yet (the window's first action after
  activation): the side is built and lane C reads the key at dispatch, a
  missing one refunding before anything is sent.
  */
  readonly hasStoredKey: (providerId: string) => boolean | undefined
  /** The surface's loud tally: one row per call actually sent (the window). */
  readonly onCall?: ((model: string) => SeparateSourceCall) | undefined
  /**
  A verified local judge runtime (M125 lane E closes the `install`
  gap): 2j-registered, its peer proof and disk proof (or hold) intact,
  on a certified platform. The surface supplies it only when 2j
  verifies; without it the `install` gap stands.
  */
  readonly local?:
    | {
        readonly runtime: JudgeRuntime
        readonly capability: JudgeCapability
        readonly model: string
        /** The approved profile version the store is read for ('' while none is approved). */
        readonly fitVersion: string
        /** The model's M95 record, when one chooses the technique. */
        readonly record?: ModelCapabilityRecord | undefined
      }
    | undefined
}

const usageSchema = z.looseObject({
  usage: z.looseObject({
    input_tokens: z.int().check(z.nonnegative()),
    output_tokens: z.int().check(z.nonnegative()),
  }),
})

/**
The provider id and origin whose stored key a configured route needs, so a
surface that reads keys asynchronously can check one before it builds.
*/
export function separateSourceKey(
  separateId: string,
): { readonly providerId: string; readonly origin: string } | undefined {
  const route = systemOneRoute(separateId.trim())
  return route === undefined
    ? undefined
    : { providerId: route.keyProviderId, origin: route.recipient }
}

/** What a surface shows for a configured paid route: its source, model, tariff and consent identity. */
export interface SeparateRouteFacts {
  /** The route's preset (the provider the user's own key pays). */
  readonly providerId: string
  readonly model: string
  /** What the route's window grant is bound to (`PaidUseConsent.isRouteAllowed`). */
  readonly consentKey: string
  readonly inputUsdPerMillion: number
  readonly outputUsdPerMillion: number
}

/** The facts of the route a configured id names, or undefined when it names none. */
export function separateRouteFacts(separateId: string): SeparateRouteFacts | undefined {
  const route = systemOneRoute(separateId.trim())
  return route === undefined
    ? undefined
    : {
        providerId: route.presetId,
        model: route.model,
        consentKey: route.consentKey,
        inputUsdPerMillion: route.tariff.inputUsdPerMillion,
        outputUsdPerMillion: route.tariff.outputUsdPerMillion,
      }
}

/** Whether a usable key is stored for a configured route (no route: nothing to check). */
export async function hasSeparateSourceKey(
  separateId: string,
  readStoredCredential: SystemOneSideIo['readStoredCredential'],
): Promise<boolean> {
  const needed = separateSourceKey(separateId)
  return (
    needed !== undefined &&
    (await systemOneKey({ readStoredCredential }, needed.providerId, needed.origin)) !== undefined
  )
}

/** Build the configured separate source, or name exactly what it is missing. */
export function buildSeparateSource(
  separateId: string,
  ports: SeparateSourcePorts,
  kind: JudgeQuestion['type'],
): SeparateSourceBuild {
  const id = separateId.trim()
  const route = systemOneRoute(id)
  if (route !== undefined) {
    if (ports.hasStoredKey(route.keyProviderId) === false) return { kind: 'gap', gap: 'key' }
    const post = pinnedSystemOnePost(ports.transport)
    // One side instance serves one judge run (each binding read builds a
    // new one), so its reserve, send and settle belong to the same call.
    let call: SeparateSourceCall | undefined
    let reported: { inputTokens: number; outputTokens: number } | undefined
    const built = createSystemOneSide(route, {
      ...ports.systemOne,
      // The service bills its own prompt on top of the body (the recorded
      // OpenRouter call billed 491 input tokens for a far shorter body), so
      // a body-sized quote under-reserves. Reserve the route's captured
      // per-request ceiling instead; settlement charges the reported usage.
      reserve: async (usd) => {
        const ceiling = compareUsdAmounts(usd, route.worstCaseUsd) >= 0 ? usd : route.worstCaseUsd
        const reserved = await ports.systemOne.reserve(ceiling)
        if (!reserved.reserved) return reserved
        return {
          reserved: true,
          claim: {
            reservedUsd: reserved.claim.reservedUsd,
            // The durable claim's own live admission, read before dispatch.
            check: () => {
              reserved.claim.check()
            },
            settle: async (actualUsd) => {
              await reserved.claim.settle(actualUsd)
              call?.settled(reported, actualUsd)
              call = undefined
            },
            refund: async () => {
              await reserved.claim.refund()
              call?.failed()
              call = undefined
            },
          },
        }
      },
      post: async (request) => {
        // The paid row opens when the request is dispatched, so a sent call
        // whose response then fails still shows as an uncertain paid use.
        const result = await post({
          ...request,
          onDispatch: () => {
            request.onDispatch?.()
            call = ports.onCall?.(route.model)
          },
        })
        if (!result.sent) return result
        const parsed = usageSchema.safeParse(result.body)
        reported = parsed.success
          ? {
              inputTokens: parsed.data.usage.input_tokens,
              outputTokens: parsed.data.usage.output_tokens,
            }
          : undefined
        if (result.status !== SYSTEMONE_HTTP_OK) {
          // Sent and refused by the service: the claim stays liability.
          call?.failed()
          call = undefined
        }
        return result
      },
      // UTF-8 bytes bound tokens conservatively: an over-long state refuses
      // as over-context rather than being estimated low.
      measureTokens: (text) => Buffer.byteLength(text),
    })
    return {
      kind: 'built',
      source: {
        ...built,
        // A sent call that never settled (an unreadable 200 keeps its
        // liability) still closes its row as failed.
        runtime: {
          judge: async (request, signal) => {
            try {
              return await built.runtime.judge(request, signal)
            } finally {
              call?.failed()
              call = undefined
            }
          },
        },
        technique: judgeSideTechnique({ capability: route.capability, kind }),
      },
      worstCaseUsd: route.worstCaseUsd,
      recipient: route.recipient,
      model: route.model,
    }
  }
  if (id.startsWith(JUDGE_LOCAL_SEPARATE_PREFIX)) {
    const local = ports.local
    if (local === undefined) return { kind: 'gap', gap: 'install' }
    return {
      kind: 'built',
      source: {
        runtime: local.runtime,
        capability: local.capability,
        fitVersion: local.fitVersion,
        verified: true,
        locality: 'verified-local',
        technique: judgeSideTechnique({ capability: local.capability, record: local.record, kind }),
      },
      // Local inference is free; judged state stays on the loopback endpoint.
      worstCaseUsd: 0,
      recipient: local.capability.endpoint,
      model: local.model,
    }
  }
  return { kind: 'gap', gap: id.includes(':') ? 'capture' : 'unknown' }
}
