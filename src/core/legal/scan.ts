import { setImmediate as yieldToHost } from 'node:timers/promises'
import { fill, plural } from '../../shared/l10n/text'
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
  LEGAL_FILE_MAX_BYTES,
  LEGAL_TOTAL_MAX_BYTES,
  LEGAL_FINDINGS_PER_RULE_MAX,
  LEGAL_HEADER_POLICIES,
  LEGAL_INCOMPLETE_MAX,
  LEGAL_RESULT_VERSION,
  LEGAL_SCAN_PATHS_MAX,
  LEGAL_SCAN_YIELD_EVERY,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
  LEGAL_FINDING_ID_MAX_CHARS,
  LEGAL_PATH_MAX_CHARS,
  LEGAL_UNSHIPPED_NAMES_SHOWN,
  LEGAL_DEPENDENCIES_MAX,
  LEGAL_REVIEW_FILE,
  type LegalHeaderPolicy,
} from '../../shared/constants'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import { prepareLegalHeaderPatches } from './headerFix'
import { evaluateCompatibility } from './compat'
import { SPDX_DATA_VERSION } from './data'
import { evaluateDependencyLicenses, readLicenceReviews } from './depLicenses'
import {
  parseJson,
  recordOf,
  type LegalDependency,
  type ManifestLicenseDeclaration,
} from './dependencies'
import * as z from 'zod/mini'
import {
  bundleFreshnessProblems,
  checkNotices,
  computeShipped,
  materialInSnapshot,
  normalizeEvidencePath,
  type BundleEvidence,
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
import { scanHeaders, scanAttributionRisks, projectHeaderGrants } from './headers'
import { licenseTemplateSet } from './licenseTemplates'
import { scanProjectLicense, identifyLicenseText, hasLicenseTextAgreement } from './projectLicense'

/** The rule half of finding ids (`rule/version/counter`). */
export const LEGAL_SCANNER_RULE_VERSION = '1'

/** What one scan runs over: policy, an optional file subset, evidence. */
export interface LegalScanOptions {
  readonly deadline?: number
  readonly signal?: AbortSignal
  readonly headerPolicy: LegalHeaderPolicy
  /** An explicit per-file subset: limits header checks, not workspace facts. */
  readonly paths?: readonly string[]
  /** Distribution evidence; derived from the snapshot when absent. */
  readonly distribution?: DistributionEvidence
}

/**
 * Whether an incomplete entry is a total-absence note (M97 C-M97-1): one
 * per ecosystem reader, each pushed only when that ecosystem leaves no
 * manifests, locks or installed metadata behind. Read from the installed
 * table at call time, never captured at module load, so every language
 * filters the same entries.
 */
function isAbsentEcosystemNote(entry: string): boolean {
  return [
    UI_TEXT.legalScanner.m149,
    UI_TEXT.legalScanner.m155,
    UI_TEXT.legalScanner.m160,
    UI_TEXT.legalScanner.m164,
    UI_TEXT.legalScanner.m170,
    UI_TEXT.legalScanner.m180,
    UI_TEXT.legalScanner.m184,
    UI_TEXT.legalScanner.m196,
  ].includes(entry)
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
    compareLegalText(a.finding.licenseExpression ?? '', b.finding.licenseExpression ?? '')
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

/**
 * Bundle metafiles the production build writes (`dist/meta/`, M26): every
 * source file that went into each shipped bundle. Beside each, the build
 * records the SHA-256 of the exact bytes it compiled and wrote
 * (`dist/meta-hashes/`, record version 2, M97 CM971-R3); a metafile
 * without that record contributes its inputs but never freshness.
 */
const LEGAL_META_DIR = 'dist/meta/'
const LEGAL_META_HASHES_DIR = 'dist/meta-hashes/'
const LEGAL_META_HASHES_VERSION = 2

const keyedRecordSchema = z.record(z.string(), z.unknown())
const hashRecordSchema = z.object({
  version: z.literal(LEGAL_META_HASHES_VERSION),
  inputs: z.record(z.string(), z.string().check(z.regex(/^[0-9a-f]{64}$/u))),
  outputs: z.record(z.string(), z.string().check(z.regex(/^[0-9a-f]{64}$/u))),
  generated: z.optional(z.record(z.string(), z.string().check(z.regex(/^[0-9a-f]{64}$/u)))),
})

function readJson(snapshot: LegalFileSnapshot, file: string): unknown {
  const text = snapshot.readFile(file)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}

/**
 * What a metafile key names (M97 CM971-R3): a workspace file, a module a
 * build plugin generated (`namespace:name`), or a real file outside the
 * workspace (an absolute path or a parent escape), which the scan cannot
 * read and so reports by name instead of treating it as a constant.
 */
function evidencePathKind(entry: string): 'workspace' | 'generated' | 'outside' {
  const normalized = normalizeEvidencePath(entry)
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split('/').includes('..')
  )
    return 'outside'
  return normalized === '' || /^\(?[a-z][\w-]*\)?:/iu.test(normalized) ? 'generated' : 'workspace'
}

/** The workspace entries of a metafile key list, normalized. */
function workspaceEntries(list: readonly string[]): string[] {
  return list
    .filter((entry) => evidencePathKind(entry) === 'workspace')
    .map((entry) => normalizeEvidencePath(entry))
}

/**
 * The inputs that ship (CM971-R3): those an output carries bytes of
 * (esbuild's `outputs[…].inputs[…].bytesInOutput`); an input the bundler
 * read but shook out entirely does not ship. A record whose outputs do
 * not itemize their inputs counts every listed input.
 */
function contributingInputs(outputs: unknown, listed: readonly string[]): string[] {
  const records = Object.values(keyedRecordSchema.safeParse(outputs).data ?? {})
  const itemized = records.map(
    (record) =>
      keyedRecordSchema.safeParse(keyedRecordSchema.safeParse(record).data?.['inputs']).data,
  )
  if (itemized.length === 0 || itemized.includes(undefined)) return [...listed]
  const carried = new Set<string>()
  for (const entries of itemized) {
    const pairs = Object.entries(entries ?? {})
    for (const [input, detail] of pairs) {
      const bytes: unknown = keyedRecordSchema.safeParse(detail).data?.['bytesInOutput']
      if (typeof bytes !== 'number' || bytes > 0) carried.add(normalizeEvidencePath(input))
    }
  }
  return listed.filter((input) => carried.has(input))
}

function deriveBundleEvidence(snapshot: LegalFileSnapshot): {
  readonly bundleInputs: string[]
  readonly bundles: BundleEvidence[]
} {
  const inputs = new Set<string>()
  const bundles: BundleEvidence[] = []
  const metafiles = snapshot.files
    .filter((file) => file.startsWith(LEGAL_META_DIR) && file.endsWith('.json'))
    .toSorted((a, b) => compareLegalText(a, b))
  for (const metafile of metafiles) {
    const parsed = keyedRecordSchema.safeParse(readJson(snapshot, metafile)).data
    if (parsed === undefined) continue
    const metaInputs = Object.keys(keyedRecordSchema.safeParse(parsed['inputs']).data ?? {})
    const metaOutputs = Object.keys(keyedRecordSchema.safeParse(parsed['outputs']).data ?? {})
    const listed = [...metaInputs, ...metaOutputs]
    if (listed.length === 0) continue
    const name = metafile.slice(LEGAL_META_DIR.length, -'.json'.length)
    const hashes = hashRecordSchema.safeParse(
      readJson(snapshot, `${LEGAL_META_HASHES_DIR}${name}.json`),
    ).data
    const bundleInputs = workspaceEntries(metaInputs)
    const carried = contributingInputs(parsed['outputs'], bundleInputs)
    for (const input of carried) inputs.add(input)
    bundles.push({
      name,
      inputs: bundleInputs,
      outputs: workspaceEntries(metaOutputs),
      outside: listed.filter((entry) => evidencePathKind(entry) === 'outside'),
      generated: metaInputs.filter((entry) => evidencePathKind(entry) === 'generated'),
      ...(hashes !== undefined && {
        inputHashes: hashes.inputs,
        outputHashes: hashes.outputs,
        generatedHashes: hashes.generated ?? {},
      }),
    })
  }
  return { bundleInputs: [...inputs].toSorted((a, b) => compareLegalText(a, b)), bundles }
}

const LICENSE_POINTER = /^SEE LICENSE IN\s+(\S.*)$/iu
const LICENSE_FILE_FIELD = /^License-File:\s*(\S.*?)\s*$/gimu

/**
 * Licence files a dependency's metadata names (M97 CM971-R3): the text a
 * reader identified the licence from, an npm-style `SEE LICENSE IN`
 * target, and a Python distribution's `License-File:` entries, each
 * resolved beside its manifest and kept only when present and confined.
 */
function namedLicenseFiles(snapshot: LegalFileSnapshot, dep: LegalDependency): string[] {
  const dir = dep.evidenceFile.slice(0, dep.evidenceFile.lastIndexOf('/') + 1)
  const named: string[] = []
  if (dep.licenseTextFile !== undefined) named.push(dep.licenseTextFile)
  const pointer = LICENSE_POINTER.exec(dep.licenseRaw ?? '')?.[1]?.trim()
  if (pointer !== undefined) named.push(`${dir}${pointer}`)
  if (dep.evidenceFile.endsWith('.dist-info/METADATA')) {
    const metadata = snapshot.readFile(dep.evidenceFile) ?? ''
    for (const match of metadata.matchAll(LICENSE_FILE_FIELD)) {
      const value = match[1] ?? ''
      named.push(`${dir}licenses/${value}`, `${dir}${value}`)
    }
  }
  const present = new Set(snapshot.files)
  return named
    .map((file) => normalizeEvidencePath(file))
    .filter((file) => present.has(file) && !file.split('/').includes('..'))
}

/**
 * Every build-evidence problem of a workspace's bundle records, unbounded
 * (M97 CM971-R3): what the release build checks of its own records, so no
 * reason can hide past the report's incomplete-check bound.
 */
export function buildRecordProblems(snapshot: LegalFileSnapshot): readonly string[] {
  const { bundles } = deriveBundleEvidence(snapshot)
  return bundleFreshnessProblems(snapshot, new Set(snapshot.files), bundles)
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
  const bundle = deriveBundleEvidence(snapshot)
  const hasBundles = bundle.bundles.length > 0
  return {
    ...(hasBundles && { bundleInputs: bundle.bundleInputs, bundles: bundle.bundles }),
    ...(packageFiles !== undefined && { packageFiles }),
    ...(vscodeignoreText !== undefined && { vscodeignoreText }),
  }
}

/**
 * Run the read-only scan over the snapshot. Reads stay inside the capped,
 * sorted file list; paths outside the workspace throw instead of reading.
 * The result always validates against the lane 0 schema: a validation
 * failure is an internal bug and throws.
 */
export async function scanLegal(
  snapshot: LegalFileSnapshot,
  options: LegalScanOptions,
): Promise<LegalScanResult> {
  if (!LEGAL_HEADER_POLICIES.includes(options.headerPolicy)) {
    throw new LegalScanError(UI_TEXT.legalScanner.m108)
  }
  let sinceYield = 0
  const checkYield = async (): Promise<void> => {
    sinceYield += 1
    if (sinceYield < LEGAL_SCAN_YIELD_EVERY) return
    sinceYield = 0
    // Let a Stop/SIGINT abort land mid-scan (PR #214 review): the scan is
    // CPU-bound over thousands of files on one thread, so without a yield
    // the abort below could only have arrived before the scan started.
    await yieldToHost()
    if (options.signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
  }
  const listed2 = snapshot.files
  for (const file of listed2) {
    assertWorkspaceRelative(file)
    await checkYield()
  }
  const paths = options.paths ?? []
  if (paths.length > LEGAL_SCAN_PATHS_MAX) throw new LegalScanError(UI_TEXT.legalScanner.m109)
  for (const path of paths) {
    assertWorkspaceRelative(path)
    await checkYield()
  }

  const sorted = snapshot.files.toSorted((a, b) => compareLegalText(a, b))
  // Root facts and build records precede general walk noise; every file is
  // admitted, however many the workspace holds (NOLIMITS4: no file-count stop).
  const buildFacts = sorted.filter(
    (file) => file.startsWith(LEGAL_META_DIR) || file.startsWith(LEGAL_META_HASHES_DIR),
  )
  const rootFacts = sorted.filter(
    (file) =>
      !file.includes('/') &&
      (isLicenseFileName(file) ||
        isNoticeFileName(file) ||
        /^(?:README|package|npm-shrinkwrap|yarn|pnpm-lock|pyproject|requirements|setup|uv|poetry|Cargo|go|pom|build\.gradle|gradle\.lockfile|packages\.lock|project\.assets|composer|Gemfile|REUSE|\.vscodeignore)(?:[.-]|$)|\.(?:gemspec|nuspec|[cfv]sproj)$/iu.test(
          file,
        )),
  )
  const facts = [...buildFacts, ...rootFacts]
  const priority = new Set(facts)
  const admission = [...facts, ...sorted.filter((file) => !priority.has(file))]
  const allowed = new Set(admission)
  // The human-review caveat (M97 C-M97-1) is earned, not blanket: it is
  // added below only when a license text stayed heuristic or unrecognized,
  // an asset or source reference needs provenance, or dependency terms
  // need a human read. A fully evidenced scan exits without it.
  const incomplete: string[] = [...(snapshot.incompleteChecks ?? [])]
  const cache = new Map<string, string | undefined>()
  let bytesRead = 0
  // A deadline only when the caller names one: unnamed, the scan reads
  // until it is done or the signal aborts (owner 2026-10-16: no arbitrary
  // limits), never stopping at an invented 120 s.
  const deadline = options.deadline
  let isTimedOut = false
  const bounded: LegalFileSnapshot = {
    get files() {
      return [...allowed].toSorted((a, b) => compareLegalText(a, b))
    },
    readFile: (path: string) => {
      if (options.signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
      if (deadline !== undefined && Date.now() >= deadline) {
        if (!isTimedOut) incomplete.push(UI_TEXT.legalScanner.m112)
        isTimedOut = true
        return
      }
      if (!allowed.has(path)) return
      if (cache.has(path)) return cache.get(path)
      let text: string | undefined
      try {
        text = snapshot.readFile(path)
      } catch (error) {
        if (error instanceof LegalScanError) throw error
        text = undefined
      }
      if (text === undefined) incomplete.push(fill(UI_TEXT.legalScanner.m113, { v0: path }))
      else if (
        new TextEncoder().encode(text).byteLength > LEGAL_FILE_MAX_BYTES ||
        bytesRead + new TextEncoder().encode(text).byteLength > LEGAL_TOTAL_MAX_BYTES
      ) {
        incomplete.push(fill(UI_TEXT.legalScanner.m114, { v0: path }))
        text = undefined
      } else bytesRead += new TextEncoder().encode(text).byteLength
      cache.set(path, text)
      return text
    },
    // Admitted-bytes digests travel with the bounded view (M97 CM971-R3),
    // so freshness compares the same bytes, byte-order mark included,
    // that the build hashed.
    // Hash reads (text or binary) are admitted by the snapshot itself.
    ...(snapshot.readFileHash !== undefined && {
      readFileHash: (path: string) => {
        if (options.signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
        return allowed.has(path) && (deadline === undefined || Date.now() < deadline)
          ? snapshot.readFileHash?.(path)
          : undefined
      },
    }),
  }
  const templates = licenseTemplateSet()
  if (templates.problems.length > 0)
    incomplete.push(fill(UI_TEXT.legalScanner.m205, { v0: templates.problems.join(', ') }))
  if (options.signal?.aborted === true) throw new LegalScanError(UI_TEXT.legalScanner.m111)
  // Scan scope (lead ruling 2026-10-10): with distribution known, the
  // readers judge the distributed workspace: root files (manifests, locks,
  // licence and notice files), the shipped files and the admitted files of
  // each shipped package. Test fixtures and other undistributed files stay
  // out; with distribution unknown, the whole workspace counts.
  const distributionEvidence = options.distribution ?? deriveDistribution(bounded)
  // Once the bounded records name their material, reserve the remaining
  // slots for that evidence before admitting the general walk. Never read
  // outside the unchanged file/byte/deadline budgets.
  const listedMaterial = [
    ...(distributionEvidence.bundleInputs ?? []),
    ...(distributionEvidence.bundles ?? []).flatMap((bundle) => [
      ...bundle.inputs,
      ...bundle.outputs,
    ]),
  ].map((file) => normalizeEvidencePath(file))
  const packageRoots = new Set(
    listedMaterial.flatMap((file) => {
      const root = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+\/)/u.exec(file)?.[1]
      return root === undefined ? [] : [root]
    }),
  )
  const packageFacts = sorted.filter((file) =>
    [...packageRoots].some((root) => file.startsWith(root)),
  )
  const presentFiles = new Set(sorted)
  const material = new Set([
    ...cache.keys(),
    ...buildFacts,
    ...listedMaterial,
    ...rootFacts,
    ...packageFacts,
  ])
  // No file-count stop (NOLIMITS4): the prioritized order is kept, but every
  // present file stays admitted, however many the workspace holds.
  const prioritized = [...material, ...sorted.filter((file) => !material.has(file))].filter(
    (file) => presentFiles.has(file),
  )
  allowed.clear()
  for (const file of prioritized) allowed.add(file)
  const view = distributedView(bounded, distributionEvidence)
  // Header policy covers the project's own sources, never installed packages.
  const ownFiles = new Set(view.files.filter((file) => !file.includes(NODE_MODULES_SEGMENT)))
  const headerView = subsetSnapshot(view, paths.length > 0 ? paths : undefined, ownFiles)

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
  const readerResults = []
  for (const reader of readers) {
    await checkYield()
    const result = reader(view)
    const remaining = LEGAL_DEPENDENCIES_MAX - dependencies.length
    if (result.dependencies.length > remaining)
      incomplete.push(
        plural(UI_TEXT.legalScanner.m116, result.dependencies.length - remaining, {
          v0: result.dependencies.length - remaining,
        }),
      )
    dependencies.push(...result.dependencies.slice(0, remaining))
    manifests.push(...result.projectLicenses)
    readerResults.push({ reader, result })
  }

  // Scan scope (lead ruling 2026-10-10): a workspace scan judges what the
  // workspace distributes. Distribution comes from the build records (or
  // the package's files list); a dependency that provably does not ship is
  // informational and never makes the scan incomplete. With distribution
  // unknown, every dependency is judged as if it ships.
  const preShipped = computeShipped(bounded, dependencies, distributionEvidence)
  const observedReviewed = new Set<LegalDependency>()
  const isReviewed = (dep: LegalDependency): boolean =>
    observedReviewed.has(dep) ||
    preShipped.shippedFiles === undefined ||
    preShipped.shippedDependencies.has(
      JSON.stringify([dep.ecosystem, dep.name, dep.version, dep.evidenceFile]),
    )
  for (const { reader, result } of readerResults) {
    const scoped = preShipped.shippedFiles === undefined ? result : reader(view, isReviewed)
    incomplete.push(...scoped.incomplete.filter((entry) => !isAbsentEcosystemNote(entry)))
  }
  const reviews = readLicenceReviews(bounded, incomplete)
  const receiptFindings = new Map<string, LegalFindingDraft>()
  const informational = new Set<string>()
  const observed: LegalDependency[] = []
  let hasUnrecognizedLicenseText = false
  for (const dep of dependencies) {
    const isDependencyReviewed = isReviewed(dep)
    // Every licence text the dependency carries or names (M97 CM971-R3):
    // standard licence file names in its material, plus any file its
    // metadata points at (`license-file`, `SEE LICENSE IN`,
    // `License-File:`), so a renamed text keeps its exactness check.
    const localFiles = [
      ...new Set([
        ...materialInSnapshot(bounded, dep).filter((file) => isLicenseFileName(baseNameOf(file))),
        ...namedLicenseFiles(bounded, dep),
      ]),
    ]
    for (const file of localFiles) {
      await checkYield()
      const text = bounded.readFile(file)
      if (text === undefined) continue
      const match = identifyLicenseText(text)
      if (!isDependencyReviewed) {
        if (match?.exact !== true) informational.add(dep.name)
        continue
      }
      if (match === undefined) {
        incomplete.push(fill(UI_TEXT.legalScanner.m117, { v0: dep.name, v1: file }))
        hasUnrecognizedLicenseText = true
        continue
      }
      // A text that does not match exactly keeps the human-review
      // limitation (M97 CM971R2): a heuristic reading never silently
      // adopts possibly modified terms. Agreeing ids keep the declared
      // terms under review; disagreeing ids still surface through the
      // observed relabel, so genuine conflicts stay visible as conflicts.
      if (!match.exact) {
        const hash =
          bounded.readFileHash === undefined ? fingerprint(text) : bounded.readFileHash(file)
        const receipt = reviews.find(
          (entry) =>
            entry.package === dep.name &&
            entry.version === dep.version &&
            entry.sha256 === hash &&
            entry.spdx === match.id &&
            dep.licenseRaw === match.id,
        )
        if (receipt !== undefined) {
          receiptFindings.set(JSON.stringify([dep.name, dep.version, file]), {
            severity: 'advice',
            category: 'dependencyLicense',
            packageName: dep.name,
            packageVersion: receipt.version,
            licenseExpression: receipt.spdx,
            file,
            evidenceSource: LEGAL_REVIEW_FILE,
            confidence: 1,
            fixable: false,
            explanation: fill(UI_TEXT.legalScanner.reviewedReceipt, { reason: receipt.reason }),
            recommendation: UI_TEXT.legalScanner.receiptRenew,
          })
          continue
        }
        incomplete.push(fill(UI_TEXT.legalScanner.m199, { v0: dep.name, v1: file }))
        hasUnrecognizedLicenseText = true
        if (hasLicenseTextAgreement(dep.licenseRaw, match.id)) continue
      }
      if (hasLicenseTextAgreement(dep.licenseRaw, match.id)) continue
      const observation = {
        ...dep,
        licenseRaw: match.id,
        evidenceFile: file,
        evidenceSource: fill(UI_TEXT.legalScanner.m118, { v0: file }),
      }
      observed.push(observation)
      observedReviewed.add(observation)
    }
  }
  dependencies.push(...observed)
  const project = scanProjectLicense(view, manifests, projectHeaderGrants(view))
  incomplete.push(...project.incomplete)

  const headers = scanHeaders(headerView, options.headerPolicy, project.licenses)
  incomplete.push(...headers.incomplete)

  const evidenceNotices = distributionEvidence.notices ?? []
  const notices = [
    ...evidenceNotices,
    ...snapshotNotices(bounded).filter((notice) =>
      evidenceNotices.every((known) => known.path !== notice.path),
    ),
  ]
  const shipped = computeShipped(bounded, dependencies, distributionEvidence)
  incomplete.push(...shipped.incomplete)

  const isShipped = (dep: LegalDependency): boolean =>
    shipped.shippedDependencies.has(
      JSON.stringify([dep.ecosystem, dep.name, dep.version, dep.evidenceFile]),
    )
  const licensed = evaluateDependencyLicenses(
    dependencies.filter((dep) => isReviewed(dep)),
    isShipped,
  )
  incomplete.push(...licensed.incomplete)
  // Dependencies that do not ship: their declarations stay visible as
  // advice, and their gaps are not the scan's.
  const unshipped = evaluateDependencyLicenses(
    dependencies.filter((dep) => !isReviewed(dep)),
    isShipped,
  )
  const evaluated = [...licensed.evaluated, ...unshipped.evaluated]
  const compat = evaluateCompatibility(evaluated, project.licenses)

  const noticeCheck = checkNotices(bounded, evaluated, shipped, notices)
  incomplete.push(...noticeCheck.incomplete)

  const risks = scanAttributionRisks(view)
  incomplete.push(...risks.incomplete)
  if (
    hasUnrecognizedLicenseText ||
    licensed.requiresReview ||
    risks.findings.length > 0 ||
    project.requiresReview ||
    templates.problems.length > 0
  ) {
    incomplete.push(UI_TEXT.legalScanner.m110)
  }
  const findings: { readonly rule: string; readonly finding: LegalFindingDraft }[] = [
    ...risks.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...project.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...headers.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
    ...licensed.findings.map((finding) => ({ rule: 'dependency', finding })),
    ...Array.from(receiptFindings.values(), (finding) => ({ rule: 'receipt', finding })),
    ...unshippedFindings(unshipped.findings, informational).map((finding) => ({
      rule: 'dependency',
      finding,
    })),
    ...compat.map((finding) => ({ rule: 'compat', finding })),
    ...noticeCheck.findings.map((finding) => ({ rule: ruleOf(finding.category), finding })),
  ]
  findings.sort(compareDrafts)

  if (project.licenses.length === 0 && shipped.shippedFiles === undefined) {
    const production = dependencies.filter((dep) => dep.scope === 'production').length
    if (production > 0) {
      findings.push({
        rule: 'distribution',
        finding: {
          severity: 'advice',
          category: 'distribution',
          evidenceSource: UI_TEXT.legalScanner.m045,
          confidence: 0.6,
          explanation: plural(UI_TEXT.legalScanner.m119, production, { v0: production }),
          recommendation: UI_TEXT.legalScanner.m120,
          fixable: false,
        },
      })
      findings.sort(compareDrafts)
    }
  }

  // Report bounds. Omitted blockers or should-fix findings make the scan
  // incomplete; omitted advice does not (the facts are complete, only the
  // list is shortened), so it is summarized per rule instead (CM971-R3).
  const perRule = new Map<string, number>()
  const omittedAdvice = new Map<string, number>()
  const omit = (rule: string, finding: LegalFindingDraft, reason: string): void => {
    if (rule !== 'receipt' && finding.severity === 'advice')
      omittedAdvice.set(rule, (omittedAdvice.get(rule) ?? 0) + 1)
    else if (!incomplete.includes(reason)) incomplete.push(reason)
  }
  const withinRules = findings.filter(({ rule, finding }) => {
    const count = (perRule.get(rule) ?? 0) + 1
    perRule.set(rule, count)
    if (count <= LEGAL_FINDINGS_PER_RULE_MAX) return true
    omit(rule, finding, fill(UI_TEXT.legalScanner.m121, { v0: rule }))
    return false
  })
  incomplete.push(
    ...(snapshot.incompleteChecks ?? []).filter((entry) => !incomplete.includes(entry)),
  )
  if (
    deadline !== undefined &&
    Date.now() >= deadline &&
    !incomplete.includes('scan stopped at limit: elapsed time')
  )
    incomplete.push(UI_TEXT.legalScanner.m112)
  // No whole-report truncation past a finding count (B18): every finding
  // the per-rule bound above admits is kept, whatever the report's size.
  // Omitted advice is still summarized per rule (CM971-R3).
  const kept = withinRules
  for (const [rule, count] of omittedAdvice) {
    kept.push({
      rule,
      finding: {
        severity: 'advice',
        category: SUMMARY_CATEGORY[rule] ?? 'distribution',
        evidenceSource: UI_TEXT.legalScanner.m045,
        confidence: 1,
        explanation: plural(UI_TEXT.legalScanner.m209, count, { v0: rule }),
        recommendation: UI_TEXT.legalScanner.m210,
        fixable: false,
      },
    })
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
      plural(UI_TEXT.legalScanner.m123, headers.excluded.length - LEGAL_EXCLUSIONS_MAX, {
        v0: headers.excluded.length - LEGAL_EXCLUSIONS_MAX,
      }),
    )
  }

  const cappedIncomplete =
    incomplete.length > LEGAL_INCOMPLETE_MAX
      ? [
          ...incomplete.slice(0, LEGAL_INCOMPLETE_MAX - 1),
          plural(UI_TEXT.legalScanner.moreUnchecked, incomplete.length - LEGAL_INCOMPLETE_MAX + 1, {
            count: incomplete.length - LEGAL_INCOMPLETE_MAX + 1,
          }),
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
    throw new LegalScanError(fill(UI_TEXT.legalScanner.m124, { v0: parsed.error.message }))
  }
  return parsed.data
}

/**
 * Findings about dependencies that do not ship (lead ruling 2026-10-10):
 * informational advice, plus one advice line naming those whose licence
 * texts differ from their templates or are unrecognized.
 */
/**
 * The distributed workspace (CM971-R3): root files, the shipped files and
 * the admitted files of each shipped package; the whole snapshot when
 * distribution is unknown.
 */
function distributedView(
  snapshot: LegalFileSnapshot,
  evidence: DistributionEvidence,
): LegalFileSnapshot {
  const shippedFiles = computeShipped(snapshot, [], evidence).shippedFiles
  if (shippedFiles === undefined) return snapshot
  const packages = new Set<string>()
  for (const file of shippedFiles) {
    const at = file.lastIndexOf(NODE_MODULES_SEGMENT)
    if (at === -1) continue
    const [scope = '', name = ''] = file.slice(at + NODE_MODULES_SEGMENT.length).split('/', 2)
    const head = file.slice(0, at + NODE_MODULES_SEGMENT.length)
    packages.add(`${head}${scope.startsWith('@') ? `${scope}/${name}` : scope}/`)
  }
  const kept = new Set(
    snapshot.files.filter(
      (file) =>
        !file.includes('/') ||
        shippedFiles.has(file) ||
        [...packages].some((directory) => file.startsWith(directory)),
    ),
  )
  return {
    files: snapshot.files.filter((file) => kept.has(file)),
    readFile: (path: string) => (kept.has(path) ? snapshot.readFile(path) : undefined),
    ...(snapshot.readFileHash !== undefined && {
      readFileHash: (path: string) => (kept.has(path) ? snapshot.readFileHash?.(path) : undefined),
    }),
  }
}

const NODE_MODULES_SEGMENT = 'node_modules/'

/** The finding category an omitted-advice summary carries, per rule. */
const SUMMARY_CATEGORY: Readonly<Record<string, LegalFindingDraft['category']>> = {
  header: 'codeQualityHeader',
  'project-license': 'license',
  dependency: 'dependencyLicense',
  compat: 'dependencyLicense',
  notice: 'noticeFile',
}

function unshippedFindings(
  findings: readonly LegalFindingDraft[],
  informational: ReadonlySet<string>,
): LegalFindingDraft[] {
  const advice = findings.map((finding) => ({ ...finding, severity: 'advice' as const }))
  if (informational.size === 0) return advice
  const names = [...informational].toSorted((a, b) => compareLegalText(a, b))
  return [
    ...advice,
    {
      severity: 'advice',
      category: 'dependencyLicense',
      evidenceSource: UI_TEXT.legalScanner.m045,
      confidence: 1,
      explanation: plural(UI_TEXT.legalScanner.m207, names.length, {
        v0: names.slice(0, LEGAL_UNSHIPPED_NAMES_SHOWN).join(', '),
      }),
      recommendation: UI_TEXT.legalScanner.m208,
      fixable: false,
    },
  ]
}

function scanScope(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  return paths.length === 1
    ? (paths[0] ?? '')
    : plural(UI_TEXT.legalScanner.selectedPaths, paths.length, { count: paths.length })
}

function boundedFindingText(key: string, value: string, incomplete: string[]): string {
  let limit = LEGAL_TEXT_MAX_CHARS
  if (key === 'file') limit = LEGAL_PATH_MAX_CHARS
  else if (['packageName', 'packageVersion', 'licenseExpression'].includes(key))
    limit = LEGAL_FINDING_ID_MAX_CHARS
  else if (key === 'evidenceExcerpt') limit = LEGAL_EVIDENCE_EXCERPT_MAX_CHARS
  const scrubbed = scrubLegalText(value)
  if (scrubbed.length > limit) incomplete.push(UI_TEXT.legalScanner.m125)
  return scrubbed.slice(0, limit)
}
