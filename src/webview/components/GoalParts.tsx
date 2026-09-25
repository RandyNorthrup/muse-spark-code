// What a goal's tool row (M43) and the goal strip (M45) both show: the
// progress bar and what the agent is doing now and next.

import type { ReactNode } from 'react'
import { GOAL_PERCENT_MAX, UI_TEXT } from '../../shared/constants'

/** MSP passes the percentage verbatim (over 100 included): the bar clamps it. */
export function GoalBar({ percent }: { readonly percent: number }) {
  return (
    <progress
      className="usage-bar"
      max={GOAL_PERCENT_MAX}
      value={Math.min(Math.max(percent, 0), GOAL_PERCENT_MAX)}
      aria-label={UI_TEXT.goalProgress}
    />
  )
}

/** "Now" and "Next", each when reported, and any further facts after them. */
export function GoalWork({
  currentWork,
  nextWork,
  children,
}: {
  readonly currentWork: string | undefined
  readonly nextWork: string | undefined
  readonly children?: ReactNode
}) {
  return (
    <dl className="tool-facts">
      {currentWork === undefined ? null : (
        <>
          <dt>{UI_TEXT.goalNow}</dt>
          <dd dir="auto">{currentWork}</dd>
        </>
      )}
      {nextWork === undefined ? null : (
        <>
          <dt>{UI_TEXT.goalNext}</dt>
          <dd dir="auto">{nextWork}</dd>
        </>
      )}
      {children}
    </dl>
  )
}
