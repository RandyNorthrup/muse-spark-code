// The one production side-factory port (M98 phase 2 redesign, RVM98P2BF
// finding 2) and the one technique selector (finding 3). The window and the
// CLI/ACP/MCP runtime both build their separate source here, inside the
// lazy judge sources bundle, from the configured id and the surface's own
// I/O. A side that cannot be built returns the exact gap, and the surface
// keeps the working phase-1 same-model judge.
import type { ModelCapabilityRecord } from '../providers/capabilityRecord'
import { JUDGE_LOCAL_SEPARATE_PREFIX } from '../../shared/constants'
import type { JUDGE_SEPARATE_GAPS } from '../../shared/judge'
import type { Phase2SeparateSource } from './binding'
import { chooseByoTechnique } from './providers/decide'
import type { JudgeCapability, JudgeProfileIdentity, JudgeQuestion } from './schema'
import {
  createSystemOneSide,
  fetchSystemOnePost,
  systemOneRoute,
  type SystemOneSideIo,
} from './systemone/side'

/**
 * The one technique selector for a judge side. A bring-your-own side's
 * captured M95 record decides through `chooseByoTechnique`, exactly as its
 * runtime decides at dispatch; a SystemOne side serves only the SystemOne
 * wire its captured capability names. Anything else supports no technique,
 * so its profiles are never read and never qualify a mode. Top-1 cannot be
 * calibrated, so it qualifies nothing either.
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
 * Why a configured separate id has no side in this build, in the status
 * line's own words (`judgeSeparateGap*`):
 * - `key`: a SystemOne route whose provider key is not in M95's store;
 * - `capture`: a bring-your-own provider model, waiting on
 *   L98P2-CAPABILITY's bounded capture of a structured or logprob request;
 * - `install`: the local judge, waiting on vetted install
 *   records and a certified platform;
 * - `unknown`: an id that names no source kind.
 */
export type SeparateSourceGap = (typeof JUDGE_SEPARATE_GAPS)[number]

export type SeparateSourceBuild =
  | {
      readonly kind: 'built'
      readonly source: Phase2SeparateSource
      /** One request's ceiling at the route's captured rate (the CLI cap). */
      readonly worstCaseUsd: number
      /** Where judged state is sent, for the consent popup and PRIVACY. */
      readonly recipient: string
      readonly model: string
    }
  | { readonly kind: 'gap'; readonly gap: SeparateSourceGap }

export interface SeparateSourcePorts {
  /** The surface's key, ledger, consent and policy readers; the transport is the platform fetch. */
  readonly systemOne: Omit<SystemOneSideIo, 'post' | 'measureTokens'>
  readonly fetch: typeof fetch
  /** Whether M95's store holds a credential record for this provider id. */
  readonly hasStoredKey: (providerId: string) => boolean
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
    if (!ports.hasStoredKey(route.keyProviderId)) return { kind: 'gap', gap: 'key' }
    const built = createSystemOneSide(route, {
      ...ports.systemOne,
      // The service bills its own prompt on top of the body (the recorded
      // OpenRouter call billed 491 input tokens for a far shorter body), so
      // a body-sized quote under-reserves. Reserve the route's captured
      // per-request ceiling instead; settlement charges the reported usage.
      reserve: (usd) => ports.systemOne.reserve(Math.max(usd, route.worstCaseUsd)),
      post: fetchSystemOnePost(ports.fetch),
      // UTF-8 bytes bound tokens conservatively: an over-long state refuses
      // as over-context rather than being estimated low.
      measureTokens: (text) => Buffer.byteLength(text),
    })
    return {
      kind: 'built',
      source: { ...built, technique: judgeSideTechnique({ capability: route.capability, kind }) },
      worstCaseUsd: route.worstCaseUsd,
      recipient: route.recipient,
      model: route.model,
    }
  }
  if (id.startsWith(JUDGE_LOCAL_SEPARATE_PREFIX)) return { kind: 'gap', gap: 'install' }
  return { kind: 'gap', gap: id.includes(':') ? 'capture' : 'unknown' }
}
