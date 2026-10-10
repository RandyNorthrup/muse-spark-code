import { fill, plural } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
const UNKNOWN_TEXT_CONFIDENCE = 0.5
import { compareLegalText } from './files'
// The project's own license declarations (M97, PLAN.md D76): LICENSE
// and COPYING files read as license texts, the manifests' license fields
// (collected by the ecosystem readers, which already parse them), and the
// README's license section. Evidence that disagrees is reported as a
// conflict, never resolved silently; a text no pattern recognizes stays
// unknown with its excerpt preserved.

import type { ManifestLicenseDeclaration } from './dependencies'
import type { LegalFindingDraft } from './finding'
import type { LegalFileSnapshot } from './files'
import { BYTE_ORDER_MARK_CODE } from './files'
import {
  baseNameOf,
  hasBinaryContent,
  dirNameOf,
  excerpt,
  isLicenseFileName,
  topLines,
} from './files'
import { canonicalLicenseId, canonicalExceptionId, SPDX_LICENSE_TEXTS } from './data'
import type { SpdxLicenseTextRecord } from './data'
import { fingerprint } from '../verify/fingerprint'
import { parseSpdxExpression, type SpdxNode } from './spdx'

/** What the project-license reader established, for later readers. */
export interface ProjectLicenseResult {
  readonly findings: readonly LegalFindingDraft[]
  /** Canonical license ids the project declares (files first, else manifests). */
  readonly licenses: readonly string[]
  readonly incomplete: readonly string[]
}

/** A license text's best reading and its confidence. */
export interface LicenseTextMatch {
  readonly id: string
  readonly confidence: number
  /**
   * True only when the whole text matches the pinned canonical text
   * byte-for-byte after normalization (M97 C-M97-1): heuristic title and
   * clause readings keep `false` and stay covered by the named
   * full-matching incomplete reason.
   */
  readonly exact: boolean
  /**
   * Set when the text covers every distinctive phrase of a pinned record
   * without matching its hash (M97 CM971R2): the text reads as that
   * license with modified terms, never as exact. `extraWords` is the
   * normalized word-count delta against the canonical text.
   */
  readonly differs?: { readonly canonicalId: string; readonly extraWords: number }
}

const TITLE_PATTERNS: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: 'MIT', pattern: /\bmit license\b/i },
  { id: 'ISC', pattern: /\bisc license\b/i },
  { id: 'Apache-2.0', pattern: /\bapache license\b.{0,20}version 2\.0/i },
  { id: 'MPL-2.0', pattern: /\bmozilla public license\b.{0,20}version 2\.0/i },
  { id: 'BSL-1.0', pattern: /\bboost software license\b.{0,20}version 1\.0/i },
  { id: 'EPL-2.0', pattern: /\beclipse public license\b.{0,20}version 2\.0/i },
  { id: 'BSD-2-Clause', pattern: /\bbsd 2-clause\b/i },
  { id: 'BSD-3-Clause', pattern: /\bbsd 3-clause\b/i },
  { id: 'BSD-3-Clause', pattern: /\bneither the name\b/i },
  { id: 'CC0-1.0', pattern: /\bcc0 1\.0 universal/i },
  { id: 'Unlicense', pattern: /\bthis is free and unencumbered software\b/i },
]

const GPL_KIND: readonly { readonly id: string; readonly pattern: RegExp }[] = [
  { id: 'AGPL', pattern: /\baffero general public license\b/i },
  { id: 'LGPL', pattern: /\blesser general public license\b/i },
  { id: 'LGPL', pattern: /\blibrary general public license\b/i },
  { id: 'GPL', pattern: /\bgeneral public license\b/i },
]

const GPL_VERSION = /\bversion (\d(?:\.\d)?)/i
const BSD_SOURCE_BINARY = /\bredistribution and use in source and binary forms\b/i

/** The GPL family's shared-text marker in the pinned match data. */
const GPL_TEXT_FAMILY = 'gpl'

/** Confidence of a full distinctive-phrase cover without an exact hash. */
const PHRASE_COVER_CONFIDENCE = 0.9

/** Confidence of a partial distinctive-phrase cover without an exact hash. */
const PHRASE_PARTIAL_CONFIDENCE = 0.6

/**
 * A line that starts with a copyright marker (`copyright`, `(c)` or `©`).
 * Markers alone prove nothing: grant clauses and added restrictions can
 * start with one too, so the holder and condition checks below decide.
 */
const COPYRIGHT_HEAD = /^\s*(copyright\b|\(c\)|©)/i

/**
 * Positive holder evidence: a year, a year placeholder or a
 * copyright marker. A marker-headed line without any of these is not a
 * holder line (M97 CM971R2: `Copyright owners ...` adds conditions).
 */
const HOLDER_EVIDENCE = /\d{4}|<year>|\[yyyy\]|\{year\}|\(c\)|©|yyyy/i

/**
 * Condition-adding content (M97 CM971R2): obligations, grants, payments
 * and warranty language. A marker-headed line carrying any of this is
 * never a bare holder line, even when it also names a year or marker, so
 * an added restriction always changes the match instead of vanishing.
 */
const CONDITION_CONTENT =
  /\$|€|£|¥|\bmust\b|\bshall\b|\brequire\w*|\bprohibit\w*|\bforbid\w*|\brestrict\w*|\bcondition\w*|\bconsent\b|\bagree\w*|\bsubject\b|\bwithout\b|\bprovid\w*|\bfurnish\w*|\bobtain\w*|\bcontact\b|\blimit\w*|\bpermit\w*|\ballow\w*|\bauthori[sz]\w*|\bgrant\w*|\bpermission\b|\blicen[cs]e\w*|\bsublicen[cs]e\w*|\bdistribut\w*|\bredistribut\w*|\bmodif\w*|\bmerg\w*|\bpublish\w*|\bretain\w*|\breproduc\w*|\bcopy\b|\bcopies\b|\bcopied\b|\bpay\w*|\bprice\w*|\bfee[sd]?\b|\bdollar\b|\broyalt\w*|\bcost\b|\bcharge\w*|\bsale[sd]?\b|\bsell\w*|\bcommercial\w*|\bwarrant\w*|\bliab\w*|\binfring\w*|\bpatent\b|\bdamages\b|\bclaim\w*|\btort\b|\bcontract\b|\barising\b|\breserv\w*|\bdeal\b|\binclud\w*|\buse\w*/i

/**
 * Whether a line is only a copyright notice: marker-headed, carrying
 * holder evidence, and free of condition-adding content. Holders and
 * years differ per copy while the grant stays identical, so only such
 * lines may leave the match text.
 */
export function isCopyrightNoticeLine(line: string): boolean {
  return COPYRIGHT_HEAD.test(line) && HOLDER_EVIDENCE.test(line) && !CONDITION_CONTENT.test(line)
}

/**
 * Normalize a license text for full-text matching: drop the byte-order
 * mark, remove copyright-notice lines (holders and years differ per copy
 * while the grant stays identical), lowercase, and collapse every
 * non-alphanumeric run (line endings, punctuation, quote styles) to one
 * space. The derivation tool runs this same algorithm over the canonical
 * SPDX texts; both sides must stay identical or exact matching fails
 * closed into the heuristic readers, never into a wrong license.
 */
export function normalizeLicenseText(text: string): string {
  const withoutBom = text.codePointAt(0) === BYTE_ORDER_MARK_CODE ? text.slice(1) : text
  const kept: string[] = []
  for (const line of withoutBom.split(/\r\n|\r|\n/)) {
    if (isCopyrightNoticeLine(line)) continue
    kept.push(line)
  }
  return kept
    .join('\n')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Match text against pinned records (M97 C-M97-1): an exact SHA-256 hit
 * first, then the best distinctive-phrase cover (ties broken by closest
 * word count, so BSD-2-Clause beats BSD-3-Clause for a two-clause text).
 * A full phrase cover without a hash hit carries the `differs` detail:
 * the text reads as that license with modified terms. The GPL family
 * matches its bare version stem here; the `-only`/`-or-later` variant
 * resolves downstream from the project's own grant, never from the body
 * (M97 CM971R2). An empty record list (the matcher-off drill) matches
 * nothing, restoring the named full-matching incomplete reason
 * downstream.
 */
/**
 * The version stems whose `-only`/`-or-later` variant is read from the
 * project's own grant (manifests, README), never from the license body
 * (M97 CM971R2): identical bodies cannot establish which variant the
 * project grants.
 */
export function gplTextStems(
  records: readonly SpdxLicenseTextRecord[] = SPDX_LICENSE_TEXTS,
): ReadonlySet<string> {
  return new Set(
    records.filter((record) => record.family === GPL_TEXT_FAMILY).map((record) => record.id),
  )
}

/**
 * Whether a dependency's declared license agrees with its vendored text
 * reading (M97 CM971R2): an exact string match, or a GPL-family stem
 * reading against the declared `-only`/`-or-later` variant. Anything else
 * is relabelled from the text evidence, never silently adopted.
 */
export function hasLicenseTextAgreement(
  declaredRaw: string | undefined,
  matchId: string,
  stems: ReadonlySet<string> = gplTextStems(),
): boolean {
  return (
    declaredRaw === matchId ||
    (declaredRaw !== undefined &&
      stems.has(matchId) &&
      (declaredRaw === `${matchId}-only` || declaredRaw === `${matchId}-or-later`))
  )
}

/**
 * Resolve one file-read license id against the project's own grant
 * (M97 CM971R2): a GPL-family stem becomes the single claimed variant
 * (`-only` or `-or-later`) when the manifests and README claim exactly
 * one, and conservative `-only` otherwise. Non-stems pass through.
 */
export function resolveGplStemVariant(
  id: string,
  grantIds: ReadonlySet<string>,
  stems: ReadonlySet<string> = gplTextStems(),
): string {
  if (!stems.has(id)) return id
  const claimed = [`${id}-only`, `${id}-or-later`].filter((variant) => grantIds.has(variant))
  return claimed.length === 1 && claimed[0] !== undefined ? claimed[0] : `${id}-only`
}

export function matchPinnedLicenseText(
  text: string,
  records: readonly SpdxLicenseTextRecord[] = SPDX_LICENSE_TEXTS,
): LicenseTextMatch | undefined {
  const normalized = normalizeLicenseText(text)
  if (normalized === '') return undefined
  const digest = fingerprint(normalized)
  const exactRecord = records.find((record) => record.hash === digest)
  if (exactRecord !== undefined) {
    return { id: exactRecord.id, confidence: 1, exact: true }
  }
  let best: SpdxLicenseTextRecord | undefined
  let bestCovered = 0
  let bestDistance = Infinity
  const words = normalized.split(' ').length
  for (const record of records) {
    if (record.phrases.length === 0) continue
    const covered = record.phrases.filter((phrase) => normalized.includes(phrase)).length
    if (covered === 0) continue
    const distance = Math.abs(words - record.words)
    if (covered < bestCovered || (covered === bestCovered && distance >= bestDistance)) continue
    best = record
    bestCovered = covered
    bestDistance = distance
  }
  if (best === undefined) return undefined
  const hasFullCover = bestCovered === best.phrases.length
  return {
    id: best.id,
    confidence: hasFullCover ? PHRASE_COVER_CONFIDENCE : PHRASE_PARTIAL_CONFIDENCE,
    exact: false,
    ...(hasFullCover && { differs: { canonicalId: best.id, extraWords: words - best.words } }),
  }
}

/**
 * The license a file's text reads as. Shared with the ecosystem readers,
 * which meet the same prose inside vendored packages. A verbatim text
 * matches its pinned canonical hash first; anything else falls through
 * the historical title and clause heuristics, then the pinned phrases.
 * When the heuristics agree with a full-cover pinned reading, the
 * `differs` detail travels with the heuristic match (M97 CM971R2), so a
 * titled but modified text still reads as modified terms.
 */
export function identifyLicenseText(
  text: string,
  records: readonly SpdxLicenseTextRecord[] = SPDX_LICENSE_TEXTS,
): LicenseTextMatch | undefined {
  const pinnedExact = matchPinnedLicenseText(text, records)
  if (pinnedExact?.exact === true) return pinnedExact
  const heuristic = heuristicLicenseText(text)
  return heuristic !== undefined &&
    pinnedExact?.differs !== undefined &&
    pinnedExact.id === heuristic.id
    ? { ...heuristic, differs: pinnedExact.differs }
    : (heuristic ?? pinnedExact)
}

function heuristicLicenseText(text: string): LicenseTextMatch | undefined {
  const title = topLines(text).join('\n')
  const firstTitle = title.split('\n').find((line) => line.trim() !== '') ?? ''
  for (const candidate of TITLE_PATTERNS) {
    if (candidate.pattern.test(firstTitle)) return { id: candidate.id, confidence: 1, exact: false }
  }
  for (const kind of GPL_KIND) {
    if (kind.pattern.test(text)) {
      // The variant suffix is never read from the body (M97 CM971R2):
      // bare stems resolve against the project's own grant downstream.
      const version = GPL_VERSION.exec(text)?.[1] ?? ''
      if (kind.id === 'LGPL' && ['2', '2.1', '3'].includes(version)) {
        const precise = version === '2.1' ? version : `${version}.0`
        return { id: `LGPL-${precise}`, confidence: 1, exact: false }
      }
      return (version === '2' || version === '3') && (kind.id === 'GPL' || kind.id === 'AGPL')
        ? { id: `${kind.id}-${version}.0`, confidence: 1, exact: false }
        : { id: kind.id, confidence: 0.6, exact: false }
    }
  }
  for (const candidate of TITLE_PATTERNS) {
    if (candidate.pattern.test(title) || candidate.pattern.test(text))
      return { id: candidate.id, confidence: 0.8, exact: false }
  }
  return BSD_SOURCE_BINARY.test(text)
    ? { id: 'BSD-2-Clause', confidence: 0.8, exact: false }
    : undefined
}

const TEXT_FILE_SUFFIXES: ReadonlySet<string> = new Set(['txt', 'md', 'rst', 'text', 'textile'])

function isLicenseFileSuffixKnown(base: string): boolean {
  const cut = base.search(/[.-]/)
  if (cut === -1) {
    return true
  }
  const suffix = base.slice(cut + 1).toLowerCase()
  return TEXT_FILE_SUFFIXES.has(suffix) || canonicalLicenseId(suffix) !== undefined
}

/** Root license files, sorted for deterministic reads. */
function rootLicenseFiles(snapshot: LegalFileSnapshot): string[] {
  return snapshot.files
    .filter((file) => dirNameOf(file) === '' && isLicenseFileName(baseNameOf(file)))
    .filter((file) => isLicenseFileSuffixKnown(baseNameOf(file)))
    .toSorted((a, b) => compareLegalText(a, b))
}

/** License files below the root: vendored code until proven otherwise. */
function nestedLicenseFiles(snapshot: LegalFileSnapshot): string[] {
  return snapshot.files
    .filter((file) => dirNameOf(file) !== '' && isLicenseFileName(baseNameOf(file)))
    .filter((file) => isLicenseFileSuffixKnown(baseNameOf(file)))
    .filter((file) => !file.includes('node_modules/'))
    .toSorted((a, b) => compareLegalText(a, b))
}

const README_FILE = /^readme(\.[a-z0-9]+)?$/i
const LICENSE_HEADING = /^#{0,6}\s*licen[sc]e\b/im
const HEADER_SPDX = /SPDX-License-Identifier:\s*(\S+)/i

function readmeLicense(
  snapshot: LegalFileSnapshot,
): { readonly raw: string; readonly file: string } | undefined {
  const readme = snapshot.files
    .filter((file) => dirNameOf(file) === '' && README_FILE.test(baseNameOf(file)))
    .toSorted((a, b) => compareLegalText(a, b))[0]
  if (readme === undefined) {
    return undefined
  }
  const text = snapshot.readFile(readme)
  if (text === undefined) {
    return undefined
  }
  const heading = LICENSE_HEADING.exec(text)
  const section = heading === null ? topLines(text).join('\n') : text.slice(heading.index)
  const spdx = HEADER_SPDX.exec(section)
  if (spdx?.[1] !== undefined) {
    return { raw: spdx[1], file: readme }
  }
  const opening = topLines(section).join('\n')
  const listed1 = opening.match(/[A-Za-z0-9][A-Za-z0-9.+:-]*/g) ?? []
  for (const word of listed1) {
    if (canonicalLicenseId(word) !== undefined) {
      return { raw: word, file: readme }
    }
  }
  const identified = identifyLicenseText(opening)
  return identified === undefined ? undefined : { raw: identified.id, file: readme }
}

/** Canonical ids in an expression: recognized ids plus custom references. */
function canonicalIdsOf(raw: string): string[] {
  const parsed = parseSpdxExpression(raw)
  if (!parsed.ok) {
    return []
  }
  const ids: string[] = []
  const listed2 = parsed.licenses
  for (const license of listed2) {
    const canonical = license.canonicalId ?? (license.custom ? license.id : undefined)
    if (canonical !== undefined && !ids.includes(canonical)) {
      ids.push(canonical)
    }
  }
  return ids
}

const LICENSE_POINTER = 'SEE LICENSE IN '

function expressionTerms(node: SpdxNode, kind: 'and' | 'or'): string[] {
  return node.kind === kind
    ? node.children.flatMap((child) => expressionTerms(child, kind))
    : [normalizedExpression(node)]
}

function normalizedExpression(node: SpdxNode): string {
  if (node.kind === 'license') {
    const license = node.license
    const id = `${license.canonicalId ?? license.id}${license.plus ? '+' : ''}`
    return license.exception === undefined
      ? id
      : `${id} WITH ${canonicalExceptionId(license.exception.id) ?? license.exception.id}`
  }
  const terms = [...new Set(expressionTerms(node, node.kind))].toSorted(compareLegalText)
  return `(${terms.join(node.kind === 'and' ? ' AND ' : ' OR ')})`
}

function projectExpressionKey(raw: string): string {
  const parsed = parseSpdxExpression(raw)
  return parsed.ok ? normalizedExpression(parsed.root) : raw.trim()
}

function malformedManifestFinding(
  manifest: ManifestLicenseDeclaration,
  error: string,
): LegalFindingDraft {
  return {
    severity: 'should-fix',
    category: 'license',
    file: manifest.file,
    evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: manifest.file }),
    confidence: 0.9,
    explanation: fill(UI_TEXT.legalScanner.m023, {
      v0: manifest.file,
      v1: manifest.raw,
      v2: error,
    }),
    recommendation: UI_TEXT.legalScanner.m083,
    fixable: false,
    evidenceExcerpt: excerpt(manifest.raw),
  }
}

interface ManifestAssessment {
  readonly manifest: ManifestLicenseDeclaration
  /** Empty for pointers and malformed expressions (reported separately). */
  readonly ids: readonly string[]
}

/**
 * Read the project's license declarations. `manifests` carries the license
 * fields the ecosystem readers already parsed (one per manifest), so no
 * manifest is read twice. `snapshot.files` must already be sorted and
 * workspace-confined.
 */
export function scanProjectLicense(
  snapshot: LegalFileSnapshot,
  manifests: readonly ManifestLicenseDeclaration[] = [],
): ProjectLicenseResult {
  const findings: LegalFindingDraft[] = []
  const incomplete: string[] = []

  const licenseFiles = rootLicenseFiles(snapshot)
  const fileIds = new Map<string, number>()
  // Full-text matching (M97 C-M97-1) lifts the heuristic caveat only when
  // every license file matches its pinned canonical text exactly:
  // anything heuristic, modified, unrecognized, binary or unreadable keeps
  // the named reason instead of exiting clean.
  let isFullyExact = licenseFiles.length > 0
  for (const file of licenseFiles) {
    const text = snapshot.readFile(file)
    if (text === undefined || hasBinaryContent(text)) {
      isFullyExact = false
      continue
    }
    const match = identifyLicenseText(text)
    if (match === undefined) {
      isFullyExact = false
      findings.push({
        severity: 'advice',
        category: 'license',
        file,
        evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: file }),
        confidence: 0.5,
        explanation: fill(UI_TEXT.legalScanner.m085, { v0: file }),
        recommendation: UI_TEXT.legalScanner.m086,
        fixable: false,
        evidenceExcerpt: excerpt(topLines(text).join('\n')),
      })
      continue
    }
    const known = fileIds.get(match.id) ?? 0
    if (match.confidence > known) {
      fileIds.set(match.id, match.confidence)
    }
    isFullyExact &&= match.exact
    if (match.differs !== undefined) {
      findings.push({
        severity: 'advice',
        category: 'license',
        file,
        evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: file }),
        confidence: match.confidence,
        explanation: plural(UI_TEXT.legalScanner.m197, Math.abs(match.differs.extraWords), {
          v0: file,
          v1: match.differs.canonicalId,
        }),
        recommendation: UI_TEXT.legalScanner.m086,
        fixable: false,
        evidenceExcerpt: excerpt(topLines(text).join('\n')),
      })
    }
  }
  if (!isFullyExact && licenseFiles.length > 0) {
    incomplete.push(UI_TEXT.legalScanner.m084)
  }
  const rawFileIds = Array.from(fileIds.keys(), (entry) => entry).toSorted((a, b) =>
    compareLegalText(a, b),
  )

  const seen = new Set<string>()
  const assessments: ManifestAssessment[] = []
  for (const manifest of manifests) {
    if (seen.has(manifest.file)) {
      continue
    }
    seen.add(manifest.file)
    if (manifest.raw.startsWith(LICENSE_POINTER)) {
      const target = manifest.raw.slice(LICENSE_POINTER.length).trim()
      if (!snapshot.files.includes(target)) {
        findings.push({
          severity: 'should-fix',
          category: 'license',
          file: manifest.file,
          evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: manifest.file }),
          confidence: 1,
          explanation: fill(UI_TEXT.legalScanner.m087, { v0: manifest.file, v1: target }),
          recommendation: UI_TEXT.legalScanner.m088,
          fixable: false,
          evidenceExcerpt: excerpt(manifest.raw),
        })
      }
      assessments.push({ manifest, ids: [] })
      continue
    }
    if (manifest.raw === 'UNLICENSED') {
      findings.push({
        severity: 'advice',
        category: 'license',
        file: manifest.file,
        evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: manifest.file }),
        confidence: 1,
        explanation: fill(UI_TEXT.legalScanner.m089, { v0: manifest.file }),
        recommendation: UI_TEXT.legalScanner.m090,
        fixable: false,
        evidenceExcerpt: excerpt(manifest.raw),
      })
      assessments.push({ manifest, ids: [] })
      continue
    }
    const parsed = parseSpdxExpression(manifest.raw)
    if (!parsed.ok) {
      findings.push(malformedManifestFinding(manifest, parsed.error))
      assessments.push({ manifest, ids: [] })
      continue
    }
    assessments.push({ manifest, ids: canonicalIdsOf(manifest.raw) })
  }

  // The GPL family's `-only`/`-or-later` variant comes from the project's
  // own grant (M97 CM971R2): manifests and the README declaration, never
  // the license body. A stem with exactly one claimed variant resolves to
  // it; anything else stays conservative `-only` and any genuine conflict
  // still surfaces through the differs check below.
  const grantReadme = readmeLicense(snapshot)
  const grantReadmeIds = grantReadme === undefined ? [] : canonicalIdsOf(grantReadme.raw)
  const grantIds = new Set([
    ...assessments.flatMap((assessment) => assessment.ids),
    ...grantReadmeIds,
  ])
  const stems = gplTextStems()
  const fileIdList = rawFileIds
    .map((id) => resolveGplStemVariant(id, grantIds, stems))
    .toSorted((a, b) => compareLegalText(a, b))
  const fileIdSet = new Set(fileIdList)

  if (fileIdList.length > 0) {
    for (const assessment of assessments) {
      if (assessment.ids.length === 0) {
        continue
      }
      const assessmentSet = new Set(assessment.ids)
      const isDiffers =
        assessment.ids.some((id) => !fileIdSet.has(id)) ||
        fileIdList.some((id) => !assessmentSet.has(id))
      if (isDiffers) {
        findings.push({
          severity: 'should-fix',
          category: 'license',
          file: assessment.manifest.file,
          evidenceSource: fill(UI_TEXT.legalScanner.m091, {
            v0: assessment.manifest.file,
            v1: licenseFiles[0] ?? UI_TEXT.legalScanner.licenseFile,
          }),
          confidence: 0.9,
          explanation: fill(UI_TEXT.legalScanner.m092, {
            v0: assessment.manifest.file,
            v1: assessment.manifest.raw,
            v2: fileIdList.join(', '),
          }),
          recommendation: UI_TEXT.legalScanner.m093,
          fixable: false,
          evidenceExcerpt: excerpt(assessment.manifest.raw),
        })
      }
    }
  } else {
    const groups = new Map<string, ManifestLicenseDeclaration[]>()
    for (const assessment of assessments) {
      if (assessment.ids.length === 0) {
        continue
      }
      const key = projectExpressionKey(assessment.manifest.raw)
      const group = groups.get(key) ?? []
      group.push(assessment.manifest)
      groups.set(key, group)
    }
    if (groups.size > 1) {
      const names = [...groups]
        .map(([ids, sources]) =>
          fill(UI_TEXT.legalScanner.declaration, {
            file: sources.map((source) => source.file).join(', '),
            license: ids,
          }),
        )
        .join('; ')
      findings.push({
        severity: 'should-fix',
        category: 'license',
        evidenceSource: UI_TEXT.legalScanner.m094,
        confidence: 0.9,
        explanation: fill(UI_TEXT.legalScanner.m095, { v0: names }),
        recommendation: UI_TEXT.legalScanner.m096,
        fixable: false,
      })
    }
  }

  if (licenseFiles.length === 0 && assessments.some((assessment) => assessment.ids.length > 0)) {
    findings.push({
      severity: 'should-fix',
      category: 'license',
      evidenceSource: UI_TEXT.legalScanner.m094,
      confidence: 1,
      explanation: UI_TEXT.legalScanner.m097,
      recommendation: UI_TEXT.legalScanner.m098,
      fixable: false,
    })
  }
  const manifestUnion = [...new Set(assessments.flatMap((assessment) => assessment.ids))].toSorted(
    (a, b) => compareLegalText(a, b),
  )
  const declared = fileIdList.length > 0 ? fileIdList : manifestUnion
  const declaredSet = new Set(declared)

  const readme = grantReadme
  const readmeIds = grantReadmeIds

  if (readme !== undefined && declared.length > 0 && readmeIds.some((id) => !declaredSet.has(id))) {
    findings.push({
      severity: 'should-fix',
      category: 'license',
      file: readme.file,
      evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: readme.file }),
      confidence: 0.7,
      explanation: fill(UI_TEXT.legalScanner.m099, {
        v0: readmeIds.join(', '),
        v1: declared.join(', '),
      }),
      recommendation: UI_TEXT.legalScanner.m100,
      fixable: false,
      evidenceExcerpt: excerpt(readme.raw),
    })
  }

  if (readme !== undefined && declared.length === 0 && readmeIds.length > 0) {
    findings.push({
      severity: 'advice',
      category: 'license',
      file: readme.file,
      evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: readme.file }),
      confidence: 0.6,
      explanation: fill(UI_TEXT.legalScanner.m101, { v0: readmeIds.join(', ') }),
      recommendation: UI_TEXT.legalScanner.m102,
      fixable: false,
      evidenceExcerpt: excerpt(readme.raw),
    })
  }

  const isDeclaredAnything = assessments.length > 0 || licenseFiles.length > 0
  if (!isDeclaredAnything && declared.length === 0 && readmeIds.length === 0) {
    findings.push({
      severity: 'advice',
      category: 'license',
      evidenceSource: UI_TEXT.legalScanner.m094,
      confidence: 0.8,
      explanation: UI_TEXT.legalScanner.m103,
      recommendation: UI_TEXT.legalScanner.m104,
      fixable: false,
    })
  }

  const listed3 = nestedLicenseFiles(snapshot)
  for (const nested of listed3) {
    const text = snapshot.readFile(nested)
    if (text === undefined || hasBinaryContent(text)) {
      continue
    }
    const match = identifyLicenseText(text)
    findings.push({
      severity: 'advice',
      category: 'noticeFile',
      file: nested,
      evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: nested }),
      confidence: match?.confidence ?? UNKNOWN_TEXT_CONFIDENCE,
      explanation:
        match === undefined
          ? fill(UI_TEXT.legalScanner.m105, { v0: nested })
          : fill(UI_TEXT.legalScanner.m106, { v0: nested, v1: match.id }),
      recommendation: UI_TEXT.legalScanner.m107,
      fixable: false,
      evidenceExcerpt: excerpt(topLines(text).join('\n')),
    })
  }

  return { findings, licenses: declared, incomplete }
}
