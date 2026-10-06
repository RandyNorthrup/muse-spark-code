import { describe, expect, it } from 'vitest'
import { renderLegalMarkdown } from '../../src/core/legal/markdown'
import { UI_TEXT } from '../../src/shared/constants'
import type { LegalScanResult } from '../../src/shared/legal'

const report: LegalScanResult = {
  version: 1,
  ruleVersion: 'r1',
  dataVersion: 'd1',
  scope: 'src',
  distribution: 'Source checkout',
  exclusions: ['dist/generated.ts'],
  incompleteChecks: ['Unresolved dependency'],
  findings: [
    {
      id: 'dependency/1/1',
      category: 'dependencyLicense',
      severity: 'should-fix',
      file: 'package.json',
      line: 2,
      endLine: 3,
      packageName: 'example',
      packageVersion: '1.0.0',
      licenseExpression: 'MIT OR Apache-2.0',
      evidenceSource: 'Manifest reader',
      confidence: 0.9,
      explanation: 'Verify distributed terms',
      recommendation: 'Keep the upstream notice',
      fixable: false,
      evidenceExcerpt: 'Contact person@example.invalid <script>',
    },
  ],
}

describe('requested legal Markdown', () => {
  it('preserves each report field and disclaimer while scrubbing PII and escaping markup', () => {
    const rendered = renderLegalMarkdown(report)
    for (const value of [
      UI_TEXT.legalScanDisclaimer,
      'Should fix',
      'dependency/1/1',
      'package.json:2-3',
      'example@1.0.0',
      'MIT OR Apache-2.0',
      'Manifest reader',
      '90%',
      'Recommendation only',
      'Unresolved dependency',
      'dist/generated.ts',
      'Verify distributed terms',
      'Keep the upstream notice',
    ]) {
      expect(rendered).toContain(value)
    }
    expect(rendered).not.toContain('person@example.invalid')
    expect(rendered).not.toContain('<script>')
  })
  it('validates the report instead of exporting malformed data', () => {
    expect(() =>
      renderLegalMarkdown({
        ...report,
        findings: report.findings.map((finding) => ({ ...finding, confidence: NaN })),
      }),
    ).toThrow()
  })
})
