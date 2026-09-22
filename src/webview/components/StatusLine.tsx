// The spinner line under the last row while a turn runs: a sparkle and a
// verb that changes every few seconds, as the Claude Code panel shows.

import { useEffect, useState } from 'react'
import { STATUS_VERB_INTERVAL_MS, STATUS_VERBS } from '../../shared/constants'

export function StatusLine() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % STATUS_VERBS.length)
    }, STATUS_VERB_INTERVAL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return (
    <li className="status-line" role="status" aria-live="polite">
      <span className="status-spark" aria-hidden="true">
        ✦
      </span>
      <span>{STATUS_VERBS[index]}</span>
    </li>
  )
}
