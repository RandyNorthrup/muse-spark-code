// Only the code body waits for highlighting. Its label, actions and safe
// plain text remain visible while this chunk loads.
import { useMemo } from 'react'
import { highlight } from '../highlightRuntime'

export function HighlightedCode({
  code,
  language,
}: {
  readonly code: string
  readonly language: string
}) {
  // highlight.js escapes model text before adding its own markup.
  const html = useMemo(() => ({ __html: highlight(code, language) }), [code, language])
  return <code className="hljs" dangerouslySetInnerHTML={html} />
}
