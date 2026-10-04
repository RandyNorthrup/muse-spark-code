// A review's findings as a list (M70, PLAN.md D49): the reply's fenced
// `muse-review` block, parsed, each finding with its severity, its title,
// and its file and line, which opens the file at that line. A location that
// climbs out of the workspace or starts at a root is shown, never opened
// (the reply's links follow the same rule, M25).

import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { LineRange } from '../../shared/protocol'
import { knownSeverity, type ReviewFinding } from '../../shared/reviewFindings'
import { linkTarget } from '../links'

export interface ReviewFindingsProps {
  readonly findings: readonly ReviewFinding[]
  /** A workspace file at the finding's lines; without it the locations are text. */
  readonly onOpenFile: ((path: string, range: LineRange | undefined) => void) | undefined
}

const UNKNOWN_SEVERITY = 'other'

function rangeOf(finding: ReviewFinding): LineRange | undefined {
  return finding.line === undefined
    ? undefined
    : { startLine: finding.line, endLine: Math.max(finding.line, finding.endLine ?? finding.line) }
}

/** `src/a.ts:12` or `src/a.ts:12-15`, as the finding names it. */
function locationOf(finding: ReviewFinding, range: LineRange | undefined): string {
  if (range === undefined) {
    return finding.file
  }
  const lines =
    range.endLine === range.startLine
      ? String(range.startLine)
      : `${String(range.startLine)}-${String(range.endLine)}`
  return `${finding.file}:${lines}`
}

function Finding({
  finding,
  onOpenFile,
}: {
  readonly finding: ReviewFinding
  readonly onOpenFile: ReviewFindingsProps['onOpenFile']
}) {
  const severity = knownSeverity(finding.severity)
  const range = rangeOf(finding)
  const location = locationOf(finding, range)
  const target = linkTarget(finding.file)
  return (
    <li className="review-finding">
      <p className="review-finding-head">
        {finding.severity === undefined ? null : (
          <span className={`review-severity review-severity-${severity ?? UNKNOWN_SEVERITY}`}>
            {severity === undefined ? finding.severity : UI_TEXT.reviewSeverities[severity]}
          </span>
        )}
        <span className="review-finding-title" dir="auto">
          {finding.title}
        </span>
      </p>
      {onOpenFile !== undefined && target.kind === 'file' ? (
        <button
          type="button"
          className="tool-more review-finding-location"
          aria-label={fill(UI_TEXT.reviewOpenFinding, { location })}
          onClick={() => {
            onOpenFile(target.path, range ?? target.range)
          }}
        >
          {location}
        </button>
      ) : (
        <code className="markdown-inline">{location}</code>
      )}
      {finding.detail === undefined || finding.detail === '' ? null : (
        <p className="review-finding-detail" dir="auto">
          {finding.detail}
        </p>
      )}
    </li>
  )
}

export function ReviewFindings({ findings, onOpenFile }: ReviewFindingsProps) {
  return (
    <section className="review-findings" aria-label={UI_TEXT.reviewFindingsLabel}>
      <p className="review-findings-heading">
        {plural(UI_TEXT.reviewFindingsHeading, findings.length)}
      </p>
      {findings.length === 0 ? (
        <p className="review-finding-detail">{UI_TEXT.reviewNoFindings}</p>
      ) : (
        <ol className="review-findings-list">
          {findings.map((finding, index) => (
            <Finding key={String(index)} finding={finding} onOpenFile={onOpenFile} />
          ))}
        </ol>
      )}
    </section>
  )
}
