import { isProtectedPath } from '../protectedPaths'
import { fingerprint } from '../verify/fingerprint'
// Read-only preparation of missing headers from existing project evidence (D76).
// The user's separate ownership confirmation is required before publication.
import { LEGAL_FIX_FILE_READ_MAX_BYTES, LEGAL_HEADER_LINE_WINDOW } from '../../shared/constants'
import type { LegalFinding } from '../../shared/legal'
import type { LegalPreparedPatch } from '../../shared/legalScanEntry'
import { patchHunks, unifiedDiff } from '../codeIntel/codeText'
import { eligibleFixTargets, fixPaths } from '../legalFix'
import {
  assertWorkspaceRelative,
  baseNameOf,
  isLicenseFileName,
  scrubLegalText,
  topLines,
  type LegalFileSnapshot,
} from './files'
import { scanProjectLicense } from './projectLicense'
import { parseSpdxExpression } from './spdx'

const LINE_COMMENT = /\.(?:[cm]?[jt]sx?|rs|go|java|kt|cs|c|h|cpp|hpp|swift)$/
const HASH_COMMENT = /\.(?:py|rb|sh|bash|ps1)$/
const COPYRIGHT = /^\s*(?:Copyright|SPDX-FileCopyrightText:)(?:\s*(?:©|\(c\)))?\s*(\d{4}[^\r\n]+)$/i
const SAFE_COPYRIGHT = /^[\p{L}\p{M}\p{N} .,'’()&/@+–—-]+$/u
const HEADER_COPYRIGHT =
  /(?:Copyright|SPDX-FileCopyrightText:)(?:\s*(?:©|\(c\)))?\s*(\d{4}[^\r\n]+)/i
const HEADER_LICENSE = /SPDX-License-Identifier:\s*([^\r\n]+)/

export function prepareLegalHeaderPatches(
  snapshot: LegalFileSnapshot,
  findings: readonly LegalFinding[],
): readonly LegalPreparedPatch[] {
  if (
    eligibleFixTargets(
      findings,
      findings.map((finding) => finding.id),
      false,
    ).eligible.length !== findings.length
  )
    return []
  const project = scanProjectLicense(snapshot)
  if (project.licenses.length !== 1) return []
  const license = project.licenses[0] ?? ''
  const parsed = parseSpdxExpression(license)
  if (!parsed.ok || parsed.licenses.length !== 1 || parsed.licenses[0]?.canonicalId !== license)
    return []
  const holders = new Set<string>()
  for (const file of snapshot.files) {
    if (file.includes('/') || !isLicenseFileName(baseNameOf(file))) continue
    const licenseLines = (snapshot.readFile(file) ?? '').split(/\r?\n/)
    for (const line of licenseLines) {
      const holder = COPYRIGHT.exec(line)?.[1]?.trim()
      if (holder !== undefined && SAFE_COPYRIGHT.test(holder)) holders.add(holder)
    }
  }
  if (holders.size !== 1) return []
  const holder = [...holders][0] ?? ''
  const evidence = snapshot.files
    .filter((file) => !file.includes('/') && isLicenseFileName(baseNameOf(file)))
    .flatMap((path) => {
      const content = snapshot.readFile(path)
      return content === undefined
        ? []
        : [{ path, hash: snapshot.readFileHash?.(path) ?? fingerprint(content) }]
    })
  const prepared: LegalPreparedPatch[] = []
  for (const file of fixPaths(findings)) {
    assertWorkspaceRelative(file)
    if (isProtectedPath(file)) continue
    const selected = findings.filter((finding) => finding.file === file)
    if (
      selected.some(
        (finding) =>
          finding.packageName !== undefined ||
          !finding.fixable ||
          !['copyrightHeader', 'spdxIdentifier', 'codeQualityHeader'].includes(finding.category),
      )
    )
      continue
    const prefix = HASH_COMMENT.test(file) ? '#' : '//'
    if (prefix === '//' && !LINE_COMMENT.test(file)) continue
    const before = snapshot.readFile(file)
    if (
      before === undefined ||
      before.includes('\0') ||
      new TextEncoder().encode(before).length > LEGAL_FIX_FILE_READ_MAX_BYTES
    )
      continue
    const head = topLines(before, LEGAL_HEADER_LINE_WINDOW).join('\n')
    const existingHolder = HEADER_COPYRIGHT.exec(head)?.[1]?.trim()
    const existingLicense = HEADER_LICENSE.exec(head)?.[1]?.trim()
    // Preserve existing headers; an ambiguous or foreign one is a recommendation only.
    if (
      (existingHolder !== undefined && existingHolder !== holder) ||
      (existingLicense !== undefined && existingLicense !== license)
    )
      continue
    const lines = [
      ...(existingHolder === undefined ? [`${prefix} Copyright (c) ${holder}`] : []),
      ...(existingLicense === undefined ? [`${prefix} SPDX-License-Identifier: ${license}`] : []),
    ]
    if (lines.length === 0) continue
    const eol = before.includes('\r\n') ? '\r\n' : '\n'
    const bom = before.startsWith('\u{FEFF}') ? '\u{FEFF}' : ''
    const body = before.slice(bom.length)
    // Keep the interpreter's shebang first, and preserve the original bytes after it.
    let shebangEnd = body.startsWith('#!') ? body.indexOf('\n') + 1 : 0
    if (shebangEnd === 0 && body.startsWith('#!')) continue
    if (file.endsWith('.py')) {
      let offset = 0
      for (const line of body.split(/\r?\n/).slice(0, 2)) {
        offset += line.length + eol.length
        if (/^\s*#.*?coding[:=]\s*[-\w.]+/.test(line)) shebangEnd = Math.min(offset, body.length)
      }
    }
    const after = `${bom}${body.slice(0, shebangEnd)}${lines.join(eol)}${eol}${body.slice(shebangEnd)}`
    const diff = unifiedDiff(file, patchHunks(before, after))
    if (scrubLegalText(diff) !== diff) continue
    prepared.push({
      evidence,
      patch: { path: file, diff },
      before,
      after,
    })
  }
  return prepared
}
