// The extension host's production phase-2 binding (M98 P2B, redesign).
//
// Built inside `dist/judge.js` so activation stays thin: extension.ts only
// passes plain inputs. Recorded evidence is read from the evidence root
// (`<globalStorage>/judge`) directly. The separate side comes from the one
// production side-factory port inside `dist/judgeP2.js`'s sources child:
// a SystemOne route on M95's stored key is built for real; every other id
// names its exact gap and the window keeps its phase-1 same-model judge.
// The adoption check runs in `dist/judgeP2.js` too, keeping every
// calibration module in that bundle alone (the split guard enforces it).

import { readFileSync } from 'node:fs'
import {
  createPhase2Binding,
  filePhase2EvidenceStore,
  type Phase2BindingContext,
  type Phase2BindingRequest,
  type Phase2EmbeddingQuery,
  type Phase2SeparateSource,
} from '../../core/judge/binding'
import type { JudgeAdoptionContext } from '../../core/judge/adoption'
import type { JudgeCascadeSide, JudgeCascadeOptions } from '../../core/judge/cascade'
import type { CalibrationLimits } from '../../core/judge/calibration/schema'
import type { JudgePlanRuntime, JudgeRuntimeDeps } from '../../core/judge/runtime'
import type { JudgeEntryParts } from '../../core/judge/entries'
import type { SeparateRouteFacts, SeparateSourcePorts } from '../../core/judge/sides'
import type { Logger } from '../logger'
import { judgeFeaturesLoader } from '../../runtime/judge/judgeBundle'

function defaultReadFile(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** The host file store keeps the node:fs default; CLI surfaces pass their own reader. */
export function hostPhase2EvidenceStore(
  root: string,
  warn: (message: string) => void,
): ReturnType<typeof filePhase2EvidenceStore> {
  return filePhase2EvidenceStore({ root, readFile: defaultReadFile, warn })
}

export interface HostPhase2BindingInputs {
  /** `dist/judgeP2.js`, for the runtime and the adoption check. */
  readonly judgeP2BundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
  readonly engine: () => unknown
  /** Raw `museSpark.judge.separate`; empty keeps the single-model setup. */
  readonly separateId: () => string
  readonly evidenceRoot: string
  readonly limits: CalibrationLimits
  readonly options: () => JudgeCascadeOptions
  /**
  The surface's live C/E/J clients; all absent until their lanes land.
  `embedding` names a configured transport whose head the store may not
  hold yet; the binding then reports the missing labels in the status.
  */
  readonly sources: () => {
    readonly same?: JudgeCascadeSide | undefined
    readonly separate?: Phase2SeparateSource | undefined
    /** A present transport has no recorded head yet; the status says so. */
    readonly embedding?: { readonly query: Phase2EmbeddingQuery } | undefined
  }
  readonly context: (action: JudgeEntryParts) => Phase2BindingContext | undefined
  readonly billing: (action: JudgeEntryParts) => 'subscription' | 'modelApi' | 'free'
  /**
  The surface configured a separate id whose C/E/J client has not landed.
  Defaults to whether a live separate source exists.
  */
  readonly separateConfigured?: boolean | undefined
  /**
  The window's key, ledger, consent and transport for the production
  side-factory port. Absent: only `sources()` can supply a side.
  */
  readonly separatePorts?:
    ((action: JudgeEntryParts) => Omit<SeparateSourcePorts, 'hasStoredKey'>) | undefined
  /** A route's key presence changed after discovery: the surface refreshes its status. */
  readonly onKeyChange?: (() => void) | undefined
  /** M95's stored credential value for a provider id, for the route's key check. */
  readonly readStoredCredential?: ((providerId: string) => Promise<string | undefined>) | undefined
}

/** The window's production phase-2 factory: one shared binding builder. */
export function createHostPhase2(deps: HostPhase2BindingInputs): {
  readonly binding: (action: JudgeEntryParts) => ReturnType<typeof createPhase2Binding>
  readonly createRuntime: (runtime: JudgeRuntimeDeps) => Promise<JudgePlanRuntime>
  readonly readySeparateRoute: () => SeparateRouteFacts | undefined
} {
  const loadJudgeP2 = judgeFeaturesLoader({
    bundlePath: deps.judgeP2BundlePath,
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
  })
  const store = hostPhase2EvidenceStore(deps.evidenceRoot, (message) => {
    deps.log.warn(message)
  })
  const hasJudgeAdoption = (record: unknown, context: JudgeAdoptionContext): boolean =>
    loadJudgeP2().hasJudgeAdoptionEvidence(record, context)
  // The route's key, checked by the same rule the CLI applies before it
  // builds (stored, an API key, bound to the route's origin). SecretStorage
  // is asynchronous, so the answer is read ahead and kept: the first check
  // starts at construction, and every binding read refreshes it.
  const keyReady = new Map<string, boolean>()
  const refreshKey = (separateId: string): void => {
    const read = deps.readStoredCredential
    if (read === undefined || separateId === '') return
    void loadJudgeP2()
      .hasSeparateSourceKey(separateId, read)
      .then((isReady) => {
        const isChanged = keyReady.get(separateId) !== isReady
        keyReady.set(separateId, isReady)
        if (isChanged) deps.onKeyChange?.()
      })
      .catch(() => {
        keyReady.set(separateId, false)
      })
  }
  refreshKey(deps.separateId().trim())
  return {
    binding: (action: JudgeEntryParts): ReturnType<typeof createPhase2Binding> => {
      const context = deps.context(action)
      if (context === undefined) return undefined
      const sources = deps.sources()
      const separateId = deps.separateId().trim()
      // The one side-factory port: a buildable route becomes the real side,
      // anything else names its gap; phase 1 stays the window's judge.
      const built =
        separateId === '' || sources.separate !== undefined || deps.separatePorts === undefined
          ? undefined
          : loadJudgeP2().separateSource(
              separateId,
              {
                ...deps.separatePorts(action),
                hasStoredKey: () => keyReady.get(separateId),
              },
              'noul',
            )
      refreshKey(separateId)
      const separate = sources.separate ?? (built?.kind === 'built' ? built.source : undefined)
      const embeddingQuery = sources.embedding?.query
      const isAwaitingLabels =
        embeddingQuery !== undefined &&
        (store.readEmbeddingHead(embeddingQuery) === undefined ||
          store.readEmbeddingManifest(embeddingQuery) === undefined)
      const request: Phase2BindingRequest = {
        engine: deps.engine(),
        separateId: deps.separateId(),
        store,
        options: deps.options(),
        limits: deps.limits,
        context,
        billing: deps.billing(action),
        ...(sources.same !== undefined && { same: sources.same }),
        ...(separate !== undefined && { separate }),
        ...((deps.separateConfigured ?? separate !== undefined) && {
          separateConfigured: true as const,
        }),
        ...(built?.kind === 'gap' && { separateGap: built.gap }),
        adoptionCheck: hasJudgeAdoption,
        ...(isAwaitingLabels && { embeddingAwaitingLabels: true as const }),
      }
      return createPhase2Binding(request)
    },
    createRuntime: (runtime: JudgeRuntimeDeps) => loadJudgeP2().createRuntime(runtime),
    // C's own availability (multi-vendor rule): the configured id names a
    // route this window can build and its key is not known to be missing.
    // Never the Meta judge's gate, price acceptance or backend.
    // The route's own facts (source, model, tariff, consent identity) while
    // it can be built, for the C-only plan and its status and usage rows.
    readySeparateRoute: () => {
      const separateId = deps.separateId().trim()
      const isBuildable =
        separateId !== '' && deps.separatePorts !== undefined && keyReady.get(separateId) !== false
      return isBuildable ? loadJudgeP2().separateRouteFacts(separateId) : undefined
    },
  }
}
