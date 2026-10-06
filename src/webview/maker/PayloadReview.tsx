import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  MAKER_DIGEST_RADIX,
  MAKER_REVIEW_PAGE_LINES,
  MAKER_REVIEW_SEGMENT_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { plural, formatNumber, uiLocale } from '../../shared/l10n/text'

/** Only full segment visibility counts; navigation never confers review authority. */
export function PayloadReview({
  content,
  onRendered,
  onReviewed,
  encoding = 'text',
}: {
  readonly content: string
  readonly onRendered?: (digest: string) => void
  readonly onReviewed?: (isComplete: boolean) => void
  readonly encoding?: 'text' | 'hex' | undefined
}) {
  const payload = useRef<HTMLPreElement>(null)
  const callbacks = useRef({ onRendered, onReviewed })
  const refresh = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    callbacks.current = { onRendered, onReviewed }
    refresh.current?.()
  })
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const segmenter = new Intl.Segmenter(uiLocale(), { granularity: 'grapheme' })
  const lines = content.split('\n').flatMap((line, lineIndex, logicalLines) => {
    const segments: string[] = []
    let text = ''
    const characters = segmenter.segment(line + (lineIndex < logicalLines.length - 1 ? '\n' : ''))
    for (const { segment } of characters) {
      if (segment.length > MAKER_REVIEW_SEGMENT_CHARS) throw new Error('makerPayloadSegment')
      if (text.length + segment.length > MAKER_REVIEW_SEGMENT_CHARS) {
        segments.push(text)
        text = ''
      }
      text += segment
    }
    segments.push(text)
    return segments.map((value, index) => ({
      text: value,
      isContinuation: index < segments.length - 1,
    }))
  })
  const seen = useRef(new Set<Element>())
  const progress = useCallback(() => {
    setCount(seen.current.size)
    callbacks.current.onReviewed?.(seen.current.size === lines.length)
  }, [lines.length])
  useLayoutEffect(() => {
    const node = payload.current
    if (node === null) return
    seen.current.clear()
    progress()
    setPage(0)
    let generation = 0
    const receipt = () => {
      if (callbacks.current.onRendered === undefined) return
      const current = ++generation
      const text = node.textContent
      const bytes =
        encoding === 'hex' && /^(?:[a-f0-9]{2})*$/.test(text)
          ? Uint8Array.from(text.match(/../g) ?? [], (hex) =>
              Number.parseInt(hex, MAKER_DIGEST_RADIX),
            )
          : new TextEncoder().encode(text)
      void crypto.subtle
        .digest('SHA-256', bytes)
        .then((result) => {
          if (current !== generation || document.visibilityState === 'hidden') return
          const digest = [...new Uint8Array(result)]
            .map((byte) => byte.toString(MAKER_DIGEST_RADIX).padStart(2, '0'))
            .join('')
          callbacks.current.onRendered?.(digest)
        })
        .catch(() => {
          callbacks.current.onReviewed?.(false)
        })
    }
    const changed = (records: MutationRecord[]) => {
      if (records.some((record) => node.contains(record.target))) {
        seen.current.clear()
        progress()
      }
      receipt()
    }
    refresh.current = receipt
    const mutation = new MutationObserver(changed)
    mutation.observe(node, { childList: true, characterData: true, subtree: true })
    mutation.observe(document.documentElement, { attributes: true })
    mutation.observe(document.body, { attributes: true })
    document.addEventListener('visibilitychange', receipt)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio !== 1 || document.visibilityState === 'hidden') continue
          const { x, y, width, height } = entry.boundingClientRect
          const inset = Math.min(1, width / 2, height / 2)
          if (
            [x + inset, x + width - inset].some((left) =>
              [y + inset, y + height - inset].some(
                (top) => !entry.target.contains(document.elementFromPoint(left, top)),
              ),
            )
          )
            continue
          seen.current.add(entry.target)
        }
        progress()
      },
      { root: node, threshold: 1 },
    )
    for (const line of node.children) observer.observe(line)
    const resize = new ResizeObserver(() => {
      seen.current.clear()
      progress()
      observer.disconnect()
      for (const line of node.children) observer.observe(line)
    })
    resize.observe(node)
    // The complete read-only document is mounted; scrolling/paging never changes its bytes.
    const paint = requestAnimationFrame(receipt)
    return () => {
      generation += 1
      refresh.current = undefined
      cancelAnimationFrame(paint)
      observer.disconnect()
      resize.disconnect()
      mutation.disconnect()
      document.removeEventListener('visibilitychange', receipt)
    }
  }, [content, encoding, lines.length, progress])
  return (
    <>
      <p role="status">
        {plural(UI_TEXT.makerReviewProgress, lines.length, {
          reviewed: formatNumber(count),
        })}
      </p>
      <pre
        ref={payload}
        className="maker-payload"
        role="region"
        aria-label={UI_TEXT.makerReadPayload}
        tabIndex={0}
      >
        {lines.map((line, index) => (
          <span key={index} tabIndex={0} data-continuation={line.isContinuation || undefined}>
            {line.text}
          </span>
        ))}
      </pre>
      {lines.length > MAKER_REVIEW_PAGE_LINES && (
        <button
          type="button"
          disabled={(page + 1) * MAKER_REVIEW_PAGE_LINES >= lines.length}
          onClick={() => {
            const next = page + 1
            setPage(next)
            const line =
              payload.current?.querySelectorAll<HTMLElement>('span')[next * MAKER_REVIEW_PAGE_LINES]
            line?.focus()
            line?.scrollIntoView({ block: 'start' })
          }}
        >
          {UI_TEXT.makerNextPage}
        </button>
      )}
    </>
  )
}
