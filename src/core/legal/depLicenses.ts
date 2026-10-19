import { fill } from '../../shared/l10n/text'
import {
  UI_TEXT,
  LEGAL_REVIEW_FILE,
  LEGAL_DEPENDENCIES_MAX,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_VERSION_MAX_CHARS,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
} from '../../shared/constants'
import * as z from 'zod/mini'
import { canonicalLicenseId } from './data'
import type { LegalFileSnapshot } from './files'
// Per-dependency license declarations (M97, PLAN.md D76): malformed
// expressions, unknown or deprecated ids, custom references and
// proprietary markers become findings; absent declarations stay with the
// readers' coverage gaps. Every evaluated dependency keeps its parsed
// alternatives for the compatibility reader.

import { parseJson, type LegalDependency } from './dependencies'
import type { LegalFindingDraft } from './finding'
import { excerpt } from './files'
import { parseSpdxExpression, type SpdxExpression } from './spdx'

/** A dependency with its parsed license expression, for later readers. */
export interface EvaluatedDependency {
  readonly dependency: LegalDependency
  readonly parsed: SpdxExpression
  /** True only when distribution evidence places its material in the shipment. */
  readonly shipped: boolean
}

/** What the dependency-license reader established, for later readers. */
export interface DependencyLicenseResult {
  readonly findings: readonly LegalFindingDraft[]
  readonly evaluated: readonly EvaluatedDependency[]
  readonly incomplete: readonly string[]
  /**
   * True when a dependency's terms need a human read (M97 C-M97-1):
   * proprietary or UNLICENSED markers, custom references, unrecognized
   * ids or unknown exceptions. Deprecated or `+` forms stay recognized
   * advice and do not set this.
   */
  readonly requiresReview: boolean
}

const UNLICENSED = 'UNLICENSED'
const PROPRIETARY_MARK = /^(?:proprietary|commercial)(?:\s+license)?$/i

function proprietaryFinding(
  dep: LegalDependency,
  isShipped: boolean,
  raw: string,
): LegalFindingDraft {
  const base = {
    category: 'dependencyLicense',
    packageName: dep.name,
    evidenceSource: dep.evidenceSource,
    confidence: 0.9,
    fixable: false,
    evidenceExcerpt: excerpt(raw),
  } as const
  if (isShipped) {
    return {
      ...base,
      severity: 'should-fix',
      file: dep.evidenceFile,
      explanation: fill(UI_TEXT.legalScanner.m018, { v0: dep.name, v1: raw }),
      recommendation: UI_TEXT.legalScanner.m019,
    }
  }
  return {
    ...base,
    severity: 'advice',
    file: dep.evidenceFile,
    explanation: fill(UI_TEXT.legalScanner.m020, { v0: dep.name, v1: raw }),
    recommendation: UI_TEXT.legalScanner.m021,
  }
}

/**
Evaluate every dependency's declared license. `isShipped` names the
dependencies distribution evidence places in the shipment; anything
else counts as unshipped, never as clean.
*/
export function evaluateDependencyLicenses(
  dependencies: readonly LegalDependency[],
  isShipped: (dependency: LegalDependency) => boolean,
): DependencyLicenseResult {
  const findings: LegalFindingDraft[] = []
  const evaluated: EvaluatedDependency[] = []
  const incomplete: string[] = []
  let requiresReview = false

  for (const dep of dependencies) {
    const isDoesShip = isShipped(dep)
    const raw = dep.licenseRaw
    if (raw === undefined) {
      incomplete.push(
        fill(UI_TEXT.legalScanner.m022, {
          v0: dep.ecosystem,
          v1: dep.name,
          v2: dep.version ?? UI_TEXT.legalScanner.unresolved,
        }),
      )
      continue
    }
    if (raw === UNLICENSED || PROPRIETARY_MARK.test(raw)) {
      findings.push(proprietaryFinding(dep, isDoesShip, raw === UNLICENSED ? UNLICENSED : raw))
      requiresReview = true
      continue
    }
    const parsed = parseSpdxExpression(raw)
    if (!parsed.ok) {
      // A malformed expression leaves the terms unresolved (M97 CM971R2):
      // the fix report stays should-fix, and the named human-review reason
      // keeps the run from declaring the analysis complete.
      findings.push({
        severity: 'should-fix',
        category: 'dependencyLicense',
        packageName: dep.name,
        file: dep.evidenceFile,
        evidenceSource: dep.evidenceSource,
        confidence: 0.9,
        explanation: fill(UI_TEXT.legalScanner.m023, { v0: dep.name, v1: raw, v2: parsed.error }),
        recommendation: UI_TEXT.legalScanner.m024,
        fixable: false,
        evidenceExcerpt: excerpt(raw),
      })
      requiresReview = true
      incomplete.push(fill(UI_TEXT.legalScanner.m198, { v0: dep.name, v1: raw }))
      continue
    }
    evaluated.push({ dependency: dep, parsed, shipped: isDoesShip })
    const listed1 = parsed.licenses
    for (const license of listed1) {
      const canonical = license.canonicalId ?? (license.custom ? license.id : undefined)
      if (canonical === undefined || license.custom) {
        requiresReview = true
        findings.push({
          severity: 'advice',
          category: 'dependencyLicense',
          packageName: dep.name,
          file: dep.evidenceFile,
          evidenceSource: dep.evidenceSource,
          confidence: 0.7,
          explanation: fill(UI_TEXT.legalScanner.m025, { v0: dep.name, v1: license.id }),
          recommendation: UI_TEXT.legalScanner.m026,
          fixable: false,
          evidenceExcerpt: excerpt(raw),
        })
      } else if (license.deprecated || license.plus) {
        findings.push({
          severity: 'advice',
          category: 'dependencyLicense',
          packageName: dep.name,
          file: dep.evidenceFile,
          evidenceSource: dep.evidenceSource,
          confidence: 0.8,
          explanation: fill(UI_TEXT.legalScanner.m027, { v0: dep.name, v1: license.id }),
          recommendation: UI_TEXT.legalScanner.m028,
          fixable: false,
          evidenceExcerpt: excerpt(raw),
        })
      } else if (license.exception !== undefined && !license.exception.known) {
        requiresReview = true
        findings.push({
          severity: 'advice',
          category: 'dependencyLicense',
          packageName: dep.name,
          file: dep.evidenceFile,
          evidenceSource: dep.evidenceSource,
          confidence: 0.7,
          explanation: fill(UI_TEXT.legalScanner.m029, { v0: dep.name, v1: license.exception.id }),
          recommendation: UI_TEXT.legalScanner.m030,
          fixable: false,
          evidenceExcerpt: excerpt(raw),
        })
      }
    }
  }

  const groups = new Map<string, LegalDependency[]>()
  for (const dep of dependencies) {
    const key = `${dep.ecosystem}:${dep.name}@${dep.version ?? 'unresolved'}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [dep])
    else group.push(dep)
  }
  for (const group of groups.values()) {
    const sources = group.filter((dep) => dep.licenseRaw !== undefined)
    if (new Set(sources.map((dep) => dep.licenseRaw)).size < 2) continue
    const first = sources[0]
    if (first === undefined) continue
    findings.push({
      severity: 'should-fix',
      category: 'dependencyLicense',
      file: first.evidenceFile,
      packageName: first.name,
      ...(first.version !== undefined && { packageVersion: first.version }),
      evidenceSource: sources.map((dep) => dep.evidenceSource).join('; '),
      confidence: 0.8,
      explanation: fill(UI_TEXT.legalScanner.m031, {
        v0: first.name,
        v1: sources
          .map((dep) =>
            fill(UI_TEXT.legalScanner.declaration, {
              file: dep.evidenceFile,
              license: dep.licenseRaw ?? UI_TEXT.legalScanner.unknown,
            }),
          )
          .join('; '),
      }),
      recommendation: UI_TEXT.legalScanner.m032,
      fixable: false,
    })
    incomplete.push(fill(UI_TEXT.legalScanner.m033, { v0: first.name }))
  }
  return { findings, evaluated, incomplete, requiresReview }
}

// CM971R5: a receipt resolves only the reviewed bytes of one exact package
// version. No paths or executable configuration enter this boundary.
const reviewText = z.string().check(z.minLength(1), z.maxLength(LEGAL_TEXT_MAX_CHARS))
const licenceReviewsSchema = z
  .array(
    z.strictObject({
      package: reviewText,
      version: z.string().check(z.minLength(1), z.maxLength(LEGAL_VERSION_MAX_CHARS)),
      sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/u)),
      spdx: reviewText,
      reason: z
        .string()
        .check(
          z.maxLength(LEGAL_EVIDENCE_EXCERPT_MAX_CHARS),
          z.regex(/^[^\p{Cc}\u{2028}\u{2029}]+$/u),
          z.regex(/\S/u),
        ),
    }),
  )
  .check(z.maxLength(LEGAL_DEPENDENCIES_MAX))

type LicenceReview = z.infer<typeof licenceReviewsSchema>[number]

export function readLicenceReviews(
  snapshot: LegalFileSnapshot,
  incomplete: string[],
): readonly LicenceReview[] {
  if (!snapshot.files.includes(LEGAL_REVIEW_FILE)) return []
  const text = snapshot.readFile(LEGAL_REVIEW_FILE)
  const parsed = licenceReviewsSchema.safeParse(text === undefined ? undefined : parseJson(text))
  if (
    !parsed.success ||
    parsed.data.some((entry) => canonicalLicenseId(entry.spdx) !== entry.spdx)
  ) {
    incomplete.push(fill(UI_TEXT.legalScanner.invalidReceipt, { file: LEGAL_REVIEW_FILE }))
    return []
  }
  return parsed.data
}
