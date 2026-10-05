// Per-dependency license declarations (M97, PLAN.md D76): malformed
// expressions, unknown or deprecated ids, custom references and
// proprietary markers become findings; absent declarations stay with the
// readers' coverage gaps. Every evaluated dependency keeps its parsed
// alternatives for the compatibility reader.

import type { LegalDependency } from './dependencies'
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
      explanation: `${dep.name} ships under ${raw} terms: no license grant travels with it.`,
      recommendation:
        'Confirm private ownership of this exact version, or remove it from the shipment.',
    }
  }
  return {
    ...base,
    severity: 'advice',
    file: dep.evidenceFile,
    explanation: `${dep.name} declares ${raw} terms outside the shipped set.`,
    recommendation:
      'Confirm it never ships; a shipped proprietary dependency needs ownership proof.',
  }
}

/**
 * Evaluate every dependency's declared license. `isShipped` names the
 * dependencies distribution evidence places in the shipment; anything
 * else counts as unshipped, never as clean.
 */
export function evaluateDependencyLicenses(
  dependencies: readonly LegalDependency[],
  isShipped: (dependency: LegalDependency) => boolean,
): DependencyLicenseResult {
  const findings: LegalFindingDraft[] = []
  const evaluated: EvaluatedDependency[] = []
  const incomplete: string[] = []

  for (const dep of dependencies) {
    const isDoesShip = isShipped(dep)
    const raw = dep.licenseRaw
    if (raw === undefined) {
      incomplete.push(
        `not checked: ${dep.ecosystem} package ${dep.name}@${dep.version ?? 'unresolved'} has no license evidence`,
      )
      continue
    }
    if (raw === UNLICENSED || PROPRIETARY_MARK.test(raw)) {
      findings.push(proprietaryFinding(dep, isDoesShip, raw === UNLICENSED ? UNLICENSED : raw))
      continue
    }
    const parsed = parseSpdxExpression(raw)
    if (!parsed.ok) {
      findings.push({
        severity: 'should-fix',
        category: 'dependencyLicense',
        packageName: dep.name,
        file: dep.evidenceFile,
        evidenceSource: dep.evidenceSource,
        confidence: 0.9,
        explanation: `${dep.name} declares the license ${raw}, which is not a well-formed SPDX expression: ${parsed.error}.`,
        recommendation:
          'Correct the declaration from the package metadata, or confirm the terms by hand.',
        fixable: false,
        evidenceExcerpt: excerpt(raw),
      })
      continue
    }
    evaluated.push({ dependency: dep, parsed, shipped: isDoesShip })
    const listed1 = parsed.licenses
    for (const license of listed1) {
      const canonical = license.canonicalId ?? (license.custom ? license.id : undefined)
      if (canonical === undefined || license.custom) {
        findings.push({
          severity: 'advice',
          category: 'dependencyLicense',
          packageName: dep.name,
          file: dep.evidenceFile,
          evidenceSource: dep.evidenceSource,
          confidence: 0.7,
          explanation: `${dep.name} declares the custom reference ${license.id}: its terms need a human read.`,
          recommendation:
            'Confirm the referenced license text and its compatibility with the distribution.',
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
          explanation: `${dep.name} declares ${license.id}, a deprecated SPDX identifier form; a trailing + no longer names which later versions apply.`,
          recommendation: 'Use the current -only or -or-later identifier the package intends.',
          fixable: false,
          evidenceExcerpt: excerpt(raw),
        })
      } else if (license.exception !== undefined && !license.exception.known) {
        findings.push({
          severity: 'advice',
          category: 'dependencyLicense',
          packageName: dep.name,
          file: dep.evidenceFile,
          evidenceSource: dep.evidenceSource,
          confidence: 0.7,
          explanation: `${dep.name} declares the exception ${license.exception.id}, which is not on the SPDX exception list.`,
          recommendation: 'Confirm the exception text; an exception changes the analysis.',
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
      explanation: `License evidence conflict for ${first.name}: ${sources.map((dep) => `${dep.evidenceFile} declares ${dep.licenseRaw ?? 'unknown'}`).join('; ')}. No source silently settles the conflict.`,
      recommendation:
        'Review the original license and declarations together before deciding which terms apply.',
      fixable: false,
    })
    incomplete.push(
      `not checked: conflicting license evidence for ${first.name} needs human review`,
    )
  }
  return { findings, evaluated, incomplete }
}
