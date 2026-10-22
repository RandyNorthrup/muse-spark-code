// M125 lane K (D107): bounded evidence assembly. Every string a check
// judges over or shows in its slots is capped: small fast models read
// these questions, and a shown slot must never carry an unbounded tool
// output into a request or a note. Cut fields end with "..." so neither
// the model nor the person mistakes an excerpt for the whole.
import { JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS } from '../../../../shared/constants'

const TRUNCATION_MARK = '...'

/** Cap one evidence field; short text passes through untouched. */
export function boundEvidence(text: string): string {
  return text.length <= JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS
    ? text
    : `${text.slice(0, JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`
}

/** Join evidence lines into one bounded field. */
export function joinEvidence(lines: readonly string[]): string {
  return boundEvidence(lines.join('\n'))
}

/**
Head and tail of a long output (§7.3: the last test and build outputs);
short output passes through whole. Both ends are exact; the middle is
replaced, never silently dropped.
*/
export function headTailEvidence(output: string): string {
  if (output.length <= JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS) return output
  const middle = `\n${TRUNCATION_MARK}\n`
  const half = Math.floor((JUDGE_FAST_CHECK_EVIDENCE_MAX_CHARS - middle.length) / 2)
  return `${output.slice(0, half)}${middle}${output.slice(output.length - half)}`
}
