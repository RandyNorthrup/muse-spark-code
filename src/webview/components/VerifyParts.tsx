// The verify loop in the transcript (M68, PLAN.md D49): the body of a "Check
// edits" or "Run checks" row, and an edit's `then_run` shown as the call's
// second result under its diff. The words are shared with the Markdown
// export (src/shared/verifyText.ts).

import type { ThenRunResult } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { thenRunOutcomeText } from '../../shared/verifyText'
import { Clipped } from './ToolBlocks'

/** The check's output, as the model read it. */
export function VerifyBody({
  output,
  onOpen,
}: {
  readonly output: string
  readonly onOpen: () => void
}) {
  return output === '' ? null : <Clipped text={output} className="tool-output" onOpen={onOpen} />
}

/**
 * An edit's `then_run`: the command (as it ran, when a hook rewrote it),
 * what it printed, and how it ended.
 */
export function ThenRunBlock({ result }: { readonly result: ThenRunResult }) {
  return (
    <div className="shell then-run">
      <div className="tool-detail-meta">{UI_TEXT.thenRunLabel}</div>
      <div className="shell-box">
        <span className="shell-label">{UI_TEXT.inLabel}</span>
        <pre className="tool-pre">{result.command}</pre>
      </div>
      {result.output === '' ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.outLabel}</span>
          <Clipped text={result.output} className="shell-out" />
        </div>
      )}
      <p
        className={
          result.outcome === 'passed' ? 'tool-detail-meta' : 'tool-detail-meta then-run-failed'
        }
      >
        {thenRunOutcomeText(result)}
      </p>
    </div>
  )
}
