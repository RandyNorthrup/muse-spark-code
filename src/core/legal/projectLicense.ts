import { fill } from '../../shared/l10n/text'
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
import {
  baseNameOf,
  hasBinaryContent,
  dirNameOf,
  excerpt,
  isLicenseFileName,
  topLines,
} from './files'
import { canonicalLicenseId, canonicalExceptionId } from './data'
import {
  gplTemplateStems,
  licenseTemplateSet,
  readLicenseText,
  type LicenseTemplateSet,
} from './licenseTemplates'
import { parseSpdxExpression, type SpdxLicenseNode, type SpdxNode } from './spdx'

/** What the project-license reader established, for later readers. */
export interface ProjectLicenseResult {
  readonly findings: readonly LegalFindingDraft[]
  /** Canonical license ids the project declares (files first, else manifests). */
  readonly licenses: readonly string[]
  readonly incomplete: readonly string[]
  /**
   * A license text (root or vendored below it) did not match its template
   * exactly, so its terms need human review (M97 CM971-R3).
   */
  readonly requiresReview: boolean
}

/** A license text's best reading and its confidence. */
export interface LicenseTextMatch {
  readonly id: string
  readonly confidence: number
  /**
   * True only when the text matches a pinned SPDX template (M97
   * CM971-R3): every fixed token present in order, nothing after its end,
   * and only the template's variable and optional parts varying, each
   * variable holding just what it stands for. Heuristic readings keep
   * `false` and the named full-matching incomplete reason.
   */
  readonly exact: boolean
  /**
   * Set when the text reads closest to a pinned template without
   * matching it: the template and the first differing span, for human
   * review.
   */
  readonly differs?: {
    readonly canonicalId: string
    readonly span: string
    readonly expected: string
  }
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

/** Confidence precision kept from a template similarity. */
const CONFIDENCE_STEPS = 1000

/**
 * The version stems whose `-only`/`-or-later` variant is read from the
 * project's own grant (manifests, README, source headers and GNU
 * notices), never from the license body (M97 CM971R2): identical bodies
 * cannot establish which variant the project grants.
 */
export function gplTextStems(set: LicenseTemplateSet = licenseTemplateSet()): ReadonlySet<string> {
  return gplTemplateStems(set)
}

/**
 * Whether a dependency's declared license agrees with its vendored text
 * reading (M97 CM971R2): an exact string match, or a GPL-family stem
 * reading against the declared `-only`, `-or-later` or `+` variant.
 * Anything else is relabelled from the text evidence, never silently
 * adopted.
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
      [`${matchId}-only`, `${matchId}-or-later`, `${matchId}+`].includes(declaredRaw))
  )
}

/**
 * Resolve one file-read license id against the project's own grant
 * (M97 CM971R2): a GPL-family stem becomes the single claimed variant
 * (`-only` or `-or-later`) when the grants claim exactly one, and
 * conservative `-only` otherwise. Non-stems pass through.
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

/**
 * The license a file's text reads as. Shared with the ecosystem readers,
 * which meet the same prose inside vendored packages. A text matching a
 * pinned SPDX template is exact; a text close to one reads as that
 * license with its first differing span; anything else falls through the
 * historical title and clause heuristics, never exact.
 */
export function identifyLicenseText(
  text: string,
  set: LicenseTemplateSet = licenseTemplateSet(),
): LicenseTextMatch | undefined {
  const reading = readLicenseText(text, set)
  if (reading?.exact === true) return { id: reading.key, confidence: 1, exact: true }
  if (reading?.difference !== undefined) {
    return {
      id: reading.key,
      confidence: Math.floor(reading.similarity * CONFIDENCE_STEPS) / CONFIDENCE_STEPS,
      exact: false,
      differs: {
        canonicalId: reading.difference.templateId,
        span: reading.difference.span,
        expected: reading.difference.expected,
      },
    }
  }
  return heuristicLicenseText(text)
}

/** The human-review explanation for a text that differs from its template. */
function licenseDifferenceText(
  file: string,
  differs: NonNullable<LicenseTextMatch['differs']>,
): string {
  return differs.expected === ''
    ? fill(UI_TEXT.legalScanner.m201, { v0: file, v1: differs.canonicalId, v2: differs.span })
    : fill(UI_TEXT.legalScanner.m200, {
        v0: file,
        v1: differs.canonicalId,
        v2: differs.span === '' ? '…' : differs.span,
        v3: differs.expected,
      })
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
/**
 * A license entry as the grant it makes (M97 CM971-R3): the GPL family's
 * trailing `+` and `-or-later` read as `<stem>-or-later`, its bare
 * (deprecated) stem and `-only` as `<stem>-only`; other ids as listed.
 */
function grantIdOf(license: SpdxLicenseNode, stems: ReadonlySet<string>): string | undefined {
  const canonical = license.canonicalId ?? (license.custom ? license.id : undefined)
  if (canonical === undefined) return undefined
  const stem = canonical.replace(/-(?:only|or-later)$/u, '')
  if (!stems.has(stem)) return canonical
  return license.plus || canonical.endsWith('-or-later') ? `${stem}-or-later` : `${stem}-only`
}

function canonicalIdsOf(raw: string, stems: ReadonlySet<string> = gplTextStems()): string[] {
  const parsed = parseSpdxExpression(raw)
  if (!parsed.ok) {
    return []
  }
  const ids: string[] = []
  for (const license of parsed.licenses) {
    const grant = grantIdOf(license, stems)
    if (grant !== undefined && !ids.includes(grant)) {
      ids.push(grant)
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
  headerGrants: readonly string[] = [],
): ProjectLicenseResult {
  const findings: LegalFindingDraft[] = []
  const incomplete: string[] = []
  let requiresReview = false

  const licenseFiles = rootLicenseFiles(snapshot)
  const fileIds = new Map<string, number>()
  // Full-text matching (M97 C-M97-1, CM971-R3) lifts the heuristic caveat
  // only when every license file matches a pinned SPDX template exactly:
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
        explanation: licenseDifferenceText(file, match.differs),
        recommendation: UI_TEXT.legalScanner.m086,
        fixable: false,
        evidenceExcerpt: excerpt(
          match.differs.span === '' ? topLines(text).join('\n') : match.differs.span,
        ),
      })
    }
  }
  if (!isFullyExact && licenseFiles.length > 0) {
    incomplete.push(UI_TEXT.legalScanner.m084)
    requiresReview = true
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
  // own grant (M97 CM971R2, CM971-R3): manifests, the README declaration,
  // the project's source headers (`SPDX-License-Identifier`, a trailing
  // `+`) and GNU "any later version" notices, never the license body. A
  // stem with exactly one claimed variant resolves to it; anything else
  // stays conservative `-only` and any genuine conflict still surfaces
  // through the differs check below.
  const grantReadme = readmeLicense(snapshot)
  const grantReadmeIds = grantReadme === undefined ? [] : canonicalIdsOf(grantReadme.raw)
  const grantIds = new Set([
    ...assessments.flatMap((assessment) => assessment.ids),
    ...grantReadmeIds,
    ...headerGrants.flatMap((raw) => canonicalIdsOf(raw)),
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
    // A vendored text that is not an exact template match keeps its
    // human-review limitation (M97 CM971-R3), whatever its file name.
    if (match?.exact !== true) {
      requiresReview = true
      incomplete.push(
        fill(match === undefined ? UI_TEXT.legalScanner.m117 : UI_TEXT.legalScanner.m199, {
          v0: dirNameOf(nested),
          v1: nested,
        }),
      )
    }
    let explanation = fill(UI_TEXT.legalScanner.m105, { v0: nested })
    if (match?.differs !== undefined) explanation = licenseDifferenceText(nested, match.differs)
    else if (match !== undefined)
      explanation = fill(UI_TEXT.legalScanner.m106, { v0: nested, v1: match.id })
    findings.push({
      severity: 'advice',
      category: 'noticeFile',
      file: nested,
      evidenceSource: fill(UI_TEXT.legalScanner.m082, { v0: nested }),
      confidence: match?.confidence ?? UNKNOWN_TEXT_CONFIDENCE,
      explanation,
      recommendation: UI_TEXT.legalScanner.m107,
      fixable: false,
      evidenceExcerpt: excerpt(topLines(text).join('\n')),
    })
  }

  return { findings, licenses: declared, incomplete, requiresReview }
}
