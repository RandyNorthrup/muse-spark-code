// "Copied" feedback for a copy button: true for COPIED_FEEDBACK_MS after
// `markCopied`, shared by the code-block Copy and the response Copy (M15).

import { useCallback, useEffect, useState } from 'react'
import { COPIED_FEEDBACK_MS } from '../shared/constants'

export function useCopiedFlag(): readonly [isCopied: boolean, markCopied: () => void] {
  const [isCopied, setIsCopied] = useState(false)
  useEffect(() => {
    if (!isCopied) {
      return
    }
    const timer = setTimeout(() => {
      setIsCopied(false)
    }, COPIED_FEEDBACK_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [isCopied])
  const markCopied = useCallback(() => {
    setIsCopied(true)
  }, [])
  return [isCopied, markCopied]
}
