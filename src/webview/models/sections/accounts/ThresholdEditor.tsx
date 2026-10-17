import { type SubmitEvent, useId, useState } from 'react'
import { accountThresholdsSchema, type AccountThresholds } from '../../../../shared/accounts'
import { UI_TEXT } from '../../../../shared/constants'
import { usdInputSchema, type UsdAmount } from '../../../../shared/usdSchema'
import type { ModelsAccountsSlice } from '../../../../shared/accountsPanel'
import { formatPercent } from '../../../../shared/l10n/text'

const metrics = ['spendUsd', 'inputTokens', 'outputTokens', 'requests'] as const
const periods = ['day', 'week', 'month'] as const

export function ThresholdEditor({
  value,
  capabilities,
  isPending,
  onSave,
}: {
  readonly value: AccountThresholds
  readonly capabilities: Pick<ModelsAccountsSlice, 'planWindows' | 'hasRateHeadroom'>
  readonly isPending: boolean
  readonly onSave: (thresholds: AccountThresholds) => void
}) {
  const id = useId()
  const [error, setError] = useState(false)
  const names = {
    spendUsd: UI_TEXT.accounts.spend,
    inputTokens: UI_TEXT.accounts.inputTokens,
    outputTokens: UI_TEXT.accounts.outputTokens,
    requests: UI_TEXT.accounts.requests,
    day: UI_TEXT.usageDay,
    week: UI_TEXT.usageWeek,
    month: UI_TEXT.accounts.month,
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    // Invalid input never reaches the save: it reads failed below, while a
    // save that throws reads failed and reaches the host's record.
    let isInvalid = false
    const field = (name: string) => {
      const value = data.get(name)
      if (value === null) return ''
      if (typeof value !== 'string') {
        isInvalid = true
        return ''
      }
      return value.trim()
    }
    // Preserve thresholds for unavailable live capabilities; never invent windows.
    const next: AccountThresholds = structuredClone(value)
    for (const metric of metrics) {
      if (metric === 'spendUsd') {
        const amounts: Partial<Record<(typeof periods)[number], UsdAmount>> = {}
        for (const period of periods) {
          const raw = field(`${metric}.${period}`)
          if (raw === '') continue
          // Exact decimal input: a stored sub-nano cap saves unchanged, and
          // no binary number round trip can reject or reshape it.
          const amount = usdInputSchema.safeParse(raw)
          if (!amount.success) {
            isInvalid = true
            continue
          }
          amounts[period] = amount.data
        }
        next.spendUsd = Object.keys(amounts).length === 0 ? undefined : amounts
        continue
      }
      const amounts: Partial<Record<(typeof periods)[number], number>> = {}
      for (const period of periods) {
        const raw = field(`${metric}.${period}`)
        if (raw === '') continue
        if (!/^\d+$/.test(raw)) {
          isInvalid = true
          continue
        }
        amounts[period] = Number(raw)
      }
      next[metric] = Object.keys(amounts).length === 0 ? undefined : amounts
    }
    if (capabilities.planWindows.length > 0) {
      const windows = Object.fromEntries(
        Object.entries(next.planWindowPercent ?? {}).filter(
          ([window]) => !capabilities.planWindows.includes(window),
        ),
      )
      for (const window of capabilities.planWindows) {
        const raw = field(`window.${window}`)
        if (raw !== '') windows[window] = Number(raw)
      }
      next.planWindowPercent = windows
    }
    if (capabilities.hasRateHeadroom) {
      const headroom: NonNullable<AccountThresholds['rateLimitHeadroomPercent']> = {}
      for (const metric of ['requests', 'tokens'] as const) {
        const raw = field(`headroom.${metric}`)
        if (raw !== '') headroom[metric] = Number(raw)
      }
      next.rateLimitHeadroomPercent = headroom
    }
    const parsed = accountThresholdsSchema.safeParse(next)
    if (isInvalid || !parsed.success) {
      setError(true)
      return
    }
    setError(false)
    try {
      onSave(parsed.data)
    } catch (error: unknown) {
      // A save that throws reads failed: only a non-error keeps its kind
      // past the editor. The failure reaches the host's record.
      if (!(error instanceof Error)) throw error
      setError(true)
      throw error
    }
  }
  return (
    <form className="account-thresholds" onSubmit={submit}>
      <fieldset disabled={isPending}>
        <legend>{UI_TEXT.accounts.thresholds}</legend>
        {metrics.map((metric) => (
          <fieldset key={metric}>
            <legend>{names[metric]}</legend>
            <div className="account-periods">
              {periods.map((period) => (
                <label key={period} htmlFor={`${id}-${metric}-${period}`}>
                  {names[period]}
                  <input
                    id={`${id}-${metric}-${period}`}
                    name={`${metric}.${period}`}
                    type="number"
                    min="0"
                    step={metric === 'spendUsd' ? 'any' : '1'}
                    defaultValue={value[metric]?.[period] ?? ''}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {capabilities.planWindows.map((window) => (
          <label key={window}>
            {UI_TEXT.accounts.planWindow} ({window}) · {formatPercent(0)}–{formatPercent(100)}
            <input
              name={`window.${window}`}
              type="number"
              min="0"
              max="100"
              step="any"
              defaultValue={value.planWindowPercent?.[window] ?? ''}
            />
          </label>
        ))}
        {capabilities.hasRateHeadroom ? (
          <fieldset>
            <legend>
              {UI_TEXT.accounts.rateHeadroom} ({formatPercent(0)}–{formatPercent(100)})
            </legend>
            {(['requests', 'tokens'] as const).map((metric) => (
              <label key={metric}>
                {metric === 'requests' ? UI_TEXT.accounts.requests : UI_TEXT.goalTokens}
                <input
                  name={`headroom.${metric}`}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  defaultValue={value.rateLimitHeadroomPercent?.[metric] ?? ''}
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <button type="submit">{UI_TEXT.goalEditSave}</button>
      </fieldset>
      {error ? <p role="alert">{UI_TEXT.accounts.invalidAccount}</p> : null}
    </form>
  )
}
