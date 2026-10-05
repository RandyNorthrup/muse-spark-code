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
const GPL_OR_LATER = /\bany later version\b/i
const BSD_SOURCE_BINARY = /\bredistribution and use in source and binary forms\b/i

/**
 * The license a file's text reads as. Shared with the ecosystem readers,
 * which meet the same prose inside vendored packages.
 */
export function identifyLicenseText(text: string): LicenseTextMatch | undefined {
  const title = topLines(text).join('\n')
  for (const candidate of TITLE_PATTERNS) {
    if (candidate.pattern.test(title) || candidate.pattern.test(text)) {
      return { id: candidate.id, confidence: 1 }
    }
  }
  for (const kind of GPL_KIND) {
    if (kind.pattern.test(text)) {
      const version = GPL_VERSION.exec(text)?.[1] ?? ''
      const suffix = GPL_OR_LATER.test(text) ? '-or-later' : '-only'
      if (kind.id === 'LGPL' && ['2', '2.1', '3'].includes(version)) {
        const precise = version === '2.1' ? version : `${version}.0`
        return { id: `LGPL-${precise}${suffix}`, confidence: 1 }
      }
      return (version === '2' || version === '3') && (kind.id === 'GPL' || kind.id === 'AGPL')
        ? { id: `${kind.id}-${version}.0${suffix}`, confidence: 1 }
        : { id: kind.id, confidence: 0.6 }
    }
  }
  return BSD_SOURCE_BINARY.test(text) ? { id: 'BSD-2-Clause', confidence: 0.8 } : undefined
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
    evidenceSource: `project license reader at ${manifest.file}`,
    confidence: 0.9,
    explanation: `${manifest.file} declares the license ${manifest.raw}, which is not a well-formed SPDX expression: ${error}.`,
    recommendation:
      'Write the license as an SPDX expression (AND, OR and WITH in uppercase, parentheses where needed).',
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
  if (licenseFiles.length > 0)
    incomplete.push(
      'not checked: full SPDX text matching and modified terms; title and clause matching is heuristic',
    )
  const fileIds = new Map<string, number>()
  for (const file of licenseFiles) {
    const text = snapshot.readFile(file)
    if (text === undefined || hasBinaryContent(text)) {
      continue
    }
    const match = identifyLicenseText(text)
    if (match === undefined) {
      findings.push({
        severity: 'advice',
        category: 'license',
        file,
        evidenceSource: `project license reader at ${file}`,
        confidence: 0.5,
        explanation: `${file} reads as no recognized license text; its terms need a human read.`,
        recommendation: 'Confirm what license the file grants and declare it in the manifest.',
        fixable: false,
        evidenceExcerpt: excerpt(topLines(text).join('\n')),
      })
      continue
    }
    const known = fileIds.get(match.id) ?? 0
    if (match.confidence > known) {
      fileIds.set(match.id, match.confidence)
    }
  }
  const fileIdList = Array.from(fileIds.keys(), (entry) => entry).toSorted((a, b) =>
    compareLegalText(a, b),
  )
  const fileIdSet = new Set(fileIdList)

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
          evidenceSource: `project license reader at ${manifest.file}`,
          confidence: 1,
          explanation: `${manifest.file} points at ${target}, which is absent from the workspace.`,
          recommendation: 'Add the referenced license file or correct the manifest field.',
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
        evidenceSource: `project license reader at ${manifest.file}`,
        confidence: 1,
        explanation: `${manifest.file} marks the project UNLICENSED: proprietary, all rights reserved by default.`,
        recommendation:
          'Ship it only to its intended recipients; a public distribution needs a license grant.',
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
          evidenceSource: `project license reader at ${assessment.manifest.file} and ${licenseFiles[0] ?? 'a license file'}`,
          confidence: 0.9,
          explanation: `${assessment.manifest.file} declares ${assessment.manifest.raw} but the license file reads as ${fileIdList.join(', ')}.`,
          recommendation:
            'Reconcile the two before shipping: fix the metadata or replace the license file, with explicit confirmation for a license change.',
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
        .map(
          ([ids, sources]) => `${sources.map((source) => source.file).join(', ')} declares ${ids}`,
        )
        .join('; ')
      findings.push({
        severity: 'should-fix',
        category: 'license',
        evidenceSource: 'project license reader',
        confidence: 0.9,
        explanation: `The manifests disagree with no license file to settle it: ${names}.`,
        recommendation:
          'Reconcile the manifests before shipping, with explicit confirmation for a license change.',
        fixable: false,
      })
    }
  }

  if (licenseFiles.length === 0 && assessments.some((assessment) => assessment.ids.length > 0)) {
    findings.push({
      severity: 'should-fix',
      category: 'license',
      evidenceSource: 'project license reader',
      confidence: 1,
      explanation: 'The manifest declares terms but no root license file was found.',
      recommendation:
        'Add the applicable license text from verified ownership before distribution.',
      fixable: false,
    })
  }
  const manifestUnion = [...new Set(assessments.flatMap((assessment) => assessment.ids))].toSorted(
    (a, b) => compareLegalText(a, b),
  )
  const declared = fileIdList.length > 0 ? fileIdList : manifestUnion
  const declaredSet = new Set(declared)

  const readme = readmeLicense(snapshot)
  const readmeIds = readme === undefined ? [] : canonicalIdsOf(readme.raw)

  if (readme !== undefined && declared.length > 0 && readmeIds.some((id) => !declaredSet.has(id))) {
    findings.push({
      severity: 'should-fix',
      category: 'license',
      file: readme.file,
      evidenceSource: `project license reader at ${readme.file}`,
      confidence: 0.7,
      explanation: `The README declares ${readmeIds.join(', ')} but the project declares ${declared.join(', ')}.`,
      recommendation: 'Reconcile the README with the license file and manifest before shipping.',
      fixable: false,
      evidenceExcerpt: excerpt(readme.raw),
    })
  }

  if (readme !== undefined && declared.length === 0 && readmeIds.length > 0) {
    findings.push({
      severity: 'advice',
      category: 'license',
      file: readme.file,
      evidenceSource: `project license reader at ${readme.file}`,
      confidence: 0.6,
      explanation: `The license ${readmeIds.join(', ')} is declared only in the README; there is no license file or manifest field.`,
      recommendation: 'Add a LICENSE file and a manifest license field from verified ownership.',
      fixable: false,
      evidenceExcerpt: excerpt(readme.raw),
    })
  }

  const isDeclaredAnything = assessments.length > 0 || licenseFiles.length > 0
  if (!isDeclaredAnything && declared.length === 0 && readmeIds.length === 0) {
    findings.push({
      severity: 'advice',
      category: 'license',
      evidenceSource: 'project license reader',
      confidence: 0.8,
      explanation:
        'No LICENSE file, manifest license field or README declaration found: undistributed code is all rights reserved by default.',
      recommendation:
        'Choose a license with explicit confirmation and declare it in a LICENSE file and the manifest.',
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
      evidenceSource: `project license reader at ${nested}`,
      confidence: match?.confidence ?? UNKNOWN_TEXT_CONFIDENCE,
      explanation:
        match === undefined
          ? `${nested} carries license-like text the reader does not recognize: vendored code needs attribution in the notices.`
          : `${nested} carries ${match.id} terms inside the workspace: vendored code needs attribution in the notices.`,
      recommendation:
        'Confirm the vendored code is attributed in THIRD_PARTY_NOTICES or the equivalent notice file.',
      fixable: false,
      evidenceExcerpt: excerpt(topLines(text).join('\n')),
    })
  }

  return { findings, licenses: declared, incomplete }
}
