// The working line under the last row while a turn runs: a bullet, trace and a
// verb that changes every few seconds, as the Claude Code panel shows. It is
// not a live region (M25): a polite region here read a new verb out every
// few seconds for as long as the turn ran. The app's one live region says
// when the turn ends.

import { useEffect, useState } from 'react'
import { STATUS_VERB_INTERVAL_MS, UI_TEXT } from '../../shared/constants'
import { HeartbeatTrace } from './HeartbeatTrace'

export function StatusLine() {
  const verbs = Object.values(UI_TEXT.statusVerbs)
  const verbCount = verbs.length
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % verbCount)
    }, STATUS_VERB_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [verbCount])
  return (
    <li className="status-line">
      <span className="status-verb">
        <span className="tool-dot tool-dot-running" aria-hidden="true" />
        {/* Every verb sits in the same grid cell and only the current one is
            visible, so the box is as wide as the longest verb in this
            language and the trace after it never moves (owner, 2026-10-04). */}
        <span className="status-verb-text">
          {verbs.map((verb, verbIndex) =>
            verbIndex === index ? (
              <span key={verb}>{verb}</span>
            ) : (
              <span key={verb} className="status-verb-sizer" aria-hidden="true">
                {verb}
              </span>
            ),
          )}
        </span>
      </span>
      <HeartbeatTrace />
    </li>
  )
}
