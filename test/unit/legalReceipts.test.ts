import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLicenceReviews } from '../../src/core/legal/depLicenses'
import { identifyLicenseText } from '../../src/core/legal/projectLicense'
import { scanLegal } from '../../src/core/legal/scan'
import { renderLegalMarkdown } from '../../src/core/legal/markdown'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { runLegalCommand } from '../../src/runtime/legal/runLegal'
import type { LegalScanResult } from '../../src/shared/legal'
import {
  LEGAL_FINDINGS_PER_RULE_MAX,
  LEGAL_REVIEW_FILE,
  LEGAL_DEPENDENCIES_MAX,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_VERSION_MAX_CHARS,
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
} from '../../src/shared/constants'
import {
  BUNDLE_OUTPUT,
  BUNDLE_TEXT,
  FULL_MIT_LICENSE,
  hashEvidence,
  snapshotFrom,
} from './legal/helpers'

const LICENCE = readFileSync(path.join(__dirname, '../../node_modules/lz-string/LICENSE'), 'utf8')
const REVIEW = {
  package: 'lz-string',
  version: '1.5.0',
  sha256: fingerprint(LICENCE),
  spdx: 'MIT',
  reason: 'MIT terms are unchanged; the copyright notice names the lowercase holder pieroxy.',
}

function workspace(
  receipt: unknown = [REVIEW],
  licence = LICENCE,
  version = REVIEW.version,
): Record<string, string> {
  return {
    LICENSE: FULL_MIT_LICENSE,
    'package.json': JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
    'package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/lz-string': { version, license: 'MIT' },
      },
    }),
    'node_modules/lz-string/package.json': JSON.stringify({
      name: 'lz-string',
      version,
      license: 'MIT',
    }),
    'node_modules/lz-string/LICENSE': licence,
    [LEGAL_REVIEW_FILE]: JSON.stringify(receipt),
    [BUNDLE_OUTPUT]: BUNDLE_TEXT,
  }
}

function scan(files: Record<string, string>) {
  return scanLegal(snapshotFrom(files), {
    headerPolicy: 'optional',
    distribution: hashEvidence(files),
  })
}

function expectReview(result: LegalScanResult): void {
  expect(result.incompleteChecks.some((check) => check.includes('lz-string'))).toBe(true)
  expect(result.findings.some((finding) => finding.evidenceSource === LEGAL_REVIEW_FILE)).toBe(
    false,
  )
}

describe('workspace licence review receipts', () => {
  it('proves the real remaining vendor difference is solely the holder notice', () => {
    expect(identifyLicenseText(LICENCE)).toMatchObject({ id: 'MIT', exact: false })
    expect(
      identifyLicenseText(
        LICENCE.replace('Copyright (c) 2013 pieroxy', 'Copyright (c) 2013 Example Corp'),
      ),
    ).toMatchObject({ id: 'MIT', exact: true })
    expect(fingerprint(LICENCE)).toBe(
      '433fc9dfe659dbfb1e91eed8351f13651e97bfa3ac6d03394c3d63f61d4bbc80',
    )
  })

  it('issues only the reviewed lz-string receipt and verifies its own package declaration', () => {
    const root = path.join(__dirname, '../..')
    const entries = readLicenceReviews(
      snapshotFrom({
        [LEGAL_REVIEW_FILE]: readFileSync(path.join(root, LEGAL_REVIEW_FILE), 'utf8'),
      }),
      [],
    )
    expect(entries).toEqual([REVIEW])
    const metadata: unknown = JSON.parse(
      readFileSync(path.join(root, 'node_modules/lz-string/package.json'), 'utf8'),
    )
    expect(metadata).toMatchObject({
      name: 'lz-string',
      version: REVIEW.version,
      license: REVIEW.spdx,
    })
  })

  it('keeps the strict default without a receipt', () => {
    const result = scan(workspace([]))
    expect(result.incompleteChecks.some((check) => check.includes('lz-string'))).toBe(true)
  })

  it('resolves only the receipt text check and reports its reason visibly', () => {
    const result = scan(workspace())
    expect(result.incompleteChecks).toEqual([])
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        packageName: 'lz-string',
        packageVersion: '1.5.0',
        licenseExpression: 'MIT',
        evidenceSource: LEGAL_REVIEW_FILE,
        explanation: `Reviewed by receipt: ${REVIEW.reason}`,
      }),
    )
  })

  it.each([
    { package: 'another-package' },
    { version: '1.5.1' },
    { sha256: '0'.repeat(64) },
    { spdx: 'BSD-3-Clause' },
  ])('refuses a receipt whose identity differs: %j', (change) => {
    const result = scan(workspace([{ ...REVIEW, ...change }]))
    expectReview(result)
  })

  it.each(['\n', '\r\n', '\u{FEFF}'])(
    'voids the receipt after any licence byte change: %j',
    (change) => {
      expect(scan(workspace([REVIEW], LICENCE + change)).incompleteChecks.length).toBeGreaterThan(0)
    },
  )

  it('voids the receipt on a package version bump', () => {
    expect(scan(workspace([REVIEW], LICENCE, '1.5.1')).incompleteChecks.length).toBeGreaterThan(0)
  })

  it('requires the exact native byte digest when the snapshot offers it', () => {
    const files = workspace()
    const result = scanLegal(
      {
        ...snapshotFrom(files),
        readFileHash: (file) =>
          file.endsWith('lz-string/LICENSE') ? undefined : fingerprint(files[file] ?? ''),
      },
      { headerPolicy: 'optional', distribution: hashEvidence(files) },
    )
    expectReview(result)
  })

  it('requires a single agreeing declaration, even when alternatives include the found SPDX id', () => {
    const files = workspace()
    const license = 'MIT OR BSD-3-Clause'
    files['package-lock.json'] = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/lz-string': { version: '1.5.0', license },
      },
    })
    files['node_modules/lz-string/package.json'] = JSON.stringify({
      name: 'lz-string',
      version: '1.5.0',
      license,
    })
    const result = scan(files)
    expect(result.incompleteChecks.length).toBeGreaterThan(0)
    expect(result.findings.some((finding) => finding.evidenceSource === LEGAL_REVIEW_FILE)).toBe(
      false,
    )
  })

  it.each([
    { ...REVIEW, reason: 'two\nlines' },
    { ...REVIEW, reason: 'two\u{85}lines' },
    { ...REVIEW, reason: 'two\u{2028}lines' },
    { ...REVIEW, reason: 'two\u{2029}lines' },
    { ...REVIEW, reason: ' ' },
    { ...REVIEW, sha256: 'not-a-hash' },
    { ...REVIEW, spdx: 'MIT OR BSD-3-Clause' },
    { ...REVIEW, spdx: 'MadeUp' },
    { ...REVIEW, path: '../LICENSE' },
    { ...REVIEW, version: '' },
    { ...REVIEW, package: '' },
    { ...REVIEW, version: 'v'.repeat(LEGAL_VERSION_MAX_CHARS + 1) },
    { ...REVIEW, package: 'p'.repeat(LEGAL_TEXT_MAX_CHARS + 1) },
    { ...REVIEW, spdx: 's'.repeat(LEGAL_TEXT_MAX_CHARS + 1) },
    { ...REVIEW, reason: 'r'.repeat(LEGAL_EVIDENCE_EXCERPT_MAX_CHARS + 1) },
  ])('fails closed on malformed receipt entries: %j', (entry) => {
    const result = scan(workspace([entry]))
    expect(result.incompleteChecks.some((check) => check.includes('valid licence-review'))).toBe(
      true,
    )
    expect(result.findings.some((finding) => finding.evidenceSource === LEGAL_REVIEW_FILE)).toBe(
      false,
    )
  })

  it('refuses a receipt array over its declared entry bound', () => {
    const incomplete: string[] = []
    const entries = Array.from({ length: LEGAL_DEPENDENCIES_MAX + 1 }, () => REVIEW)
    expect(
      readLicenceReviews(
        snapshotFrom({ [LEGAL_REVIEW_FILE]: JSON.stringify(entries) }),
        incomplete,
      ),
    ).toEqual([])
    expect(incomplete).toHaveLength(1)
  })

  it('refuses malformed JSON and ignores nested review files', () => {
    const snapshot = snapshotFrom({
      [LEGAL_REVIEW_FILE]: '{',
      [`nested/${LEGAL_REVIEW_FILE}`]: JSON.stringify([REVIEW]),
    })
    const incomplete: string[] = []
    expect(readLicenceReviews(snapshot, incomplete)).toEqual([])
    expect(incomplete).toHaveLength(1)
    const nestedOnly = snapshotFrom({ [`nested/${LEGAL_REVIEW_FILE}`]: JSON.stringify([REVIEW]) })
    const nestedIncomplete: string[] = []
    expect(readLicenceReviews(nestedOnly, nestedIncomplete)).toEqual([])
    expect(nestedIncomplete).toEqual([])
  })

  it('keeps declaration/text conflicts unresolved even with a matching receipt', () => {
    const files = workspace()
    files['node_modules/lz-string/package.json'] = JSON.stringify({
      name: 'lz-string',
      version: '1.5.0',
      license: 'BSD-3-Clause',
    })
    const result = scan(files)
    expect(result.incompleteChecks.length).toBeGreaterThan(0)
    expect(
      result.findings.some((finding) => finding.explanation.includes('License evidence conflict')),
    ).toBe(true)
  })

  it.each(['text', 'json'] as const)(
    'shows reviewed by receipt in %s and exits zero',
    async (format) => {
      const result = scan(workspace())
      const rendered = await runLegalCommand({
        options: { format, registry: false, out: undefined },
        deps: {
          scan: () => Promise.resolve({ result, registryTargets: [] }),
          fetch: () => {
            throw new Error('no registry fetch on the keyless local path')
          },
          writeFile: () => Promise.resolve(),
        },
      })
      expect(rendered.exitCode).toBe(0)
      expect(rendered.out).toContain('Reviewed by receipt:')
      expect(rendered.out).toContain(REVIEW.reason)
      expect(renderLegalMarkdown(result)).toContain('Reviewed by receipt:')
    },
  )

  it('does not report a complete scan when the receipt finding cannot fit', () => {
    const files: Record<string, string> = workspace([])
    const packages: Record<string, { version: string; license: string }> = {}
    const reviews = Array.from({ length: LEGAL_FINDINGS_PER_RULE_MAX + 1 }, (_, index) => {
      const name = `reviewed-${String(index)}`
      packages[`node_modules/${name}`] = { version: '1.5.0', license: 'MIT' }
      files[`node_modules/${name}/LICENSE`] = LICENCE
      files[`node_modules/${name}/package.json`] = JSON.stringify({
        name,
        version: '1.5.0',
        license: 'MIT',
      })
      return { ...REVIEW, package: name }
    })
    files['package-lock.json'] = JSON.stringify({ lockfileVersion: 3, packages })
    files[LEGAL_REVIEW_FILE] = JSON.stringify(reviews)
    delete files['node_modules/lz-string/LICENSE']
    delete files['node_modules/lz-string/package.json']
    expect(
      scan(files).incompleteChecks.some((check) => check.includes('report truncated for receipt')),
    ).toBe(true)
  })
})
