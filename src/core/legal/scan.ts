import { fingerprint } from '../verify/fingerprint'
import { compareLegalText } from './files'
// The deterministic scan (M97, PLAN.md D76): every reader over one
// bounded snapshot, findings sorted before stable ids are assigned, and
// the lane 0 result schema validating the envelope. Changing only the
// model or backend never changes these facts. An explicit file subset
// limits the per-file header checks; licenses, dependencies and
// distribution stay workspace facts.

import {
  UI_TEXT,
  LEGAL_EXCLUSIONS_MAX,
  LEGAL_FILES_SCANNED_MAX,
  LEGAL_FINDINGS_MAX,
  LEGAL_HEADER_POLICIES,
  LEGAL_INCOMPLETE_MAX,
  LEGAL_RESULT_VERSION,
  LEGAL_SCAN_PATHS_MAX,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_PATH_MAX_CHARS,
  type LegalHeaderPolicy,
} from '../../shared/constants'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import { prepareLegalHeaderPatches } from './headerFix'
import { evaluateCompatibility } from './compat'
import { SPDX_DATA_VERSION } from './data'
import { evaluateDependencyLicenses } from './depLicenses'
import {
  parseJson,
  recordOf,
  type LegalDependency,
  type ManifestLicenseDeclaration,
} from './dependencies'
import {
  checkNotices,
  computeShipped,
  materialInSnapshot,
  type DistributionEvidence,
} from './distribution'
import { readCargo } from './ecosystems/cargo'
import { readComposer } from './ecosystems/composer'
import { readGems } from './ecosystems/gems'
import { readGo } from './ecosystems/go'
import { readJvm } from './ecosystems/jvm'
import { readNpm } from './ecosystems/npm'
import { readNuGet } from './ecosystems/nuget'
import { readPython } from './ecosystems/python'
import type { LegalFindingDraft } from './finding'
import {
  assertWorkspaceRelative,
  baseNameOf,
  isNoticeFileName,
  isLicenseFileName,
  scrubLegalText,
  LegalScanError,
  type LegalFileSnapshot,
} from './files'
import { scanHeaders, scanAttributionRisks } from './headers'
import { scanProjectLicense, identifyLicenseText } from './projectLicense'

/** The rule half of finding ids (`rule/version/counter`). */
export const LEGAL_SCANNER_RULE_VERSION = '1'

/** What one scan runs over: policy, an optional file subset, evidence. */
export interface LegalScanOptions {
  readonly signal?: AbortSignal
  readonly headerPolicy: LegalHeaderPolicy
  /** An explicit per-file subset: limits header checks, not workspace facts. */
  readonly paths?: readonly string[]
  /** Distribution evidence; derived from the snapshot when absent. */
  readonly distribution?: DistributionEvidence
}

function ruleOf(category: string): string {
  switch (category) {
    case 'license': {
      return 'project-license'
    }
    case 'copyrightHeader':
    case 'spdxIdentifier':
    case 'codeQualityHeader': {
      return 'header'
    }
    case 'dependencyLicense': {
      return 'dependency'
    }
    case 'noticeFile': {
      return 'notice'
    }
    default: {
      return 'distribution'
    }
  }
}

function severityRank(severity: string): number {
  switch (severity) {
    case 'blocker': {
      return 0
    }
    case 'should-fix': {
      return 1
    }
    default: {
      return 2
    }
  }
}

function compareDrafts(
  a: { readonly rule: string; readonly finding: LegalFindingDraft },
  b: { readonly rule: string; readonly finding: LegalFindingDraft },
): number {
  return (
    severityRank(a.finding.severity) - severityRank(b.finding.severity) ||
    compareLegalText(a.rule, b.rule) ||
    compareLegalText(a.finding.category, b.finding.category) ||
    compareLegalText(a.finding.file ?? '', b.finding.file ?? '') ||
    compareLegalText(a.finding.packageName ?? '', b.finding.packageName ?? '') ||
    compareLegalText(a.finding.explanation, b.finding.explanation)
  )
}

function subsetSnapshot(
  snapshot: LegalFileSnapshot,
  paths: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
): LegalFileSnapshot {
  if (paths === undefined || paths.length === 0) {
    return {
      files: snapshot.files.filter((file) => allowed.has(file)),
      readFile: (path: string) => (allowed.has(path) ? snapshot.readFile(path) : undefined),
    }
  }
  const selected = snapshot.files.filter(
    (file) =>
      allowed.has(file) && paths.some((path) => file === path || file.startsWith(`${path}/`)),
  )
  return {
    files: [
      ...selected,
      ...snapshot.files.filter(
        (file) =>
          !selected.includes(file) &&
          (baseNameOf(file).toLowerCase() === 'reuse.toml' ||
            file.endsWith('.reuse/dep5') ||
            selected.some((chosen) => file === `${chosen}.license`)),
      ),
    ],
    readFile: (path: string) => (allowed.has(path) ? snapshot.readFile(path) : undefined),
  }
}

/** Notice files present in the snapshot, for attribution checks. */
function snapshotNotices(
  snapshot: LegalFileSnapshot,
): readonly { readonly path: string; readonly text: string }[] {
  const found: { readonly path: string; readonly text: string }[] = []
  const listed1 = snapshot.files
    .filter(
      (file) =>
        isNoticeFileName(baseNameOf(file)) &&
        file
          .split('/')
          .every(
            (segment) =>
              !['node_modules', 'vendor', 'registry', 'packages', 'gems', 'site-packages'].includes(
                segment,
              ),
          ),
    )
    .toSorted((a, b) => compareLegalText(a, b))
  for (const file of listed1) {
    const text = snapshot.readFile(file)
    if (text !== undefined) {
      found.push({ path: file, text })
    }
  }
  return found
}

function deriveDistribution(snapshot: LegalFileSnapshot): DistributionEvidence {
  const text = snapshot.files.includes('package.json')
    ? snapshot.readFile('package.json')
    : undefined
  let packageFiles: string[] | undefined
  if (text !== undefined) {
    try {
      const manifest = recordOf(parseJson(text))
      const files = manifest?.['files']
      if (
        Array.isArray(files) &&
        files.every((entry): entry is string => typeof entry === 'string')
      ) {
        packageFiles = files
      }
    } catch {
      packageFiles = undefined
    }
  }
  const vscodeignoreText = snapshot.files.includes('.vscodeignore')
    ? snapshot.readFile('.vscodeignore')
    : undefined
  return {
    ...(packageFiles !== undefined && { packageFiles }),
    ...(vscodeignoreText !== undefined && { vscodeignoreText }),
    notices: snapshotNotices(snapshot),
  }
}

/**
 * Run the read-only scan over the snapshot. Reads stay inside the capped,
 * sorted file list; paths outside the workspace throw instead of reading.
 * The result always validates against the lane 0 schema: a validation
 * failure is an internal bug and throws.
 */
export function scanLegal(snapshot: LegalFileSnapshot, options: LegalScanOptions): LegalScanResult {
  if (!LEGAL_HEADER_POLICIES.includes(options.headerPolicy)) {
    throw new LegalScanError('Unknown header policy')
  }
  const listed2 = snapshot.files
  for (const file of listed2) {
    assertWorkspaceRelative(file)
  }
  const paths = options.paths ?? []
  if (paths.length > LEGAL_SCAN_PATHS_MAX) throw new LegalScanError('Too many selected paths')
  for (const path of paths) {
    assertWorkspaceRelative(path)
  }

  const sorted = snapshot.files.toSorted((a, b) => compareLegalText(a, b))
  const overCap = sorted.length - LEGAL_FILES_SCANNED_MAX
  const allowed = new Set(overCap > 0 ? sorted.slice(0, LEGAL_FILES_SCANNED_MAX) : sorted)
  const incomplete: string[] = [
    ...(snapshot.incompleteChecks ?? []),
    'not checked: assets, copied code provenance, proprietary terms and complete license-text matching require human review',
  ]
  const cache = new Map<string, string | undefined>()
  let charactersRead = 0
  const bounded: LegalFileSnapshot = {
    files: [...allowed].toSorted((a, b) => compareLegalText(a, b)),
    readFile: (path: string) => {
      if (options.signal?.aborted === true) throw new LegalScanError('Legal scan cancelled')
      if (!allowed.has(path)) return
      if (cache.has(path)) return cache.get(path)
      let text: string | undefined
      try {
        text = snapshot.readFile(path)
      } catch (error) {
        if (error instanceof LegalScanError) throw error
        text = undefined
      }
      if (text === undefined) incomplete.push(`not checked: ${path} cannot be read as text`)
      else if (
        text.length > LEGAL_TEXT_MAX_CHARS * LEGAL_FINDINGS_MAX ||
        charactersRead + text.length > LEGAL_FILES_SCANNED_MAX * LEGAL_EVIDENCE_EXCERPT_MAX_CHARS
      ) {
        incomplete.push(`not checked: ${path} exceeds the bounded text read budget`)
        text = undefined
      } else charactersRead += text.length
      cache.set(path, text)
      return text
    },
  }
  if (options.signal?.aborted === true) throw new LegalScanError('Legal scan cancelled')
  const headerView = subsetSnapshot(bounded, paths.length > 0 ? paths : undefined, allowed)

  if (overCap > 0) {
    incomplete.push(
      `not checked: the scan stopped after reading ${String(LEGAL_FILES_SCANNED_MAX)} files; ${String(overCap)} more not read`,
    )
  }

  const readers = [
    readNpm,
    readPython,
    readCargo,
    readGo,
    readJvm,
    readNuGet,
    readComposer,
    readGems,
  ]
  const dependencies: LegalDependency[] = []
  const manifests: ManifestLicenseDeclaration[] = []
  for (const reader of readers) {
    const result = reader(bounded)
    const remaining = LEGAL_FINDINGS_MAX - dependencies.length
    if (result.dependencies.length > remaining)
      incomplete.push(
        `not checked: dependency evidence bound reached; ${String(result.dependencies.length - remaining)} entries omitted`,
      )
    dependencies.push(...result.dependencies.slice(0, remaining))
    manifests.push(...result.projectLicenses)
    incomplete.push(...result.incomplete)
  }

  const observed: LegalDependency[] = []
  for (const dep of dependencies) {
    const localFiles = materialInSnapshot(bounded, dep).filter((file) =>
      isLicenseFileName(baseNameOf(file)),
    )
    for (const file of localFiles) {
      const text = bounded.readFile(file)
      if (text === undefined) continue
      const match = identifyLicenseText(text)
      if (match === undefined) {
        incomplete.push(`not checked: license text for ${dep.name} at ${file} is unrecognized`)
        continue
      }
      if (dep.licenseRaw !== match.id)
        observed.push({
          ...dep,
          licenseRaw: match.id,
          evidenceFile: file,
          evidenceSource: `license text reader at ${file}`,
        })
    }
  }
  dependencies.push(...observed)
  const project = scanProjectLicense(bounded, manifests)
  incomplete.push(...project.incomplete)

  const headers = scanHeaders(headerView, options.headerPolicy, project.licenses)
  incomplete.push(...headers.incomplete)

  const distributionEvidence = options.distribution ?? deriveDistribution(bounded)
  const evidenceNotices = distributionEvidence.notices ?? []
  const notices = [
    ...evidenceNotices,
    ...snapshotNotices(bounded).filter((notice) =>
      evidenceNotices.every((known) => known.path !== notice.path),
    ),
  ]
  const shipped = computeShipped(bounded, dependencies, distributionEvidence)
  incomplete.push(...shipped.incomplete)

  const licensed = evaluateDependencyLicenses(dependencies, (dep) =>
    shipped.shippedDependencies.has(
      JSON.stringify([dep.ecosystem, dep.name, dep.version, dep.evidenceFile]),
    ),
  )
  incomplete.push(...licensed.incomplete)
  const compat = evaluateCompatibility(licensed.evaluated, project.licenses)

  const noticeCheck = checkNotices(bounded, licensed.evaluated, shipped, notices)
  incomplete.push(...noticeCheck.incomplete)

  const risks = scanAttributionRisks(bounded)
  incomplete.push(...risks.incomplete)
  const findings: { readonly rule: string; readonly finding: LegalFindingDraft }[] = [
    ...risks.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...project.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...headers.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...licensed.findings.map((finding) => ({ rule: 'dependency', finding })),
    ...compat.map((finding) => ({ rule: 'compat', finding })),
    ...noticeCheck.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
  ]
  findings.sort(compareDrafts)

  if (project.licenses.length === 0 && shipped.summary.includes('unknown')) {
    const production = dependencies.filter((dep) => dep.scope === 'production').length
    if (production > 0) {
      findings.push({
        rule: 'distribution',
        finding: {
          severity: 'advice',
          category: 'distribution',
          evidenceSource: 'distribution reader',
          confidence: 0.6,
          explanation: `The distribution set is unknown and ${String(production)} production dependencies exist: obligations are read against an undistributed source checkout.`,
          recommendation:
            'Supply bundle inputs or package inventory evidence so shipped obligations are exact.',
          fixable: false,
        },
      })
      findings.sort(compareDrafts)
    }
  }

  const truncated = findings.length - LEGAL_FINDINGS_MAX
  const kept = truncated > 0 ? findings.slice(0, LEGAL_FINDINGS_MAX) : findings
  if (truncated > 0) {
    incomplete.push(
      `report truncated: ${String(truncated)} findings omitted past the ${String(LEGAL_FINDINGS_MAX)}-finding bound; blockers and should-fix findings kept first`,
    )
  }

  const counters = new Map<string, number>()
  const results = kept.map(({ rule, finding }) => {
    const counter = (counters.get(rule) ?? 0) + 1
    counters.set(rule, counter)
    return {
      ...finding,
      ...Object.fromEntries(
        Object.entries(finding)
          .filter((entry) => typeof entry[1] === 'string')
          .map(([key, value]) => [key, boundedFindingText(key, String(value), incomplete)]),
      ),
      evidenceExcerpt:
        finding.evidenceExcerpt === undefined || finding.evidenceExcerpt === ''
          ? undefined
          : boundedFindingText('evidenceExcerpt', finding.evidenceExcerpt, incomplete),
      id: `${rule}/${LEGAL_SCANNER_RULE_VERSION}/${String(counter)}`,
    }
  })
  results.sort((a, b) => compareLegalText(a.id, b.id))

  const repairable = new Set(
    prepareLegalHeaderPatches(
      bounded,
      results.filter((finding) => finding.fixable),
    ).map((entry) => entry.patch.path),
  )
  for (const finding of results) {
    if (finding.fixable && (finding.file === undefined || !repairable.has(finding.file)))
      finding.fixable = false
  }

  const exclusions = headers.excluded.slice(0, LEGAL_EXCLUSIONS_MAX)
  if (headers.excluded.length > LEGAL_EXCLUSIONS_MAX) {
    incomplete.push(
      `report truncated: ${String(headers.excluded.length - LEGAL_EXCLUSIONS_MAX)} generated exclusions omitted past the bound`,
    )
  }

  const cappedIncomplete =
    incomplete.length > LEGAL_INCOMPLETE_MAX
      ? [
          ...incomplete.slice(0, LEGAL_INCOMPLETE_MAX - 1),
          `and ${String(incomplete.length - LEGAL_INCOMPLETE_MAX + 1)} more unchecked items omitted past the bound`,
        ]
      : incomplete

  const result = {
    disclaimer: UI_TEXT.legalScanDisclaimer,
    version: LEGAL_RESULT_VERSION,
    ruleVersion: LEGAL_SCANNER_RULE_VERSION,
    dataVersion: SPDX_DATA_VERSION,
    scope: scanScope(paths),
    distribution: shipped.summary,
    exclusions: exclusions.map((entry) => scrubLegalText(entry)),
    incompleteChecks: cappedIncomplete.map((entry) =>
      scrubLegalText(entry).slice(0, LEGAL_TEXT_MAX_CHARS),
    ),
    findings: results,
    evidenceFiles: [...cache].flatMap(([path, text]) =>
      text === undefined
        ? []
        : [
            {
              path,
              hash: snapshot.readFileHash?.(path) ?? fingerprint(text),
            },
          ],
    ),
  }
  const scrubbed: unknown = JSON.parse(
    JSON.stringify(result, (_key, value: unknown) =>
      typeof value === 'string' ? scrubLegalText(value) : value,
    ),
  )
  const parsed = legalScanResultSchema.safeParse(scrubbed)
  if (!parsed.success) {
    throw new LegalScanError(`The scan built an invalid result: ${parsed.error.message}`)
  }
  return parsed.data
}

function scanScope(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  return paths.length === 1 ? (paths[0] ?? '') : `${String(paths.length)} selected paths`
}

function boundedFindingText(key: string, value: string, incomplete: string[]): string {
  let limit = LEGAL_TEXT_MAX_CHARS
  if (key === 'file') limit = LEGAL_PATH_MAX_CHARS
  else if (['packageName', 'packageVersion', 'licenseExpression'].includes(key))
    limit = LEGAL_FINDING_ID_MAX_CHARS
  else if (key === 'evidenceExcerpt') limit = LEGAL_EVIDENCE_EXCERPT_MAX_CHARS
  const scrubbed = scrubLegalText(value)
  if (scrubbed.length > limit)
    incomplete.push('not checked: an evidence field exceeds the report bound and was truncated')
  return scrubbed.slice(0, limit)
}
