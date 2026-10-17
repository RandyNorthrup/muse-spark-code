import { describe, expect, it } from 'vitest'
import { scanLegal } from '../../src/core/legal/scan'
import { scanHeaders } from '../../src/core/legal/headers'
import { identifyLicenseText, scanProjectLicense } from '../../src/core/legal/projectLicense'
import {
  LEGAL_EXCLUSIONS_MAX,
  LEGAL_INCOMPLETE_MAX,
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_FINDINGS_MAX,
  LEGAL_PATH_MAX_CHARS,
} from '../../src/shared/constants'
import { snapshotFrom } from './legal/helpers'

describe('legal coverage and metadata', () => {
  it('bounds package and ignore patterns without evaluating a dependency admitted only by the omitted pattern', () => {
    const tree = snapshotFrom({
      LICENSE: 'MIT License\n',
      'package-lock.json':
        '{"lockfileVersion":3,"packages":{"node_modules/x":{"version":"1","license":"GPL-3.0-only"}}}',
      'node_modules/x/index.js': 'x',
    })
    const report = scanLegal(tree, {
      headerPolicy: 'off',
      distribution: {
        packageFiles: [
          ...Array.from({ length: LEGAL_FINDINGS_MAX }, () => 'absent'),
          'node_modules/x/index.js',
        ],
        vscodeignoreText: Array.from({ length: LEGAL_FINDINGS_MAX + 1 }, () => 'ignored').join(
          '\n',
        ),
      },
    })
    expect(report.incompleteChecks.join(' ')).toContain('pattern count')
    expect(report.incompleteChecks.join(' ')).toContain('.vscodeignore pattern')
    expect(report.findings.some((finding) => finding.severity === 'blocker')).toBe(false)
  })

  it('bounds dependency evidence and rejects overlong package patterns explicitly', () => {
    const report = scanLegal(
      snapshotFrom({
        'package-lock.json': JSON.stringify({
          lockfileVersion: 3,
          packages: {
            ...Object.fromEntries(
              Array.from({ length: LEGAL_FINDINGS_MAX }, (_, index) => [
                `node_modules/x${String(index)}`,
                { version: '1', license: 'MIT' },
              ]),
            ),
            'node_modules/zz-after-bound': { version: '1', license: 'GPL-3.0-only' },
          },
        }),
        'package.json': JSON.stringify({ files: ['x'.repeat(LEGAL_PATH_MAX_CHARS + 1)] }),
      }),
      { headerPolicy: 'off' },
    )
    expect(report.incompleteChecks.join(' ')).toContain('dependency evidence bound')
    expect(report.incompleteChecks.join(' ')).toContain('unsupported patterns')
    expect(report.findings.some((finding) => finding.packageName === 'zz-after-bound')).toBe(false)
  })

  it('attributes assets lacking provenance and copied-code references without claiming infringement', () => {
    const report = scanLegal(
      snapshotFrom({
        'art.png': 'binary asset',
        'copy.ts':
          '// Adapted from https://stackoverflow.com/questions/123/example\nexport const value = 1\n',
      }),
      { headerPolicy: 'off' },
    )
    expect(
      report.findings.some(
        (finding) => finding.file === 'art.png' && finding.category === 'distribution',
      ),
    ).toBe(true)
    expect(
      report.findings.some(
        (finding) => finding.file === 'copy.ts' && finding.explanation.includes('provenance'),
      ),
    ).toBe(true)
    expect(report.findings.every((finding) => !finding.fixable)).toBe(true)
  })

  it('does not let path-only REUSE or license-only sidecars suppress copyright checks', () => {
    const subject = snapshotFrom({
      'REUSE.toml': '[[annotations]]\npath = "x.ts"\nSPDX-License-Identifier = "MIT"\n',
      'x.ts': 'x',
      'y.ts': 'y',
      'y.ts.license': 'SPDX-License-Identifier: MIT\n',
    })
    const result = scanHeaders(subject, 'required', ['MIT'])
    expect(
      result.findings.some(
        (finding) => finding.file === 'x.ts' && finding.category === 'copyrightHeader',
      ),
    ).toBe(true)
    expect(
      result.findings.some(
        (finding) => finding.file === 'y.ts' && finding.category === 'copyrightHeader',
      ),
    ).toBe(true)
    expect(result.incomplete.join(' ')).toContain('REUSE')
  })

  it('keeps project AND and OR declarations distinct and reports a missing license file', () => {
    const result = scanProjectLicense(snapshotFrom({}), [
      { file: 'package.json', raw: 'MIT AND Apache-2.0' },
      { file: 'Cargo.toml', raw: 'MIT OR Apache-2.0' },
    ])
    expect(result.findings.some((finding) => finding.explanation.includes('disagree'))).toBe(true)
    expect(result.findings.some((finding) => finding.explanation.includes('license file'))).toBe(
      true,
    )
  })

  it('recognizes LGPL 2.0, 2.1 and 3.0 without changing their versions', () => {
    expect(identifyLicenseText('GNU LIBRARY GENERAL PUBLIC LICENSE\nVersion 2\n')?.id).toBe(
      'LGPL-2.0-only',
    )
    expect(identifyLicenseText('GNU LESSER GENERAL PUBLIC LICENSE\nVersion 2.1\n')?.id).toBe(
      'LGPL-2.1-only',
    )
    expect(identifyLicenseText('GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3\n')?.id).toBe(
      'LGPL-3.0-only',
    )
  })

  it('reports heuristic matching, assets and freshness as unchecked', () => {
    const result = scanLegal(snapshotFrom({ LICENSE: 'MIT License\n', 'asset.png': 'png' }), {
      headerPolicy: 'off',
      distribution: { bundleInputs: ['asset.png'] },
    })
    expect(result.incompleteChecks.join(' ')).toContain('matching')
    expect(result.incompleteChecks.join(' ')).toContain('assets')
    expect(result.incompleteChecks.join(' ')).toContain('freshness')
  })

  it('caps generated exclusions and incomplete checks and marks omitted entries', () => {
    const result = scanLegal(
      {
        ...snapshotFrom(
          Object.fromEntries(
            Array.from({ length: LEGAL_EXCLUSIONS_MAX + 1 }, (_, index) => [
              `dist/${String(index)}.ts`,
              'x',
            ]),
          ),
        ),
        incompleteChecks: Array.from(
          { length: LEGAL_INCOMPLETE_MAX + 1 },
          (_, index) => `not checked: fixture ${String(index)}`,
        ),
      },
      { headerPolicy: 'required' },
    )
    expect(result.exclusions).toHaveLength(LEGAL_EXCLUSIONS_MAX)
    expect(result.incompleteChecks).toHaveLength(LEGAL_INCOMPLETE_MAX)
    expect(result.incompleteChecks.at(-1)).toContain('omitted')
  })

  it('bounds aggregate text across individually permitted files', () => {
    const text = 'x'.repeat(LEGAL_TEXT_MAX_CHARS * LEGAL_FINDINGS_MAX)
    const report = scanLegal(
      snapshotFrom(
        Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [`source${String(index)}.ts`, text]),
        ),
      ),
      { headerPolicy: 'required' },
    )
    expect(report.incompleteChecks.join(' ')).toContain('budget')
  })

  it('reports oversized and binary source text and preserves cancellation and unreadable markers', () => {
    const report = scanLegal(
      snapshotFrom({
        'x.ts': 'x'.repeat(LEGAL_TEXT_MAX_CHARS * LEGAL_FINDINGS_MAX + 1),
        'binary.ts': 'a\u{0}b',
      }),
      { headerPolicy: 'required' },
    )
    expect(report.incompleteChecks.join(' ')).toContain('budget')
    expect(report.incompleteChecks.join(' ')).toContain('binary')
    const failed = scanLegal(
      {
        files: ['x.ts'],
        readFile: () => {
          throw new Error('private details')
        },
      },
      { headerPolicy: 'required' },
    )
    expect(failed.incompleteChecks.join(' ')).toContain('cannot be read')
    expect(JSON.stringify(failed)).not.toContain('private details')
  })
})
