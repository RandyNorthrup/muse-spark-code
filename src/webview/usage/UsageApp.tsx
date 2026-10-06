import { useCallback, useEffect, useRef, useState } from 'react'
import { USAGE_DETAIL_DAYS } from '../../shared/constants'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { fill, plural } from '../../shared/l10n/text'
import {
  parseUsageServiceToPageMessage,
  type UsagePageState,
  type UsagePageToServiceMessage,
  type UsageQuery,
} from '../../shared/usagePage'
import type { HostBridge } from '../hostBridge'
import { Header } from './Header'
import { KpiTiles } from './KpiTiles'
import { LimitsSection } from './LimitsSection'
import { BreakdownTable } from './BreakdownTable'
import { FeaturesTable } from './FeaturesTable'
import { ModelDetail } from './ModelDetail'
import { AttemptsSection } from './AttemptsSection'
import { SavingsSection } from './SavingsSection'
import { EmptyStates } from './EmptyStates'
import { StackedColumns } from './charts/StackedColumns'
import { MirroredColumns } from './charts/MirroredColumns'
import { ShareBar } from './charts/ShareBar'
import { dayLabel } from './display'
import { installUsageTable } from './installUsageTable'

export function UsageApp({
  host,
  now = Date.now,
}: {
  readonly host: HostBridge
  readonly now?: () => number
}) {
  const [state, setState] = useState<UsagePageState>()
  const [query, setQuery] = useState<UsageQuery>({
    range: 'today',
    groupBy: 'provider',
    metric: 'cost',
  })
  const wanted = useRef<UsageQuery | undefined>(undefined)
  const pending = useRef(new Map<string, 'export' | 'deleteHistory'>())
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [detailOpen, setDetailOpen] = useState(true)
  const [, setLanguageTick] = useState(0)
  const post = useCallback(
    (message: UsagePageToServiceMessage) => {
      setError(undefined)
      setNotice(undefined)
      switch (message.type) {
        case 'usage/query':
        case 'usage/refresh': {
          setBusy(true)
          break
        }
        case 'usage/export':
        case 'usage/deleteHistory': {
          pending.current.set(
            message.requestId,
            message.type === 'usage/export' ? 'export' : 'deleteHistory',
          )
          break
        }
        case 'usage/modelDetail': {
          setDetailOpen(true)
          break
        }
      }
      try {
        host.post(message)
      } catch {
        if ('requestId' in message) pending.current.delete(message.requestId)
        if (message.type === 'usage/query') wanted.current = undefined
        setBusy(false)
        setError(USAGE_TEXT.readFailed)
      }
    },
    [host],
  )
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const parsed = parseUsageServiceToPageMessage(event.data)
      if (!parsed.ok) {
        setError(USAGE_TEXT.invalidMessage)
        setBusy(false)
        return
      }
      const message = parsed.message
      switch (message.type) {
        case 'usage/state': {
          if (
            wanted.current !== undefined &&
            JSON.stringify(message.state.query) !== JSON.stringify(wanted.current)
          )
            return
          setState(message.state)
          setQuery(message.state.query)
          setBusy(false)
          setError(undefined)
          break
        }
        case 'usage/table': {
          if (installUsageTable(message) !== undefined) {
            setError(USAGE_TEXT.invalidMessage)
            return
          }
          setLanguageTick((tick) => tick + 1)
          break
        }
        case 'usage/result': {
          if (pending.current.get(message.requestId) !== message.action) return
          pending.current.delete(message.requestId)
          if (message.outcome === 'completed')
            setNotice(
              message.action === 'export' ? USAGE_TEXT.exportComplete : USAGE_TEXT.deleteComplete,
            )
          break
        }
        case 'usage/error': {
          if (message.requestId !== undefined) pending.current.delete(message.requestId)
          setError(
            message.code === 'exportRange'
              ? plural(USAGE_TEXT.exportRangeError, USAGE_DETAIL_DAYS)
              : USAGE_TEXT[message.code],
          )
          setBusy(false)
          break
        }
      }
    }
    host.messages.addEventListener('message', receive)
    host.post({ type: 'usage/ready' })
    return () => {
      host.messages.removeEventListener('message', receive)
    }
  }, [host])
  return (
    <main className="usage-page" aria-busy={busy}>
      <Header
        capabilities={state?.capabilities}
        query={query}
        busy={busy}
        post={post}
        onQuery={(next) => {
          wanted.current = next
          setQuery(next)
          post({ type: 'usage/query', query: next })
        }}
      />
      {error === undefined ? null : (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              post({ type: 'usage/refresh' })
            }}
          >
            {USAGE_TEXT.retry}
          </button>
        </div>
      )}
      {notice === undefined ? null : <p role="status">{notice}</p>}
      {busy ? (
        <p role="status">{state === undefined ? USAGE_TEXT.loading : USAGE_TEXT.refreshing}</p>
      ) : null}
      {state === undefined ? null : (
        <>
          <p>{fill(USAGE_TEXT.journalHost, { host: state.history.host })}</p>
          {state.capabilities !== undefined &&
          (!state.capabilities.settings ||
            !state.capabilities.folder ||
            !state.capabilities.models) ? (
            <p>{USAGE_TEXT.editorActionsUnavailable}</p>
          ) : null}
          {state.history.since === undefined ? null : (
            <p>{fill(USAGE_TEXT.historySince, { date: dayLabel(state.history.since) })}</p>
          )}
          <EmptyStates state={state} post={post} />
          <KpiTiles
            totals={state.totals}
            previous={state.previousTotals}
            metric={state.query.metric}
          />
          {state.buckets.length === 0 ? null : (
            <>
              {state.query.metric === 'tokens' ? (
                <MirroredColumns state={state} />
              ) : (
                <StackedColumns state={state} />
              )}
              <ShareBar state={state} />
            </>
          )}
          <BreakdownTable rows={state.breakdown} post={post} />
          {detailOpen ? (
            <ModelDetail
              state={state}
              post={post}
              onClose={() => {
                setDetailOpen(false)
              }}
            />
          ) : null}
          <LimitsSection state={state} post={post} now={now} />
          <FeaturesTable features={state.features} />
          <AttemptsSection attempts={state.attempts} />
          <SavingsSection savings={state.savings} />
          <footer>
            <p>
              {fill(USAGE_TEXT.retentionNote, {
                detailDays: state.history.detailDays,
                historyDays: state.history.historyDays,
              })}
            </p>
            <p>{USAGE_TEXT.privacyNote}</p>
          </footer>
        </>
      )}
    </main>
  )
}
