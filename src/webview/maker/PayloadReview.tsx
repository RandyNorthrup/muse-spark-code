import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  MAKER_REVIEW_DEFAULT_CHAR_WIDTH,
  MAKER_REVIEW_DEFAULT_WIDTH,
  MAKER_REVIEW_OVERSCAN_ROWS,
  MAKER_REVIEW_ROW_HEIGHT,
  MAKER_REVIEW_SMALL_ROWS,
  MAKER_REVIEW_YIELD_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type { ApprovalRequest, MakerMachineSummary } from '../../shared/makerProtocol'
import {
  canonicalPayload,
  outgoingPayloadBytes,
  type CanonicalPayload,
} from '../../core/maker/canonicalPayload'
import { summarizePayload, type PayloadSummary } from '../../core/maker/payloadSummary'
import { PayloadSummaryView } from './PayloadSummaryView'

/** First row/highlight at or after a logical line. */
function lowerBound(values: readonly { readonly line: number }[], line: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if ((values[mid]?.line ?? 0) < line) low = mid + 1
    else high = mid
  }
  return low
}

export function PayloadReview({
  content,
  onRendered,
  onReviewed,
  encoding = 'text',
  request,
  limits,
}: {
  readonly content: string
  readonly onRendered?: (digest: string) => void
  readonly onReviewed?: (isComplete: boolean) => void
  readonly encoding?: 'text' | 'hex' | undefined
  readonly request?: ApprovalRequest | undefined
  readonly limits?: MakerMachineSummary['limits'] | undefined
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onRendered, onReviewed })
  useLayoutEffect(() => {
    callbacks.current = { onRendered, onReviewed }
  })
  const [result, setPrepared] = useState<{
    content: string
    encoding: string
    width: number
    request: ApprovalRequest | undefined
    limits: MakerMachineSummary['limits'] | undefined
    payload: CanonicalPayload
    summary: PayloadSummary
  }>()
  const [failed, setFailed] = useState(false)
  const [width, setWidth] = useState(MAKER_REVIEW_DEFAULT_WIDTH)
  const [start, setStart] = useState(0)
  const [visibleRows, setVisibleRows] = useState(MAKER_REVIEW_OVERSCAN_ROWS)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState(-1)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const searchGeneration = useRef(0)
  const prepared =
    result?.content === content &&
    result.encoding === encoding &&
    result.width === width &&
    result.request === request &&
    result.limits === limits
      ? result
      : undefined
  const isLarge = (prepared?.payload.rows.length ?? 0) > MAKER_REVIEW_SMALL_ROWS
  const isComplete =
    prepared !== undefined &&
    (isLarge ? confirmed : reachedEnd) &&
    (prepared.summary.highlights.length === 0 || acknowledged)
  useLayoutEffect(() => {
    callbacks.current.onReviewed?.(isComplete)
  }, [isComplete])
  useLayoutEffect(() => {
    const node = viewport.current
    if (node === null) return
    const measure = () => {
      if (node.clientWidth > 0) setWidth(node.clientWidth)
      setVisibleRows(
        Math.ceil(node.clientHeight / MAKER_REVIEW_ROW_HEIGHT) + MAKER_REVIEW_OVERSCAN_ROWS,
      )
    }
    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(node)
    return () => {
      resize.disconnect()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    searchGeneration.current += 1
    if (viewport.current !== null) viewport.current.scrollTop = 0
    const context = document.createElement('canvas').getContext('2d')
    if (context !== null && viewport.current !== null)
      context.font = getComputedStyle(viewport.current).font
    const sizes = new Map<string, number>()
    const measure = (character: string) => {
      let size = sizes.get(character)
      if (size === undefined) {
        const measured = context?.measureText(character).width
        size = measured === undefined || measured === 0 ? MAKER_REVIEW_DEFAULT_CHAR_WIDTH : measured
        sizes.set(character, size)
      }
      return size
    }
    void (async () => {
      const bytes = outgoingPayloadBytes(content, encoding)
      const payload = await canonicalPayload(bytes, width, measure, controller.signal)
      const summary = await summarizePayload(bytes, request, limits, controller.signal)
      controller.signal.throwIfAborted()
      setFailed(false)
      setReachedEnd(false)
      setConfirmed(false)
      setAcknowledged(false)
      setStart(0)
      setMatch(-1)
      setHighlightIndex(0)
      setPrepared({ content, encoding, width, request, limits, payload, summary })
      callbacks.current.onRendered?.(payload.digest)
    })().catch(() => {
      if (!controller.signal.aborted) setFailed(true)
    })
    return () => {
      controller.abort()
    }
  }, [content, encoding, width, request, limits])
  useEffect(() => {
    if (prepared === undefined || isLarge) return
    const node = viewport.current
    if (node === null) return
    const endpoint = node.querySelector('.maker-payload-end')
    if (endpoint === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.intersectionRatio === 1) &&
          node.clientHeight > 0 &&
          node.scrollTop + node.clientHeight >= node.scrollHeight - 1
        )
          setReachedEnd(true)
      },
      { threshold: 1 },
    )
    observer.observe(endpoint)
    return () => {
      observer.disconnect()
    }
  }, [prepared, isLarge])
  const jump = (row: number) => {
    const node = viewport.current
    if (node === null) return
    node.scrollTop = row * MAKER_REVIEW_ROW_HEIGHT
    setStart(row)
    node.focus()
  }
  const search = async () => {
    if (prepared === undefined || query === '') return
    const current = ++searchGeneration.current
    const rows = prepared.payload.rows
    let carry = ''
    let carryRow = 0
    for (const [index, row] of rows.entries()) {
      if (current !== searchGeneration.current) return
      const value = carry + row.text
      const found = value.indexOf(query)
      if (found !== -1 && index > match) {
        setMatch(index)
        jump(found < carry.length ? carryRow : index)
        return
      }
      carry = query.length > 1 ? value.slice(-(query.length - 1)) : ''
      carryRow = index
      if (index % MAKER_REVIEW_YIELD_BYTES === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    setMatch(-1)
  }
  const rows = prepared?.payload.rows ?? []
  const summary = prepared?.summary
  return (
    <>
      {failed && <p role="alert">{UI_TEXT.makerLoadFailed}</p>}
      {prepared === undefined && !failed && <p role="status">{UI_TEXT.loadingOutput}</p>}
      {prepared !== undefined && (
        <PayloadSummaryView
          payload={prepared.payload}
          summary={prepared.summary}
          request={request}
          limits={limits}
        />
      )}
      <p>{UI_TEXT.makerCanonicalLegend}</p>
      <label>
        {UI_TEXT.makerPayloadSearch}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setMatch(-1)
            searchGeneration.current += 1
          }}
        />
      </label>
      <button
        type="button"
        disabled={prepared === undefined || query === ''}
        onClick={() => {
          void search()
        }}
      >
        {UI_TEXT.makerFindNext}
      </button>
      {summary !== undefined && summary.highlights.length > 0 && (
        <>
          <p role="status">
            {fill(UI_TEXT.makerHighlightPosition, {
              current: formatNumber(highlightIndex + 1),
              count: formatNumber(summary.highlights.length),
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              const next = (highlightIndex + 1) % summary.highlights.length
              setHighlightIndex(next)
              jump(lowerBound(rows, summary.highlights[next]?.line ?? 1))
            }}
          >
            {UI_TEXT.makerNextHighlight}
          </button>
          <p>
            {fill(UI_TEXT.makerHighlightLine, {
              line: formatNumber(summary.highlights[highlightIndex]?.line ?? 1),
            })}
            : {summary.highlights[highlightIndex]?.detail}
          </p>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked)
              }}
            />
            {UI_TEXT.makerAcknowledgeDangers}
          </label>
        </>
      )}
      <div
        ref={viewport}
        className="maker-payload"
        role="region"
        aria-label={UI_TEXT.makerReadPayload}
        tabIndex={0}
        onScroll={(event) => {
          setStart(Math.floor(event.currentTarget.scrollTop / MAKER_REVIEW_ROW_HEIGHT))
        }}
      >
        <div
          className="maker-payload-rows"
          style={{ height: rows.length * MAKER_REVIEW_ROW_HEIGHT }}
        >
          {rows
            .slice(Math.max(0, start - MAKER_REVIEW_OVERSCAN_ROWS), start + visibleRows)
            .map((row, index) => {
              const at = Math.max(0, start - MAKER_REVIEW_OVERSCAN_ROWS) + index
              const danger = summary?.highlights[lowerBound(summary.highlights, row.line)]
              return (
                <span
                  key={at}
                  data-highlight={danger?.line === row.line || undefined}
                  style={{ top: at * MAKER_REVIEW_ROW_HEIGHT, height: MAKER_REVIEW_ROW_HEIGHT }}
                >
                  {row.text}
                </span>
              )
            })}
          <span
            className="maker-payload-end"
            aria-hidden="true"
            style={{ top: Math.max(0, rows.length * MAKER_REVIEW_ROW_HEIGHT - 1), height: 1 }}
          />
        </div>
      </div>
      {prepared !== undefined &&
        (isLarge ? (
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.currentTarget.checked)
              }}
            />
            {UI_TEXT.makerConfirmSummaryDigest}
          </label>
        ) : (
          <p role="status">
            {reachedEnd ? UI_TEXT.makerPayloadEndReached : UI_TEXT.makerScrollPayloadEnd}
          </p>
        ))}
    </>
  )
}
