// The spinner line under the last row while a turn runs: a sparkle and a
// verb that changes every few seconds, as the Claude Code panel shows. It is
// not a live region (M25): a polite region here read a new verb out every
// few seconds for as long as the turn ran. The app's one live region says
// when the turn ends.

import { useEffect, useState } from 'react'
import { STATUS_VERB_INTERVAL_MS, UI_TEXT } from '../../shared/constants'

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
      <span className="status-spark" aria-hidden="true">
        ✦
      </span>
      <span>{verbs[index]}</span>
    </li>
  )
}
