// Recorded phase-2 evidence paths and store (M98 P2B).
//
// Deliberately import-light: only the shared constants. The CLI/ACP entry
// (`src/runtime/main.ts`) reads these at startup while keeping judge
// schemas lazy (the dispatch gate trips when `core/judge/schema.ts`
// loads), so nothing here may ever import a judge schema, calibration
// module or the binding factory. Everything judge-shaped stays type-only
// at this layer; validation lives in `dist/judgeP2.js`.

import { JUDGE_EVIDENCE_DIRNAME } from '../../shared/constants'

/** Where recorded phase-2 evidence lives under a surface's storage root. */
export const PHASE2_EVIDENCE_DIR = JUDGE_EVIDENCE_DIRNAME

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
 * Recorded evidence, read from owner storage. Every method returns
 * `undefined` when nothing is recorded; an unreadable or malformed entry
 * is also `undefined`, never a guessed profile. Surfaces implement this
 * over files (`phase2EvidenceFile` builds the path); tests use memory.
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

/** Slug parts are file-name safe, never paths. */
const MAX_SLUG_PART_LENGTH = 96

function sanitizeSlugPart(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return cleaned === '' ? 'unknown' : cleaned.slice(0, MAX_SLUG_PART_LENGTH)
}

/**
 * File name for one recorded artifact. Parts are sanitized so model ids
 * containing `/` or `:` cannot escape their directory on any platform.
 */
export function phase2EvidenceSlug(parts: readonly string[]): string {
  return parts.map((part) => sanitizeSlugPart(part)).join('__')
}

/**
 * Storage path for one recorded artifact, with `/` separators on every
 * platform (callers must normalise before comparing: CI runs on Windows).
 * The measurement lane writes these exact paths; the binding reads them.
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
  const base = bases[kind]
  const rootSlash = root.replaceAll('\\', '/').replaceAll(/\/+$/g, '')
  return `${rootSlash}/${PHASE2_EVIDENCE_DIR}/${base}/${slug}.json`
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
 * Recorded JSON under the evidence root; unreadable stays unrecorded.
 * `readFile` is injected (node:fs in production, memory in tests) so this
 * module never touches the filesystem itself.
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
 * Default CLI/MCP evidence root: the Muse config directory's `judge`
 * folder, with an explicit `MUSE_JUDGE_EVIDENCE_DIR` override. Pure so
 * tests can pin every branch, including Windows separators.
 */
export function cliEvidenceRoot(input: {
  readonly evidenceDir: string | undefined
  readonly configHome: string
}): string {
  const override = input.evidenceDir?.trim() ?? ''
  return override === ''
    ? `${input.configHome.replaceAll('\\', '/').replaceAll(/\/+$/g, '')}/muse/judge`
    : override
}
