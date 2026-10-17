import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
// License compatibility review (M97, PLAN.md D76): strong and weak
// copyleft, source-available and restricted terms in the shipped set,
// against the project's own licenses. An `OR` alternative is a choice:
// a clean branch means the finding is a confirmation note, never a
// verdict. Permissive combinations with GPL code are never called
// categorically incompatible; every flag carries its version and usage
// evidence and ends with a lawyer, not a ruling.

import type { LegalFindingDraft } from './finding'
import type { EvaluatedDependency } from './depLicenses'
import { excerpt } from './files'
import { orAlternatives } from './spdx'

/** Strong copyleft: distribution can oblige the whole combined work. */
const STRONG_COPYLEFT: ReadonlySet<string> = new Set([
  'GPL-1.0-only',
  'GPL-1.0-or-later',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-1.0-only',
  'AGPL-1.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
])

/** File-level or linking copyleft: obligations stay with covered files. */
const WEAK_COPYLEFT: ReadonlySet<string> = new Set([
  'LGPL-2.0-only',
  'LGPL-2.0-or-later',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MPL-1.0',
  'MPL-1.1',
  'MPL-2.0',
  'EPL-1.0',
  'EPL-2.0',
  'CDDL-1.0',
  'CDDL-1.1',
  'EUPL-1.1',
  'EUPL-1.2',
  'CPL-1.0',
])

/** Source-available or restricted terms: reviewable, never assumed open. */
const RESTRICTED: ReadonlySet<string> = new Set([
  'SSPL-1.0',
  'BUSL-1.1',
  'CC-BY-NC-1.0',
  'CC-BY-NC-2.0',
  'CC-BY-NC-3.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-ND-1.0',
  'CC-BY-NC-ND-2.0',
  'CC-BY-NC-ND-3.0',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-SA-1.0',
  'CC-BY-NC-SA-2.0',
  'CC-BY-NC-SA-3.0',
  'CC-BY-NC-SA-4.0',
  'PolyForm-Noncommercial-1.0.0',
])

/** Permissive grants: choosing one branch ends the copyleft question. */
const PERMISSIVE: ReadonlySet<string> = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-1-Clause',
  '0BSD',
  'BSL-1.0',
  'Zlib',
  'CC0-1.0',
  'Unlicense',
  'WTFPL',
  'Python-2.0',
])

/** A custom reference naming noncommercial or clause terms. */
function isRestrictedReference(id: string): boolean {
  const lower = id.toLowerCase()
  return (
    lower.includes('commons-clause') ||
    lower.includes('noncommercial') ||
    lower.includes('non-commercial')
  )
}

/** The family sets, for the pinned-data cross-check test. */
export function compatibilityFamilies(): {
  readonly strong: ReadonlySet<string>
  readonly weak: ReadonlySet<string>
  readonly restricted: ReadonlySet<string>
  readonly permissive: ReadonlySet<string>
} {
  return {
    strong: STRONG_COPYLEFT,
    weak: WEAK_COPYLEFT,
    restricted: RESTRICTED,
    permissive: PERMISSIVE,
  }
}

function branchKind(
  branch: readonly string[],
  project: ReadonlySet<string>,
): 'clean' | 'strong' | 'weak' | 'restricted' | 'unknown' {
  let kind: 'clean' | 'strong' | 'weak' | 'restricted' | 'unknown' = 'clean'
  for (const id of branch) {
    if (PERMISSIVE.has(id) || project.has(id)) {
      continue
    }
    if (STRONG_COPYLEFT.has(id) || /^(?:A?GPL)-(?:1|2|3)\.0\+?$/.test(id)) {
      return 'strong'
    }
    if (WEAK_COPYLEFT.has(id) || /^LGPL-(?:2\.0|2\.1|3\.0)\+?$/.test(id)) {
      kind = 'weak'
    } else if (RESTRICTED.has(id) || isRestrictedReference(id)) {
      if (kind !== 'weak') {
        kind = 'restricted'
      }
    } else {
      if (kind === 'clean') kind = 'unknown'
    }
  }
  return kind
}

function describeVersion(dep: EvaluatedDependency): string {
  const version = dep.dependency.version
  return version === undefined ? dep.dependency.name : `${dep.dependency.name}@${version}`
}

/**
 * Review evaluated dependencies against the project's licenses. Only
 * known-shipped dependencies can be blockers; anything else is advice or
 * a conditional should-fix, and a clean `OR` branch always softens the
 * finding to a confirmation note.
 */
export function evaluateCompatibility(
  evaluated: readonly EvaluatedDependency[],
  projectLicenses: readonly string[],
): LegalFindingDraft[] {
  const findings: LegalFindingDraft[] = []
  const project = new Set(projectLicenses)

  for (const dep of evaluated) {
    if (!dep.parsed.ok) {
      continue
    }
    const alternatives = orAlternatives(dep.parsed.root, true)
    const kinds = alternatives.map((branch) => branchKind(branch, project))
    if (kinds.every((kind) => kind === 'clean')) {
      continue
    }
    const flagged = [...new Set(alternatives.flat())].filter(
      (id) => !PERMISSIVE.has(id) && !project.has(id),
    )
    if (flagged.length === 0) {
      continue
    }
    const cleanBranch = alternatives.find((branch) => branchKind(branch, project) === 'clean')
    const isShipped = dep.shipped
    const scope = dep.dependency.scope
    const evidence = {
      category: 'dependencyLicense',
      packageName: dep.dependency.name,
      file: dep.dependency.evidenceFile,
      evidenceSource: fill(UI_TEXT.legalScanner.m001, { v0: dep.dependency.evidenceFile }),
      fixable: false,
    } as const

    if (cleanBranch !== undefined) {
      findings.push({
        ...evidence,
        severity: 'advice',
        confidence: 0.5,
        explanation: fill(UI_TEXT.legalScanner.m002, {
          v0: describeVersion(dep),
          v1: cleanBranch.join(' AND '),
          v2: flagged.join(', '),
        }),
        recommendation: UI_TEXT.legalScanner.m003,
        evidenceExcerpt: excerpt(cleanBranch.join(' AND ')),
      })
      continue
    }
    if (kinds.includes('strong') && kinds.includes('weak')) {
      findings.push({
        ...evidence,
        severity: isShipped ? 'should-fix' : 'advice',
        confidence: 0.6,
        explanation: fill(UI_TEXT.legalScanner.m004, {
          v0: describeVersion(dep),
          v1: flagged.join(', '),
        }),
        recommendation: UI_TEXT.legalScanner.m005,
      })
      continue
    }
    if (kinds.every((kind) => kind === 'strong')) {
      if (isShipped) {
        findings.push({
          ...evidence,
          severity: 'blocker',
          confidence: 0.6,
          explanation: fill(UI_TEXT.legalScanner.m006, {
            v0: describeVersion(dep),
            v1: flagged.join(', '),
            v2: projectLicenses.join(', ') || UI_TEXT.legalScanner.noLicense,
          }),
          recommendation: UI_TEXT.legalScanner.m007,
          evidenceExcerpt: excerpt(flagged.join(', ')),
        })
      } else if (scope === 'development') {
        findings.push({
          ...evidence,
          severity: 'advice',
          confidence: 0.6,
          explanation: fill(UI_TEXT.legalScanner.m008, {
            v0: describeVersion(dep),
            v1: flagged.join(', '),
          }),
          recommendation: UI_TEXT.legalScanner.m009,
        })
      } else {
        findings.push({
          ...evidence,
          severity: 'should-fix',
          confidence: 0.6,
          explanation: fill(UI_TEXT.legalScanner.m010, {
            v0: describeVersion(dep),
            v1: flagged.join(', '),
          }),
          recommendation: UI_TEXT.legalScanner.m011,
          evidenceExcerpt: excerpt(flagged.join(', ')),
        })
      }
      continue
    }
    if (kinds.every((kind) => kind === 'weak' || kind === 'clean')) {
      findings.push({
        ...evidence,
        severity: isShipped ? 'should-fix' : 'advice',
        confidence: 0.6,
        explanation: fill(UI_TEXT.legalScanner.m012, {
          v0: describeVersion(dep),
          v1: flagged.join(', '),
          v2: isShipped ? UI_TEXT.legalScanner.shipment : '',
        }),
        recommendation: UI_TEXT.legalScanner.m013,
        evidenceExcerpt: excerpt(flagged.join(', ')),
      })
      continue
    }
    const restricted = flagged.filter((id) => RESTRICTED.has(id) || isRestrictedReference(id))
    if (restricted.length > 0) {
      const isSspl = restricted.includes('SSPL-1.0')
      let severity: 'blocker' | 'should-fix' | 'advice' = 'advice'
      if (isShipped && isSspl) {
        severity = 'blocker'
      } else if (isShipped || scope !== 'development') {
        severity = 'should-fix'
      }
      findings.push({
        ...evidence,
        severity,
        confidence: 0.6,
        explanation: fill(UI_TEXT.legalScanner.m014, {
          v0: describeVersion(dep),
          v1: restricted.join(', '),
          v2: isShipped ? UI_TEXT.legalScanner.shipment : '',
        }),
        recommendation: UI_TEXT.legalScanner.m015,
        evidenceExcerpt: excerpt(restricted.join(', ')),
      })
      continue
    }
    const hasException = flagged.some((id) => id.includes(' WITH '))
    findings.push({
      ...evidence,
      severity: hasException && isShipped ? 'should-fix' : 'advice',
      confidence: 0.5,
      explanation: fill(UI_TEXT.legalScanner.m016, {
        v0: describeVersion(dep),
        v1: flagged.join(', '),
      }),
      recommendation: UI_TEXT.legalScanner.m017,
      evidenceExcerpt: excerpt(flagged.join(', ')),
    })
  }

  return findings
}
