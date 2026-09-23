// Assistant text as GitHub-flavoured markdown. Raw HTML is skipped (never
// rendered), images are reduced to their alt text (the CSP allows no remote
// images), links go through the host, and fenced code becomes CodeBlock. A
// relative link opens the workspace file it names, at the lines it names
// (M25); every block takes its direction from its own first strong
// character, so a right-to-left paragraph reads right to left beside a
// left-to-right one.

import { type ComponentProps, memo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LineRange } from '../../shared/protocol'
import { linkHref, linkTarget } from '../links'
import { CodeBlock } from './CodeBlock'

export interface MarkdownViewProps {
  readonly text: string
  readonly onOpenLink: (url: string) => void
  /** A relative link: the workspace file (M25); without it the host refuses the link. */
  readonly onOpenFile?: ((path: string, range: LineRange | undefined) => void) | undefined
  /** A link to a file outside the workspace (M25). */
  readonly onRefuseLink?: (() => void) | undefined
  readonly onCopy: (text: string) => void
  readonly onInsert: (text: string) => void
  readonly onApply: (text: string) => void
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

function MarkdownViewInner({
  text,
  onOpenLink,
  onOpenFile,
  onRefuseLink,
  onCopy,
  onInsert,
  onApply,
}: MarkdownViewProps) {
  const follow = (href: string) => {
    const target = linkTarget(href)
    switch (target.kind) {
      case 'external': {
        onOpenLink(target.url)
        break
      }
      case 'file': {
        if (onOpenFile === undefined) {
          onOpenLink(href)
        } else {
          onOpenFile(target.path, target.range)
        }
        break
      }
      case 'refused': {
        onRefuseLink?.()
        break
      }
      case 'anchor': {
        break
      }
    }
  }
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={PLUGINS}
        skipHtml
        urlTransform={linkHref}
        components={{
          a: ({ href, children }: ComponentProps<'a'>) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (href !== undefined) {
                  follow(href)
                }
              }}
            >
              {children}
            </a>
          ),
          p: ({ children }: ComponentProps<'p'>) => <p dir="auto">{children}</p>,
          li: ({ children }: ComponentProps<'li'>) => <li dir="auto">{children}</li>,
          blockquote: ({ children }: ComponentProps<'blockquote'>) => (
            <blockquote dir="auto">{children}</blockquote>
          ),
          h1: ({ children }: ComponentProps<'h1'>) => <h1 dir="auto">{children}</h1>,
          h2: ({ children }: ComponentProps<'h2'>) => <h2 dir="auto">{children}</h2>,
          h3: ({ children }: ComponentProps<'h3'>) => <h3 dir="auto">{children}</h3>,
          td: ({ children }: ComponentProps<'td'>) => <td dir="auto">{children}</td>,
          th: ({ children }: ComponentProps<'th'>) => <th dir="auto">{children}</th>,
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
                onApply={onApply}
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
