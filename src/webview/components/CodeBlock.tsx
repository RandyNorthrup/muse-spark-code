// A fenced code block: language tag, highlighted body, Copy, Insert at
// cursor and Apply (replace the editor selection); a read-only view (a share
// file, M84) passes neither of the last two and shows Copy alone. The
// highlighting is memoised on the code, and a block still streaming (its
// fence not closed yet) shows plain text until it closes (M25), so a long
// block is not re-highlighted whole on every delta.

import { lazy, Suspense } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { resolveLanguage } from '../highlight'
import { useCopiedFlag } from '../useCopiedFlag'

const HighlightedCode = lazy(async () => {
  const { HighlightedCode } = await import('./HighlightedCode')
  return { default: HighlightedCode }
})

export interface CodeBlockProps {
  readonly code: string
  readonly language: string | undefined
  /** The fence is still open while the reply streams. */
  readonly isOpen?: boolean
  /** The label as written (a plan's whole info string, M79) in place of the resolved language. */
  readonly label?: string | undefined
  readonly onCopy: (text: string) => void
  /** Absent in a read-only view: the button is not shown. */
  readonly onInsert?: ((text: string) => void) | undefined
  /** Absent in a read-only view: the button is not shown. */
  readonly onApply?: ((text: string) => void) | undefined
}

export function CodeBlock({
  code,
  language,
  isOpen = false,
  label,
  onCopy,
  onInsert,
  onApply,
}: CodeBlockProps) {
  const [isCopied, markCopied] = useCopiedFlag()
  const resolved = resolveLanguage(language)
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{label ?? resolved ?? language ?? ''}</span>
        <span className="code-block-actions">
          <button
            type="button"
            className="code-block-button chat-control"
            onClick={() => {
              onCopy(code)
              markCopied()
            }}
          >
            {isCopied ? UI_TEXT.copiedCode : UI_TEXT.copyCode}
          </button>
          {onInsert === undefined ? null : (
            <button
              type="button"
              className="code-block-button chat-control"
              onClick={() => {
                onInsert(code)
              }}
            >
              {UI_TEXT.insertCode}
            </button>
          )}
          {onApply === undefined ? null : (
            <button
              type="button"
              className="code-block-button chat-control"
              onClick={() => {
                onApply(code)
              }}
            >
              {UI_TEXT.applyCode}
            </button>
          )}
        </span>
      </div>
      {/* Keyboard users need to reach and scroll long lines, including in share files. */}
      <pre className="code-block-body chat-control" tabIndex={0}>
        {isOpen || resolved === undefined ? (
          <code className="hljs">{code}</code>
        ) : (
          <Suspense fallback={<code className="hljs">{code}</code>}>
            <HighlightedCode code={code} language={resolved} />
          </Suspense>
        )}
      </pre>
    </div>
  )
}
