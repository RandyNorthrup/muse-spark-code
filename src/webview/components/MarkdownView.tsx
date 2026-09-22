// Assistant text as GitHub-flavoured markdown. Raw HTML is skipped (never
// rendered), images are reduced to their alt text (the CSP allows no remote
// images), links go through the host, and fenced code becomes CodeBlock.

import { type ComponentProps, memo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

export interface MarkdownViewProps {
  readonly text: string
  readonly onOpenLink: (url: string) => void
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
}

const LANGUAGE_CLASS = /language-([\w+#-]+)/
const PLUGINS = [remarkGfm]

function languageOf(className: string | undefined): string | undefined {
  return className === undefined ? undefined : LANGUAGE_CLASS.exec(className)?.[1]
}

function textOf(children: ReactNode): string {
  if (typeof children === 'string') {
    return children
  }
  return Array.isArray(children) ? children.map((child) => textOf(child as ReactNode)).join('') : ''
}

function MarkdownViewInner({ text, onOpenLink, onCopy, onInsert }: MarkdownViewProps) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={PLUGINS}
        skipHtml
        components={{
          a: ({ href, children }: ComponentProps<'a'>) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (href !== undefined) {
                  onOpenLink(href)
                }
              }}
            >
              {children}
            </a>
          ),
          img: ({ alt }: ComponentProps<'img'>) => <span className="markdown-image">{alt}</span>,
          pre: ({ children }: ComponentProps<'pre'>) => <>{children}</>,
          code: ({ className, children }: ComponentProps<'code'>) => {
            const language = languageOf(className)
            const code = textOf(children)
            // Inline code has no language class and no newline.
            if (language === undefined && !code.includes('\n')) {
              return <code className="markdown-inline">{children}</code>
            }
            return (
              <CodeBlock
                code={code.replace(/\n$/, '')}
                language={language}
                onCopy={onCopy}
                onInsert={onInsert}
              />
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

/** Memoised: the streaming head re-renders only when its text changes. */
export const MarkdownView = memo(MarkdownViewInner)
