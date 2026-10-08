// The extension host's production phase-2 binding (M98 P2B).
//
// Built inside `dist/judge.js` so activation stays thin: extension.ts only
// passes the separate-source id, the evidence root and the sibling bundle
// path. Recorded evidence is read from `<globalStorage>/judge/...`; C/E/J
// live clients are injected as they land (none plumbed yet, so a
// configured separate source honestly reports `source-unavailable` until
// its lane wires a client). The adoption check runs inside the sibling
// `dist/judgeP2.js` through the shared lazy loader, keeping every
// calibration module in that bundle alone (the split guard enforces it).

import { readFileSync } from 'node:fs'
import {
  createPhase2Binding,
  phase2AdoptionSlug,
  phase2EmbeddingSlug,
  phase2EvidenceFile,
  phase2ProfileSlug,
  type Phase2AdoptionQuery,
  type Phase2BindingContext,
  type Phase2BindingRequest,
  type Phase2EmbeddingQuery,
  type Phase2EvidenceStore,
  type Phase2ProfileQuery,
  type Phase2SeparateSource,
} from '../../core/judge/binding'
import type { JudgeAdoptionContext } from '../../core/judge/adoption'
import type { JudgeCascadeSide, JudgeCascadeOptions } from '../../core/judge/cascade'
import type { CalibrationLimits } from '../../core/judge/calibration/schema'
import type { JudgeRuntime } from '../../core/judge/engine'
import type { JudgeRuntimeDeps } from '../../core/judge/runtime'
import type { JudgeEntryParts } from '../../core/judge/entries'
import type { Logger } from '../logger'
import { judgeFeaturesLoader } from '../../runtime/judge/judgeBundle'

/** Recorded JSON under the evidence root; unreadable stays unrecorded. */
export function filePhase2EvidenceStore(deps: {
  readonly root: string
  readonly readFile?: ((file: string) => string | undefined) | undefined
  readonly warn?: ((message: string) => void) | undefined
}): Phase2EvidenceStore {
  const read = deps.readFile ?? defaultReadFile
  const readJson = (kind: 'profile' | 'adoption' | 'embedding', slug: string): unknown => {
    let text: string | undefined
    try {
      text = read(phase2EvidenceFile(deps.root, kind, slug))
    } catch {
      return undefined
    }
    if (text === undefined) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      deps.warn?.(`Ignoring malformed phase-2 ${kind} record ${slug}`)
      return undefined
    }
  }
  return {
    readProfile: (query: Phase2ProfileQuery) => readJson('profile', phase2ProfileSlug(query)),
    readAdoptionRecord: (query: Phase2AdoptionQuery) =>
      readJson('adoption', phase2AdoptionSlug(query)),
    readEmbeddingHead: (query: Phase2EmbeddingQuery) =>
      (readJson('embedding', phase2EmbeddingSlug(query)) as { head?: unknown } | undefined)?.head,
    readEmbeddingManifest: (query: Phase2EmbeddingQuery) =>
      (readJson('embedding', phase2EmbeddingSlug(query)) as { manifest?: unknown } | undefined)
        ?.manifest,
  }
}

function defaultReadFile(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
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
   * The surface's live C/E/J clients; all absent until their lanes land.
   * `embedding` names a configured transport whose head the store may not
   * hold yet; the binding then reports the missing labels in the status.
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
   * The surface configured a separate id whose C/E/J client has not landed.
   * Defaults to whether a live separate source exists.
   */
  readonly separateConfigured?: boolean | undefined
}

/** The window's production phase-2 factory: one shared binding builder. */
export function createHostPhase2(deps: HostPhase2BindingInputs): {
  readonly binding: (action: JudgeEntryParts) => ReturnType<typeof createPhase2Binding>
  readonly createRuntime: (runtime: JudgeRuntimeDeps) => Promise<JudgeRuntime>
} {
  const loadJudgeP2 = judgeFeaturesLoader({
    bundlePath: deps.judgeP2BundlePath,
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
  })
  const store = filePhase2EvidenceStore({
    root: deps.evidenceRoot,
    warn: (message) => {
      deps.log.warn(message)
    },
  })
  const hasJudgeAdoption = (record: unknown, context: JudgeAdoptionContext): boolean =>
    loadJudgeP2().hasJudgeAdoptionEvidence(record, context)
  return {
    binding: (action: JudgeEntryParts): ReturnType<typeof createPhase2Binding> => {
      const context = deps.context(action)
      if (context === undefined) return undefined
      const sources = deps.sources()
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
        ...(sources.separate !== undefined && { separate: sources.separate }),
        ...((deps.separateConfigured ?? sources.separate !== undefined) && {
          separateConfigured: true as const,
        }),
        adoptionCheck: hasJudgeAdoption,
        ...(isAwaitingLabels && { embeddingAwaitingLabels: true as const }),
      }
      return createPhase2Binding(request)
    },
    createRuntime: (runtime: JudgeRuntimeDeps) => loadJudgeP2().createRuntime(runtime),
  }
}
