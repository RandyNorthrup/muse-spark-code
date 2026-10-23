// Recorded phase-2 evidence paths and store (M98 P2B, redesign).
//
// Deliberately import-light: only the shared constants and node:crypto. The
// CLI/ACP entry (`src/runtime/main.ts`) reads these at startup while
// keeping judge schemas lazy (the dispatch gate trips when
// `core/judge/schema.ts` loads), so nothing here may ever import a judge
// schema, calibration module or the binding factory. Everything
// judge-shaped stays type-only at this layer; validation lives in
// `dist/judgeP2.js`.
//
// One root convention: a surface passes its evidence root, which already
// IS the judge evidence directory (`<globalStorage>/judge` in the host,
// `<config>/muse/judge` for the CLI/MCP). Files live directly beneath it,
// at `<root>/<kind>/<slug>.json`; nothing appends another `judge`.

import { createHash } from 'node:crypto'
import {
  JUDGE_EVIDENCE_DIRNAME,
  JUDGE_EVIDENCE_SLUG_HASH_CHARS,
  JUDGE_EVIDENCE_SLUG_PREFIX_CHARS,
} from '../../shared/constants'
import type { JudgeAdoptionContext } from './adoption'
import type { JudgeCascadeOptions, JudgeCascadeSide } from './cascade'
import type { CalibrationLimits } from './calibration/schema'
import type { JudgeRuntimeBinding } from './runtime'
import type { JudgeModeContext } from './resolve'

/** B's fitted calibration profiles, one JSON file per side identity. */
export const PHASE2_PROFILE_BASENAME = 'profiles'
/** Held-out paired M75 adoption records, one JSON file per family. */
export const PHASE2_ADOPTION_BASENAME = 'adoption'
/** L98P2-EMBED heads and manifests, one JSON file per family. */
export const PHASE2_EMBEDDING_BASENAME = 'embedding'

/** Identity fields that select one recorded fitted profile. */
export interface Phase2ProfileQuery {
  readonly providerId: string
  readonly model: string
  readonly modelVersion: string
  readonly endpoint: string
  readonly source: 'same' | 'separate'
  readonly technique: string
  readonly family: string
  readonly promptVersion: string
  readonly criteriaVersion: string
  readonly fitVersion: string
}

/** Identity fields that select one recorded adoption receipt. */
export interface Phase2AdoptionQuery {
  readonly providerId: string
  readonly modelId: string
  readonly family: string
  readonly promptVersion: string
  readonly criteriaVersion: string
}

/** Identity fields that select one recorded embedding head/manifest pair. */
export interface Phase2EmbeddingQuery {
  readonly providerId: string
  readonly model: string
  readonly modelVersion: string
  readonly endpoint: string
  readonly source: string
  readonly family: string
  readonly promptVersion: string
  readonly criteriaVersion: string
  readonly fitVersion: string
  readonly dimension: number
}

/**
The surface's request context for binding construction: who asks, what
is configured, and what is measured. Lives beside the store because the
clientless constructor reads the adoption record for exactly this
identity; the factory re-exports it unchanged.
*/
export interface Phase2BindingContext {
  readonly providerId: string
  readonly modelId: string
  readonly endpoint?: string | undefined
  readonly profileId?: string | undefined
  readonly ownerId?: string | undefined
  readonly turn?: string | number | undefined
  readonly confidential: boolean
  readonly sourceAvailable: boolean
  readonly paidConsent: JudgeModeContext['paidConsent']
  readonly readyRate: number | undefined
  readonly minReadyRate: number
}

/**
Recorded evidence, read from owner storage. Every method returns
`undefined` when nothing is recorded; an unreadable or malformed entry
is also `undefined`, never a guessed profile. Surfaces implement this
over files (`phase2EvidenceFile` builds the path); tests use memory.
*/
export interface Phase2EvidenceStore {
  readProfile(query: Phase2ProfileQuery): unknown
  readAdoptionRecord(query: Phase2AdoptionQuery): unknown
  readEmbeddingHead(query: Phase2EmbeddingQuery): unknown
  readEmbeddingManifest(query: Phase2EmbeddingQuery): unknown
}

/** Nothing is recorded: every reader reports the gap instead of a guess. */
const NO_RECORDED_EVIDENCE: unknown = undefined

/** A store with nothing recorded: every phase-2 mode reports its gap. */
export function emptyPhase2EvidenceStore(): Phase2EvidenceStore {
  return {
    readProfile: () => NO_RECORDED_EVIDENCE,
    readAdoptionRecord: () => NO_RECORDED_EVIDENCE,
    readEmbeddingHead: () => NO_RECORDED_EVIDENCE,
    readEmbeddingManifest: () => NO_RECORDED_EVIDENCE,
  }
}

function sanitizeSlugPart(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return cleaned === '' ? 'unknown' : cleaned
}

/**
File name for one recorded artifact: a readable, sanitized prefix of the
identity, cut to a fixed length, then a hash of the COMPLETE identity.
The whole basename is bounded however long each part is, parts cannot
escape their directory on any platform (no `/`, `:` or `..` survives),
and two identities that sanitize alike still get different names.
*/
export function phase2EvidenceSlug(parts: readonly string[]): string {
  const readable = parts
    .map((part) => sanitizeSlugPart(part))
    .join('__')
    .slice(0, JUDGE_EVIDENCE_SLUG_PREFIX_CHARS)
    .replaceAll(/[-_.]+$/g, '')
  const digest = createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, JUDGE_EVIDENCE_SLUG_HASH_CHARS)
  return `${readable}--${digest}`
}

/**
Storage path for one recorded artifact, with `/` separators on every
platform (callers must normalise before comparing: CI runs on Windows).
`root` is the surface's evidence root itself; the measurement lane
writes these exact paths and the binding reads them.
*/
export function phase2EvidenceFile(
  root: string,
  kind: 'profile' | 'adoption' | 'embedding',
  slug: string,
): string {
  const bases = {
    profile: PHASE2_PROFILE_BASENAME,
    adoption: PHASE2_ADOPTION_BASENAME,
    embedding: PHASE2_EMBEDDING_BASENAME,
  }
  const rootSlash = root.replaceAll('\\', '/').replaceAll(/\/+$/g, '')
  return `${rootSlash}/${bases[kind]}/${slug}.json`
}

/** Slug for one side's fitted profile file. */
export function phase2ProfileSlug(query: Phase2ProfileQuery): string {
  return phase2EvidenceSlug([
    query.providerId,
    query.model,
    query.modelVersion,
    query.endpoint,
    query.source,
    query.technique,
    query.family,
    query.promptVersion,
    query.criteriaVersion,
    query.fitVersion,
  ])
}

/** Slug for one family's adoption receipt file. */
export function phase2AdoptionSlug(query: Phase2AdoptionQuery): string {
  return phase2EvidenceSlug([
    query.providerId,
    query.modelId,
    query.family,
    query.promptVersion,
    query.criteriaVersion,
  ])
}

/** Slug for one family's embedding head/manifest files. */
export function phase2EmbeddingSlug(query: Phase2EmbeddingQuery): string {
  return phase2EvidenceSlug([
    query.providerId,
    query.model,
    query.modelVersion,
    query.endpoint,
    query.source,
    query.family,
    query.promptVersion,
    query.criteriaVersion,
    query.fitVersion,
    String(query.dimension),
  ])
}

/**
Recorded JSON under the evidence root; unreadable stays unrecorded.
`readFile` is injected (node:fs in production, memory in tests) so this
module never touches the filesystem itself.
*/
export function filePhase2EvidenceStore(deps: {
  readonly root: string
  readonly readFile: (file: string) => string | undefined
  readonly warn?: ((message: string) => void) | undefined
}): Phase2EvidenceStore {
  const readJson = (kind: 'profile' | 'adoption' | 'embedding', slug: string): unknown => {
    let text: string | undefined
    try {
      text = deps.readFile(phase2EvidenceFile(deps.root, kind, slug))
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

/**
Default CLI/MCP evidence root: the Muse config directory's `judge`
folder, with an explicit `MUSE_JUDGE_EVIDENCE_DIR` override. Pure so
tests can pin every branch, including Windows separators.
*/
export function cliEvidenceRoot(input: {
  readonly evidenceDir: string | undefined
  readonly configHome: string
}): string {
  const override = input.evidenceDir?.trim() ?? ''
  return override === ''
    ? `${input.configHome.replaceAll('\\', '/').replaceAll(/\/+$/g, '')}/muse/${JUDGE_EVIDENCE_DIRNAME}`
    : override
}

/**
Everything a configured-but-clientless binding is built from. The
production factory and the CLI entry share this constructor, so the
reported gap is one code path on every surface; the factory adds live
sides around it when they exist. The adoption record arrives
already-read: the factory reads it beside the sided path, the CLI
reads it at its startup-safe entry, and this stays pure assembly.
*/
export interface ClientlessBindingParts {
  readonly engine: unknown
  /** Raw `museSpark.judge.separate` (CLI `--separate`); empty means single-model. */
  readonly separateId: string | undefined
  /**
  A separate source id is configured but resolves to no live source yet
  (its C/E/J client lane has not landed). The binding still exists so
  the status names the gap instead of silently staying phase-1.
  */
  readonly separateConfigured?: boolean | undefined
  readonly sourceAvailable: boolean
  readonly providerId: string
  readonly modelId: string
  readonly endpoint?: string | undefined
  readonly profileId?: string | undefined
  readonly ownerId?: string | undefined
  readonly turn?: string | number | undefined
  readonly confidential: boolean
  readonly paidConsent: JudgeModeContext['paidConsent']
  readonly readyRate: number | undefined
  readonly minReadyRate: number
  readonly options: JudgeCascadeOptions
  readonly limits: CalibrationLimits
  readonly same?: JudgeCascadeSide | undefined
  readonly adoptionRecord: unknown
  /**
  Adoption check. The runtime defaults it to `hasJudgeAdoptionEvidence`
  when absent; surfaces that can reach the real check (the window
  through its lazy bundle, tests directly) pass it for identical
  Use-layer resolution.
  */
  readonly adoptionCheck?: ((record: unknown, context: JudgeAdoptionContext) => boolean) | undefined
  readonly billing?: JudgeRuntimeBinding['billing']
  readonly attemptCostUsd?: JudgeRuntimeBinding['attemptCostUsd']
  readonly embeddingNote?: JudgeRuntimeBinding['embeddingNote']
  readonly separateGap?: JudgeRuntimeBinding['separateGap']
}

/**
The binding for a configured id with no live separate source: no sides
dispatch, and the resolver names the gap instead of silently staying
phase-1. `undefined` only for true single-model setups, which keep
phase-1 behaviour by design. Pure data assembly; validation stays
downstream in `dist/judgeP2.js`.
*/
export function createClientlessBinding(
  parts: ClientlessBindingParts,
): JudgeRuntimeBinding | undefined {
  // A true single-model setup builds nothing: the surfaces keep exact
  // phase-1 behaviour. Anything else reports its recorded gap.
  const separateId = parts.separateId?.trim() ?? ''
  if (separateId === '' || parts.separateConfigured !== true) return undefined
  return {
    ...(parts.attemptCostUsd !== undefined && { attemptCostUsd: parts.attemptCostUsd }),
    ...(parts.billing !== undefined && { billing: parts.billing }),
    context: {
      engine: parts.engine,
      paidConsent: parts.paidConsent,
      readyRate: parts.readyRate,
      minReadyRate: parts.minReadyRate,
      sourceAvailable: parts.sourceAvailable,
      providerId: parts.providerId,
      modelId: parts.modelId,
      confidential: parts.confidential,
      ...(parts.endpoint !== undefined && { endpoint: parts.endpoint }),
      ...(parts.profileId !== undefined && { profileId: parts.profileId }),
      ...(parts.ownerId !== undefined && { ownerId: parts.ownerId }),
      ...(parts.turn !== undefined && { turn: parts.turn }),
      separate: {
        available: false,
        verified: false,
        profilesReady: false,
        adoption:
          parts.adoptionRecord === undefined
            ? undefined
            : {
                record: parts.adoptionRecord,
                ...(parts.adoptionCheck !== undefined && { check: parts.adoptionCheck }),
                context: {
                  providerId: parts.providerId,
                  modelId: parts.modelId,
                  limits: parts.limits,
                  ...(parts.same?.profile !== undefined && {
                    sameProfile: parts.same.profile,
                  }),
                },
              },
      },
    },
    options: parts.options,
    ...(parts.same !== undefined && { same: parts.same }),
    separateVerified: false,
    // Unknown locality reports remote so confidential workspaces refuse.
    separateLocality: 'remote',
    ...(parts.embeddingNote !== undefined && { embeddingNote: parts.embeddingNote }),
    ...(parts.separateGap !== undefined && { separateGap: parts.separateGap }),
  }
}
