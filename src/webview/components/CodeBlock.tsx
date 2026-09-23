// A fenced code block: language tag, highlighted body, Copy, Insert at
// cursor and Apply (replace the editor selection). The highlighting is
// memoised on the code, and a block still streaming (its fence not closed
// yet) shows plain text until it closes (M25), so a long block is not
// re-highlighted whole on every delta.

import { useMemo } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { highlight, resolveLanguage } from '../highlight'
import { useCopiedFlag } from '../useCopiedFlag'

export interface CodeBlockProps {
  readonly code: string
  readonly language: string | undefined
  /** The fence is still open while the reply streams. */
  readonly isOpen?: boolean
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onApply: (text: string) => void
}

export function CodeBlock({
  code,
  language,
  isOpen = false,
  onCopy,
  onInsert,
  onApply,
}: CodeBlockProps) {
  const [isCopied, markCopied] = useCopiedFlag()
  const resolved = resolveLanguage(language)
  // highlight.js returns HTML it escaped itself; nothing from the model
  // reaches the DOM unescaped.
  const html = useMemo(
    () => (isOpen ? undefined : { __html: highlight(code, language) }),
    [code, language, isOpen],
  )
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{resolved ?? language ?? ''}</span>
        <span className="code-block-actions">
          <button
            type="button"
            className="code-block-button"
            onClick={() => {
              onCopy(code)
              markCopied()
            }}
          >
            {isCopied ? UI_TEXT.copiedCode : UI_TEXT.copyCode}
          </button>
          <button
            type="button"
            className="code-block-button"
            onClick={() => {
              onInsert(code)
            }}
          >
            {UI_TEXT.insertCode}
          </button>
          <button
            type="button"
            className="code-block-button"
            onClick={() => {
              onApply(code)
            }}
          >
            {UI_TEXT.applyCode}
          </button>
        </span>
      </div>
      <pre className="code-block-body">
        {html === undefined ? (
          <code className="hljs">{code}</code>
        ) : (
          <code className="hljs" dangerouslySetInnerHTML={html} />
        )}
      </pre>
    </div>
  )
}
