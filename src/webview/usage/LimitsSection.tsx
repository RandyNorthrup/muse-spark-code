import { useEffect, useState } from 'react'
import {
  HOURS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  USAGE_BURN_MIN_MS,
  USAGE_COUNTDOWN_REFRESH_MS,
  USAGE_PACE_BAND_POINTS,
  USAGE_STALE_MS,
  USAGE_WARNING_PERCENTS,
} from '../../shared/constants'
import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import { fill, formatDateTime, formatPercent, formatUnit, plural } from '../../shared/l10n/text'
import { formatDuration } from '../../shared/usage'
import type { UsageLimitSnapshot } from '../../shared/usageJournal'
import type { UsagePageState } from '../../shared/usagePage'
import { money, type PostUsage } from './display'
import { StepLines } from './charts/StepLines'
import { BurnLine } from './charts/BurnLine'

function Warning({ percent }: { readonly percent: number }) {
  const threshold = USAGE_WARNING_PERCENTS.findLast((value) => percent >= value)
  if (threshold === undefined) return null
  const text =
    threshold === 100
      ? USAGE_TEXT.warning100
      : fill(
          threshold === USAGE_WARNING_PERCENTS[1] ? USAGE_TEXT.warning90 : USAGE_TEXT.warning75,
          { percent: formatPercent(threshold) },
        )
  return (
    <p className="usage-warning">
      <span aria-hidden="true">⚠</span> {text}
    </p>
  )
}
function Meter({
  percent,
  description,
}: {
  readonly percent: number
  readonly description: string
}) {
  return (
    <progress
      max={100}
      value={Math.min(100, percent)}
      aria-label={description}
      aria-valuetext={description}
    />
  )
}
export function LimitCard({
  snapshot,
  window,
  now,
}: {
  readonly snapshot: UsageLimitSnapshot
  readonly window: UsageLimitSnapshot['windows'][number]
  readonly now: number
}) {
  const isExpired = window.resetsAt !== undefined && now >= window.resetsAt
  const isStale = now - snapshot.observedAt > USAGE_STALE_MS
  const durationMs =
    window.windowMins === undefined
      ? undefined
      : window.windowMins * MINUTES_PER_HOUR * MILLISECONDS_PER_SECOND
  let label: string
  if (window.windowMins === undefined)
    label = window.label ?? (window.id === 'weekly' ? USAGE_TEXT.weeklyBlock : window.id)
  else if (window.windowMins % MINUTES_PER_HOUR === 0)
    label = plural(USAGE_TEXT.windowHours, window.windowMins / MINUTES_PER_HOUR)
  else label = plural(USAGE_TEXT.windowMinutes, window.windowMins)
  const until =
    window.resetsAt === undefined ? USAGE_TEXT.unknown : formatDuration(window.resetsAt, now)
  const used = fill(USAGE_TEXT.usedPercent, { percent: formatPercent(window.usedPercent) })
  const description = fill(USAGE_TEXT.meterDescription, {
    percent: formatPercent(window.usedPercent),
    duration: until,
  })
  let pace: string | undefined
  // A weekly block has no reported consumption curve. Never infer its pace.
  if (
    !isExpired &&
    durationMs !== undefined &&
    durationMs > 0 &&
    window.windowMins !== undefined &&
    window.windowMins < HOURS_PER_DAY * MINUTES_PER_HOUR &&
    window.id !== 'weekly' &&
    window.resetsAt !== undefined
  ) {
    const elapsed = Math.max(
      0,
      Math.min(100, ((now - (window.resetsAt - durationMs)) / durationMs) * 100),
    )
    const difference = window.usedPercent - elapsed
    if (difference > USAGE_PACE_BAND_POINTS) pace = USAGE_TEXT.paceAhead
    else if (difference < -USAGE_PACE_BAND_POINTS) pace = USAGE_TEXT.paceUnder
    else pace = USAGE_TEXT.paceEven
  }
  return (
    <article className="usage-limit-card">
      <h3>
        {snapshot.provider}: {label}
      </h3>
      <p>{fill(USAGE_TEXT.asOf, { date: formatDateTime(snapshot.observedAt) })}</p>
      {isStale ? <p className="usage-warning">{USAGE_TEXT.stale}</p> : null}
      {isExpired ? (
        <p role="status">{USAGE_TEXT.awaitingFresh}</p>
      ) : (
        <>
          <p>{used}</p>
          <Meter percent={window.usedPercent} description={description} />
          <p>{fill(USAGE_TEXT.resetsIn, { duration: until })}</p>
          <Warning percent={window.usedPercent} />
          {pace === undefined ? null : (
            <p>
              {USAGE_TEXT.pace}: {pace}
            </p>
          )}
        </>
      )}
    </article>
  )
}
export function BudgetCard({
  budget,
  now,
}: {
  readonly budget: UsagePageState['budgets'][number]
  readonly now: number
}) {
  const label = {
    paidDaily: USAGE_TEXT.paidDailyBudget,
    tabDaily: USAGE_TEXT.tabDailyBudget,
    vscodeChatDaily: USAGE_TEXT.vscodeChatDailyBudget,
    conversation: USAGE_TEXT.conversationBudget,
    headless: USAGE_TEXT.headlessBudget,
  }[budget.kind]
  const description = fill(USAGE_TEXT.budgetSpent, {
    spent: money(budget.spentUsd),
    cap: money(budget.capUsd),
  })
  let percent: number | undefined
  if (budget.capUsd !== undefined)
    percent = budget.capUsd === 0 ? 100 : (budget.spentUsd / budget.capUsd) * 100
  return (
    <article className="usage-limit-card">
      <h3>{label}</h3>
      <p>{description}</p>
      {percent === undefined ? (
        <p>{USAGE_TEXT.notReported}</p>
      ) : (
        <>
          <Meter percent={percent} description={description} />
          <Warning percent={percent} />
        </>
      )}
      {budget.capUsd === undefined ? null : (
        <p>
          {fill(USAGE_TEXT.budgetRemaining, {
            remaining: money(Math.max(0, budget.capUsd - budget.spentUsd)),
          })}
        </p>
      )}
      {budget.stopped ? <p className="usage-warning">{USAGE_TEXT.budgetStopped}</p> : null}
      {budget.raisedToday === true ? <p>{USAGE_TEXT.budgetRaised}</p> : null}
      {budget.uncertainUsd === undefined ? null : (
        <p>
          {USAGE_TEXT.certaintyUncertain}: {money(budget.uncertainUsd)} · {USAGE_TEXT.uncertainNote}
        </p>
      )}
      {budget.resetsAt === undefined ? null : (
        <p>
          {budget.resetsAt <= now
            ? USAGE_TEXT.awaitingFresh
            : fill(USAGE_TEXT.resetsIn, { duration: formatDuration(budget.resetsAt, now) })}
        </p>
      )}
      {budget.kind === 'paidDaily' ? <p>{USAGE_TEXT.paidBudgetNote}</p> : null}
      {budget.projectedUsd === undefined ? (
        <p>
          {fill(USAGE_TEXT.budgetProjectionNote, {
            duration: formatUnit(
              USAGE_BURN_MIN_MS / MILLISECONDS_PER_SECOND / MINUTES_PER_HOUR,
              'minute',
            ),
          })}
        </p>
      ) : (
        <BurnLine budget={budget} now={now} />
      )}
    </article>
  )
}
export function RateLimitCard({
  snapshot,
  now,
}: {
  readonly snapshot: UsageLimitSnapshot
  readonly now: number
}) {
  return (
    <article className="usage-limit-card">
      <h3>
        {USAGE_TEXT.rateLimits}: {snapshot.provider}
      </h3>
      <p>{USAGE_TEXT.asReported}</p>
      <p>{fill(USAGE_TEXT.asOf, { date: formatDateTime(snapshot.observedAt) })}</p>
      {now - snapshot.observedAt > USAGE_STALE_MS ? <p>{USAGE_TEXT.stale}</p> : null}
      <dl>
        {Object.entries(snapshot.raw ?? {}).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  )
}
export function LimitsSection({
  state,
  post,
  now = Date.now,
}: {
  readonly state: UsagePageState
  readonly post: PostUsage
  readonly now?: () => number
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((tick) => tick + 1)
    }, USAGE_COUNTDOWN_REFRESH_MS)
    return () => {
      clearInterval(timer)
    }
  }, [])
  const nowMs = now()
  const byProvider = new Map(
    state.limits
      .toSorted((a, b) => a.observedAt - b.observedAt)
      .map((snapshot) => [`${snapshot.provider}:${snapshot.source}`, snapshot] as const),
  )
  const latest: UsageLimitSnapshot[] = []
  byProvider.forEach((snapshot) => {
    latest.push(snapshot)
  })
  const chartProviders = [
    ...new Set(
      state.limits
        .filter((snapshot) => snapshot.windows.length > 0)
        .map((snapshot) => snapshot.provider),
    ),
  ]
  return (
    <section aria-labelledby="usage-limits-title">
      <h2 id="usage-limits-title">{USAGE_TEXT.limits}</h2>
      <div className="usage-limit-grid">
        {latest.flatMap((snapshot) =>
          snapshot.windows.map((window) => (
            <LimitCard
              key={`${snapshot.id}:${window.id}`}
              snapshot={snapshot}
              window={window}
              now={nowMs}
            />
          )),
        )}
        {latest
          .filter((snapshot) => snapshot.account !== undefined)
          .map((snapshot) => {
            const account = snapshot.account
            if (account === undefined) return null
            const description = fill(USAGE_TEXT.budgetSpent, {
              spent: money(account.usedUsd),
              cap: money(account.limitUsd),
            })
            return (
              <article key={snapshot.id} className="usage-limit-card">
                <h3>
                  {USAGE_TEXT.accountBudget}: {snapshot.provider}
                </h3>
                <p>{account.period}</p>
                <p>{description}</p>
                {account.usedUsd === undefined || account.limitUsd === undefined ? null : (
                  <>
                    <Meter
                      percent={
                        account.limitUsd === 0 ? 100 : (account.usedUsd / account.limitUsd) * 100
                      }
                      description={description}
                    />
                    <Warning
                      percent={
                        account.limitUsd === 0 ? 100 : (account.usedUsd / account.limitUsd) * 100
                      }
                    />
                  </>
                )}
                <p>
                  {fill(USAGE_TEXT.budgetRemaining, { remaining: money(account.remainingUsd) })}
                </p>
              </article>
            )
          })}
        {state.budgets.map((budget) => (
          <BudgetCard key={budget.id} budget={budget} now={nowMs} />
        ))}
        {latest
          .filter((snapshot) => snapshot.raw !== undefined)
          .map((snapshot) => (
            <RateLimitCard key={snapshot.id} snapshot={snapshot} now={nowMs} />
          ))}
      </div>
      {state.unreportedLimits.map((row) => (
        <p key={row.provider}>
          {fill(USAGE_TEXT.noLimitReported, { provider: row.provider })}{' '}
          {row.consoleUrl !== undefined && state.capabilities?.external === false ? (
            <a href={row.consoleUrl} target="_blank" rel="noopener noreferrer">
              {USAGE_TEXT.providerConsole}
            </a>
          ) : null}
          {row.consoleUrl !== undefined && state.capabilities?.external !== false ? (
            <button
              type="button"
              onClick={() => {
                if (row.consoleUrl !== undefined)
                  post({ type: 'usage/openExternal', url: row.consoleUrl })
              }}
            >
              {USAGE_TEXT.providerConsole}
            </button>
          ) : null}
        </p>
      ))}
      {chartProviders.map((provider) => (
        <StepLines
          key={provider}
          snapshots={state.limits.filter(
            (snapshot) => snapshot.provider === provider && snapshot.windows.length > 0,
          )}
        />
      ))}
    </section>
  )
}
