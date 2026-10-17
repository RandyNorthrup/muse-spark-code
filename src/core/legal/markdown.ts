// Requested export only: the same scrubbed facts and limitations as the panel.
import { UI_TEXT } from '../../shared/constants'
import { fill, formatPercent, plural } from '../../shared/l10n/text'
import { legalScanResultSchema, type LegalScanResult } from '../../shared/legal'
import { scrubLegalText } from './files'

function text(value: string): string {
  return scrubLegalText(value).replaceAll(/([\\`*_{}[\]<>#|])/g, String.raw`\$1`)
}

export function renderLegalMarkdown(report: LegalScanResult): string {
  const result = legalScanResultSchema.parse(report)
  const lines = [
    `# ${text(UI_TEXT.legalScanTitle)}`,
    '',
    text(UI_TEXT.legalScanDisclaimer),
    '',
    text(fill(UI_TEXT.legalDistributionLine, { distribution: result.distribution })),
    ...(result.scope === '' ? [] : [text(result.scope)]),
    ...(result.exclusions.length === 0
      ? []
      : [text(fill(UI_TEXT.legalExclusionsLine, { exclusions: result.exclusions.join('; ') }))]),
    '',
    text(
      result.findings.length === 0
        ? UI_TEXT.legalScanEmpty
        : plural(UI_TEXT.legalFindingsCount, result.findings.length),
    ),
  ]
  for (const finding of result.findings) {
    lines.push(
      '',
      `## ${text(UI_TEXT.legalSeverities[finding.severity])}: ${text(finding.id)}`,
      '',
      text(UI_TEXT.legalCategories[finding.category]),
      ...(finding.file === undefined
        ? []
        : [
            text(
              `${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}${finding.endLine === undefined ? '' : `-${String(finding.endLine)}`}`}`,
            ),
          ]),
      ...(finding.packageName === undefined
        ? []
        : [
            `${text(finding.packageName)}${finding.packageVersion === undefined ? '' : `@${text(finding.packageVersion)}`}`,
          ]),
      ...(finding.licenseExpression === undefined ? [] : [text(finding.licenseExpression)]),
      '',
      text(finding.explanation),
      '',
      text(finding.recommendation),
      '',
      text(fill(UI_TEXT.legalEvidenceLabel, { evidence: finding.evidenceSource })),
      ...(finding.evidenceExcerpt === undefined ? [] : [text(finding.evidenceExcerpt)]),
      text(
        fill(UI_TEXT.legalConfidenceLabel, { confidence: formatPercent(finding.confidence * 100) }),
      ),
      text(finding.fixable ? UI_TEXT.legalFixable : UI_TEXT.legalNotFixable),
    )
  }
  if (result.paidExplanation !== undefined)
    lines.push('', `## ${text(UI_TEXT.legalExplainPaid)}`, '', text(result.paidExplanation))
  if (result.incompleteChecks.length > 0)
    lines.push(
      '',
      text(fill(UI_TEXT.legalScanIncomplete, { checks: result.incompleteChecks.join('; ') })),
    )
  return `${lines.join('\n')}\n`
}
