// A fenced code block: language tag, highlighted body, Copy, Insert at
// cursor and Apply (replace the editor selection).

import { useEffect, useState } from 'react'
import { COPIED_FEEDBACK_MS, UI_TEXT } from '../../shared/constants'
import { highlight, resolveLanguage } from '../highlight'

export interface CodeBlockProps {
  readonly code: string
  readonly language: string | undefined
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onApply: (text: string) => void
}

export function CodeBlock({ code, language, onCopy, onInsert, onApply }: CodeBlockProps) {
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
  const resolved = resolveLanguage(language)
  // highlight.js returns HTML it escaped itself; nothing from the model
  // reaches the DOM unescaped.
  const html = { __html: highlight(code, language) }
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
              setIsCopied(true)
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
        <code className="hljs" dangerouslySetInnerHTML={html} />
      </pre>
    </div>
  )
}
