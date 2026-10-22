// M125 lane E (D107): per-class engine choice through the shared
// `eligible` rule. The host orders engines best-first by measured
// speed and calibration and supplies their descriptors; this module
// only selects. Never the chat model inline or in slack; never hosted
// or unverified local in a confidential workspace; hosted only after
// consent; an unloaded engine never pulls without its consented
// preload. Pure and synchronous.
import type { Phase2SeparateSource } from '../binding'
import {
  FAST_DECISION_CLASS,
  eligible,
  type FastDecisionId,
  type FastTimingClass,
  type FastWindow,
} from './classes'

export type FastEngineKind = 'local-verified' | 'local-unverified' | 'hosted' | 'chat'

export type FastEngineState = 'ready' | 'suspended' | 'unloaded' | 'unmeasured'

/**
One engine as the resolver sees it. `p95Ms` is the rolling
complete-call p95 (2j's verified path for local engines); the host
builds it from EngineLatency. No dispatch handle: selection stays
pure data, and the host maps the chosen identity to its runtime.
*/
export interface FastEngineDescriptor {
  /** Engine identity: model and endpoint, as profiles key on it. */
  readonly id: string
  readonly kind: FastEngineKind
  readonly state: FastEngineState
  readonly p95Ms: number
  /** How the engine was selected (2j's rule: unverified local needs explicit). */
  readonly selection: 'explicit' | 'auto'
}

export interface FastResolveInput {
  readonly decision: FastDecisionId
  /** Best first, by measured speed and calibration. */
  readonly engines: readonly FastEngineDescriptor[]
  readonly window: FastWindow
  readonly confidential: boolean
  /** D48/D78 paid consent for a hosted engine, already asked and granted. */
  readonly hostedConsented: boolean
}

/** Why no engine serves the decision; lane U says these. */
export type FastResolveReason =
  | 'no-engine-fits'
  | 'confidential-excludes'
  | 'consent-needed'
  | 'explicit-needed'
  | 'preload-needed'
  | 'suspended-reprobe'
  | 'unmeasured-warmup'

export type FastResolveVerdict =
  | { readonly engine: FastEngineDescriptor }
  | { readonly engine: undefined; readonly reason: FastResolveReason }

function policyAllows(
  engine: FastEngineDescriptor,
  timingClass: FastTimingClass,
  input: FastResolveInput,
): FastResolveReason | undefined {
  // The chat model is the last fallback: boundary and post-turn only.
  if (engine.kind === 'chat')
    return timingClass === 'I' || timingClass === 'S' ? 'no-engine-fits' : undefined
  if (input.confidential && engine.kind !== 'local-verified') return 'confidential-excludes'
  if (engine.kind === 'hosted' && !input.hostedConsented) return 'consent-needed'
  return engine.kind === 'local-unverified' && engine.selection !== 'explicit'
    ? 'explicit-needed'
    : undefined
}

function stateAllows(state: FastEngineState): FastResolveReason | undefined {
  switch (state) {
    case 'ready': {
      return undefined
    }
    case 'suspended': {
      return 'suspended-reprobe'
    }
    case 'unloaded': {
      // No auto-pull: recovery needs its consented, bounded preload.
      return 'preload-needed'
    }
    case 'unmeasured': {
      return 'unmeasured-warmup'
    }
  }
}

/**
Describe a built separate side (2c's Jev and Clef routes, 2e's logprob
models, 2j's verified local runtime) to the resolver. The host builds
descriptors from its live sides and latency windows; selection stays
pure data, and the host dispatches through the chosen side's own
runtime. Identity is provider, model and endpoint, as lane L profiles
key on it; the setup keeps a local endpoint stable per user.
*/
const KIND_BY_LOCALITY: Readonly<Record<Phase2SeparateSource['locality'], FastEngineKind>> = {
  remote: 'hosted',
  'verified-local': 'local-verified',
  'unverified-local': 'local-unverified',
}

export function descriptorForSide(
  source: Phase2SeparateSource,
  state: FastEngineState,
  p95Ms: number,
  selection: 'explicit' | 'auto',
): FastEngineDescriptor {
  return {
    id: `${source.capability.providerId}:${source.capability.model}:${source.capability.endpoint}`,
    kind: KIND_BY_LOCALITY[source.locality],
    state,
    p95Ms,
    selection,
  }
}

/**
Choose the first engine the class admits, or name why none serves it.
A decision with no fitting engine runs its deterministic checks with
the reason; the engine path waits for warm-up, reprobe, preload or
consent.
*/
export function resolveFastEngine(input: FastResolveInput): FastResolveVerdict {
  const timingClass = FAST_DECISION_CLASS[input.decision]
  let withheld: FastResolveReason = 'no-engine-fits'
  for (const engine of input.engines) {
    const policy = policyAllows(engine, timingClass, input)
    if (policy !== undefined) {
      if (withheld === 'no-engine-fits') withheld = policy
      continue
    }
    const state = stateAllows(engine.state)
    if (state !== undefined) {
      if (withheld === 'no-engine-fits') withheld = state
      continue
    }
    if (eligible(timingClass, engine.p95Ms, input.window)) return { engine }
  }
  return { engine: undefined, reason: withheld }
}
