import { useEffect, useState } from 'react'
import { MILLISECONDS_PER_SECOND } from '../shared/constants'

/** A mounted agent surface expires the named output window without another host event. */
export function useAgentClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, MILLISECONDS_PER_SECOND)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return now
}
