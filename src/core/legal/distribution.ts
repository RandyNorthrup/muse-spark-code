import { compareLegalText } from './files'
// What actually ships (M97, PLAN.md D76): the distributed file set
// from existing bundle inputs or package inventories, and the notice
// obligations that travel with it. A dev dependency can still ship, so
// scope alone never decides: only material in the shipped set counts.
// Absent or stale build evidence leaves distribution unknown, and the
// scan never rebuilds or packs to obtain it.

import type { EvaluatedDependency } from './depLicenses'
import type { LegalDependency } from './dependencies'
import type { LegalFindingDraft } from './finding'
import type { LegalFileSnapshot } from './files'
import { excerpt, isLegalGlobMatch } from './files'
import { LEGAL_PATH_MAX_CHARS, LEGAL_FINDINGS_MAX } from '../../shared/constants'

/** The distribution evidence a scan may use, all of it optional. */
export interface DistributionEvidence {
  /** Exact bundle inputs (an esbuild metafile's input list), when known. */
  readonly bundleInputs?: readonly string[]
  /** A package manifest's shipped-file allowlist (`files`, PEP 639). */
  readonly packageFiles?: readonly string[]
  /** The raw text of the workspace's `.vscodeignore`, when present. */
  readonly vscodeignoreText?: string
  /** Present notice files and their text, for attribution checks. */
  readonly notices?: readonly { readonly path: string; readonly text: string }[]
}

/** The shipped set: what the obligations are read against. */
export interface ShippedSet {
  /** Dependency names known to ship (material inside the shipped set). */
  readonly shippedNames: ReadonlySet<string>
  /** Production dependencies with no material or no distribution evidence. */
  readonly unknownNames: readonly string[]
  /** One sentence naming what the obligations were read against. */
  readonly summary: string
  readonly incomplete: readonly string[]
}

/** What the notice checks established, for the scan and its report. */
export interface NoticeCheckResult {
  readonly findings: readonly LegalFindingDraft[]
  readonly incomplete: readonly string[]
}

/** Installed material locating a dependency inside the workspace. */
export function materialInSnapshot(snapshot: LegalFileSnapshot, dep: LegalDependency): string[] {
  switch (dep.ecosystem) {
    case 'npm': {
      if (dep.evidenceFile.includes('node_modules/')) {
        const dir = dep.evidenceFile.slice(0, dep.evidenceFile.lastIndexOf('/') + 1)
        return snapshot.files.filter((file) => file.startsWith(dir))
      }
      const files = snapshot.files.filter((file) => file.includes(`node_modules/${dep.name}/`))
      return files
    }
    case 'pip': {
      if (dep.evidenceFile.includes('.dist-info/')) {
        const dir = dep.evidenceFile.slice(0, dep.evidenceFile.lastIndexOf('/') + 1)
        return snapshot.files.filter((file) => file.startsWith(dir))
      }
      const normalized = dep.name.toLowerCase().replaceAll(/[-_.]+/g, '-')
      return snapshot.files.filter((file) => {
        const index = file.indexOf('.dist-info/')
        if (index === -1) {
          return false
        }
        const base = file.slice(0, index).split('/').at(-1) ?? ''
        return base.toLowerCase().startsWith(`${normalized}-`)
      })
    }
    case 'cargo': {
      const version = dep.version === undefined ? '' : `-${dep.version}`
      return snapshot.files.filter(
        (file) => file.includes(`/${dep.name}${version}/`) || file.includes(`vendor/${dep.name}/`),
      )
    }
    case 'go':
    case 'composer': {
      return snapshot.files.filter((file) => file.includes(`vendor/${dep.name}/`))
    }
    case 'gems': {
      return snapshot.files.filter((file) => file.includes(`/gems/${dep.name}-`))
    }
    case 'nuget': {
      return snapshot.files.filter(
        (file) =>
          file.toLowerCase().includes(`packages/${dep.name.toLowerCase()}/`) ||
          file.toLowerCase().includes(`packages/${dep.name.toLowerCase()}.`),
      )
    }
    case 'maven':
    case 'gradle': {
      const artifact = dep.name.split('/', 2)[1] ?? dep.name
      return snapshot.files.filter(
        (file) => file.includes(`/${artifact}/`) || file.includes(`/${artifact}-`),
      )
    }
    default: {
      return []
    }
  }
}

function isSupportedPattern(pattern: string): boolean {
  return pattern.length <= LEGAL_PATH_MAX_CHARS && !/[?\\[{}]/.test(pattern)
}

function compileIgnore(lines: string): {
  readonly matchers: readonly {
    readonly negated: boolean
    readonly test: (file: string) => boolean
  }[]
  readonly unsupported: readonly string[]
} {
  const matchers: { readonly negated: boolean; readonly test: (file: string) => boolean }[] = []
  const unsupported: string[] = []
  for (const line of lines.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!isSupportedPattern(trimmed) || matchers.length >= LEGAL_FINDINGS_MAX) {
      unsupported.push(trimmed)
      continue
    }
    const isNegated = trimmed.startsWith('!')
    const pattern = isNegated ? trimmed.slice(1) : trimmed
    const core = pattern.startsWith('/') ? pattern.slice(1) : pattern
    const body = core.endsWith('/') ? `${core}*` : core
    matchers.push({ negated: isNegated, test: (file) => isLegalGlobMatch(body, file) })
  }
  return { matchers, unsupported }
}

function isAllowlistMatch(pattern: string, file: string): boolean {
  if (!isSupportedPattern(pattern)) return false
  const core = pattern.startsWith('/') ? pattern.slice(1) : pattern
  return core.endsWith('/')
    ? file.startsWith(core)
    : isLegalGlobMatch(core, file) || file.startsWith(`${core}/`)
}

function noticesMention(
  notices: readonly { readonly path: string; readonly text: string }[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  for (const notice of notices) {
    if (notice.text.toLowerCase().includes(lower)) {
      return notice.path
    }
  }
  return undefined
}

/**
 * Work out what ships: the distributed file set from existing bundle
 * inputs or package inventories. Only material in the shipped set counts;
 * scope alone never decides, and a dev dependency can still ship.
 */
export function computeShipped(
  snapshot: LegalFileSnapshot,
  dependencies: readonly LegalDependency[],
  evidence: DistributionEvidence,
): ShippedSet {
  const incomplete: string[] = [
    'not checked: artifact freshness is not established by file-name evidence alone',
  ]
  const fileSet = new Set(snapshot.files)

  let shippedFiles: string[] | undefined
  let summary: string
  if (evidence.bundleInputs !== undefined) {
    shippedFiles = evidence.bundleInputs.filter((file) => fileSet.has(file))
    if (shippedFiles.length !== evidence.bundleInputs.length)
      incomplete.push(
        'not checked: bundle inputs are absent or stale against the workspace inventory',
      )
    summary = `distribution read from ${String(shippedFiles.length)} known bundle inputs`
  } else if (evidence.packageFiles === undefined) {
    summary =
      'source checkout, distribution unknown: no bundle inputs or package inventory evidence'
    incomplete.push(
      'not checked: distribution set unknown (no bundle metafile or package files evidence); shipped obligations assume nothing ships',
    )
  } else {
    const { matchers, unsupported } =
      evidence.vscodeignoreText === undefined
        ? { matchers: [], unsupported: [] }
        : compileIgnore(evidence.vscodeignoreText)
    const allowlist = evidence.packageFiles.slice(0, LEGAL_FINDINGS_MAX)
    if (evidence.packageFiles.length > LEGAL_FINDINGS_MAX)
      incomplete.push('not checked: package pattern count exceeds the bounded inventory')
    if (allowlist.some((pattern) => !isSupportedPattern(pattern)))
      incomplete.push(
        'not checked: package files contains unsupported patterns; distribution is approximate',
      )
    shippedFiles = snapshot.files.filter((file) =>
      allowlist.some((pattern) => isAllowlistMatch(pattern, file)),
    )
    for (const { negated, test } of matchers) {
      if (negated) {
        const listed2 = snapshot.files
        for (const file of listed2) {
          if (test(file) && !shippedFiles.includes(file)) {
            shippedFiles.push(file)
          }
        }
      } else {
        shippedFiles = shippedFiles.filter((file) => !test(file))
      }
    }
    shippedFiles.sort((a, b) => compareLegalText(a, b))
    for (const pattern of unsupported) {
      incomplete.push(
        `not checked: .vscodeignore pattern ${pattern} uses unsupported syntax, so the shipped set is approximate`,
      )
    }
    incomplete.push(
      'not checked: package inventories do not establish embedded bundle inputs or artifact freshness',
    )
    summary =
      'distribution approximated from package files and .vscodeignore; unbuilt artifacts may differ'
  }

  const shippedSet = shippedFiles === undefined ? undefined : new Set(shippedFiles)
  const shippedNames = new Set<string>()
  const unknownNames: string[] = []
  for (const dep of dependencies) {
    if (shippedSet === undefined) {
      unknownNames.push(dep.name)
      continue
    }
    const material = materialInSnapshot(snapshot, dep).filter((file) => shippedSet.has(file))
    if (material.length > 0) {
      shippedNames.add(dep.name)
    } else if (dep.scope === 'production') {
      unknownNames.push(dep.name)
    }
  }

  return { shippedNames, unknownNames, summary, incomplete }
}

/**
 * Check the shipped set's notice obligations. `evaluated` carries
 * canonical license ids per dependency; Apache-2.0 entries with a present
 * upstream NOTICE need attribution, and every shipped dependency needs a
 * notices entry.
 */
export function checkNotices(
  snapshot: LegalFileSnapshot,
  evaluated: readonly EvaluatedDependency[],
  shipped: ShippedSet,
  notices: readonly { readonly path: string; readonly text: string }[],
): NoticeCheckResult {
  const findings: LegalFindingDraft[] = []
  const incomplete: string[] = []
  const { shippedNames, unknownNames } = shipped
  if (shippedNames.size > 0 || unknownNames.length > 0) {
    const unnamed = [...shippedNames, ...unknownNames].filter(
      (name) => noticesMention(notices, name) === undefined,
    )
    if (notices.length === 0) {
      findings.push({
        severity: 'should-fix',
        category: 'noticeFile',
        evidenceSource: 'distribution reader',
        confidence: 0.7,
        explanation: `${String(shippedNames.size + unknownNames.length)} dependencies may ship with no notice file present to attribute them.`,
        recommendation:
          'Add THIRD_PARTY_NOTICES or the equivalent notice file covering the shipped set.',
        fixable: false,
      })
    } else {
      const listed3 = unnamed.toSorted((a, b) => compareLegalText(a, b))
      for (const name of listed3) {
        findings.push({
          severity: 'should-fix',
          category: 'noticeFile',
          evidenceSource: 'distribution reader',
          confidence: 0.6,
          explanation: `${name} may ship but no present notice file names it.`,
          recommendation:
            'Attribute the package in THIRD_PARTY_NOTICES or the equivalent notice file.',
          fixable: false,
        })
      }
    }
  }

  for (const { dependency: dep, parsed } of evaluated) {
    if (!parsed.ok || (!shippedNames.has(dep.name) && !unknownNames.includes(dep.name))) {
      continue
    }
    const isApache = parsed.licenses.some((license) => license.canonicalId === 'Apache-2.0')
    if (!isApache) {
      continue
    }
    const material = materialInSnapshot(snapshot, dep)
    const notice = material
      .filter((file) => /(^|\/)NOTICE(\.[a-z0-9]+)?$/i.test(file))
      .toSorted((a, b) => compareLegalText(a, b))[0]
    if (notice === undefined) continue
    const noticeText = snapshot.readFile(notice)
    if (noticeText === undefined || noticeText.trim() === '') {
      incomplete.push(`not checked: ${notice} has no readable NOTICE attribution`)
      continue
    }
    const normalizedNotice = noticeText.replaceAll(/\s+/g, ' ').trim()
    if (notices.some((entry) => entry.text.replaceAll(/\s+/g, ' ').includes(normalizedNotice)))
      continue

    const noticeExcerpt = { evidenceExcerpt: excerpt(noticeText) }
    findings.push({
      severity: 'should-fix',
      category: 'noticeFile',
      file: notice,
      packageName: dep.name,
      evidenceSource: `distribution reader at ${notice}`,
      confidence: 0.75,
      explanation: `${dep.name} carries an upstream NOTICE file with no attribution in the present notices.`,
      recommendation:
        'Preserve the applicable NOTICE attribution in THIRD_PARTY_NOTICES or the equivalent notice file.',
      fixable: false,
      ...noticeExcerpt,
    })
  }

  return { findings, incomplete }
}
