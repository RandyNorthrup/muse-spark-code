import type { TeamPaidPort } from './teamHostService'
import type { TeamToolContext } from './teamSeams'
import type { UsdAmount } from '../../shared/usd'
// Paid team pricing and grant scopes load with the team runtime (M96, D6).
import {
  MODEL_API_PRICES_PER_MILLION,
  MODEL_API_PRICE_DECIMALS,
  TEAM_MODEL_TEXT,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import {
  modelApiPaidTier,
  type TeamWorkerConfirmation,
  type PaidUseRequest,
} from '../../shared/paid'
import type { PaidUseConsentDeps } from '../paid/paidConsent'

type TeamUseRequest = Extract<PaidUseRequest, { readonly feature: 'teamWorkers' }>

export function teamWorkerQuestion(request: TeamUseRequest): {
  readonly title: string
  readonly detail: string
} {
  return {
    title: UI_TEXT.paidTeamWorkersTitle,
    detail: fill(UI_TEXT.paidTeamWorkersDetail, {
      tasks: teamWorkerPrice(request.tasks, request.dailyBudgetUsd, request.dailyBudgetTokens),
    }),
  }
}

/** Team Always belongs to exact tariffs; ordinary feature grants never apply. */
export async function canUseTeam(
  deps: PaidUseConsentDeps,
  request: TeamUseRequest,
  requiresAsking: boolean,
  notify: () => void,
): Promise<boolean> {
  // The lazy import yielded: check again before displaying or using a grant.
  if (!deps.isOn('teamWorkers')) return false
  const scopes = teamWorkerScopes(request.tasks)
  const canRemember =
    deps.canRemember() && deps.writeTeamGrants !== undefined && deps.readTeamGrants !== undefined
  if (
    !requiresAsking &&
    canRemember &&
    scopes.length > 0 &&
    scopes.every((scope) => deps.readTeamGrants?.().has(scope) === true)
  ) {
    deps.log.info('Paid use of teamWorkers: allowed always in this workspace')
    return true
  }
  const answer = await deps.ask(request, canRemember)
  if (answer === 'deny') {
    deps.log.info('Paid use of teamWorkers: denied')
    return false
  }
  if (!deps.isOn('teamWorkers')) {
    deps.log.info('Paid use of teamWorkers: turned off while the popup was open')
    return false
  }
  if (answer === 'always' && canRemember && deps.canRemember()) {
    try {
      await deps.writeTeamGrants(new Set([...deps.readTeamGrants(), ...scopes]))
      deps.log.info('Paid use of teamWorkers: allowed always in this workspace')
      notify()
      return true
    } catch {
      // Persistence failed; this approved use stays once and asks again next time.
      deps.log.warn('Paid team use: scoped Always could not be kept; allowed once')
    }
  }
  deps.log.info('Paid use of teamWorkers: allowed once')
  return true
}

/** What a `delegate` call's popup quotes for its key tasks (M96, acceptance 23). */
export function teamWorkerPrice(
  tasks: readonly TeamWorkerConfirmation[],
  dailyBudgetUsd: UsdAmount | undefined,
  dailyBudgetTokens?: number,
): string {
  const lines = tasks.map((task) => {
    const tier = teamWorkerPaidTier(task)
    const scope = [
      task.provider ?? 'meta',
      task.priceTier ?? (task.rates === undefined ? tier : JSON.stringify(task.rates)),
    ]
      .filter((part) => part !== undefined)
      .join(', ')
    const tariff =
      task.rates ?? (tier === undefined ? undefined : MODEL_API_PRICES_PER_MILLION[tier])
    const rates =
      tariff === undefined
        ? fill(UI_TEXT.paidTeamWorkerUnpriced, { tokens: formatNumber(task.taskCeilingTokens) })
        : fill(UI_TEXT.paidTeamWorkerRates, {
            model: task.modelId,
            input: formatUsd(tariff.input, MODEL_API_PRICE_DECIMALS),
            cached: formatUsd(tariff.cachedInput ?? tariff.input, MODEL_API_PRICE_DECIMALS),
            output: formatUsd(tariff.output, MODEL_API_PRICE_DECIMALS),
            tokens: formatNumber(task.taskCeilingTokens),
          })
    return fill(UI_TEXT.paidTeamWorkerLine, {
      role: task.role,
      model: `${task.modelId} (${scope})`,
      rates,
    })
  })
  if (dailyBudgetUsd !== undefined) {
    lines.push(fill(UI_TEXT.paidTeamWorkerBudget, { budget: formatUsd(dailyBudgetUsd, 2) }))
  }
  if (dailyBudgetTokens !== undefined) {
    lines.push(fill(UI_TEXT.paidTeamWorkerTokenBudget, { tokens: formatNumber(dailyBudgetTokens) }))
  }
  return lines.join('\n')
}

/** Meta's published rates apply only to its verified model and tariff together. */
export function teamWorkerPaidTier(
  task: TeamWorkerConfirmation,
): keyof typeof MODEL_API_PRICES_PER_MILLION | undefined {
  const tier = modelApiPaidTier(task.modelId)
  return (task.provider === undefined || task.provider === 'meta') &&
    (task.priceTier === undefined || task.priceTier === tier)
    ? tier
    : undefined
}

/** Grant identity includes the provider, model and verified tariff. */
export function teamWorkerScopes(tasks: readonly TeamWorkerConfirmation[]): readonly string[] {
  return tasks.map((task) => {
    const tier = teamWorkerPaidTier(task)
    return JSON.stringify([
      task.provider ?? 'meta',
      task.modelId,
      task.priceTier ??
        (task.rates === undefined ? tier : JSON.stringify(task.rates)) ??
        'unpriced',
      tier === undefined ? null : MODEL_API_PRICES_PER_MILLION[tier],
    ])
  })
}

/** Both dispatch paths use the same pre-consent cancellation boundary. */
export async function hasTeamTaskConsent(
  paid: TeamPaidPort,
  confirmations: readonly TeamWorkerConfirmation[],
  context: TeamToolContext,
): Promise<boolean> {
  context.signal.throwIfAborted()
  return confirmations.length === 0 || (await paid.allowKeyTasks(confirmations, undefined, context))
}

/**
Both dispatch paths refuse key-paid work the same way: no consent, no
dispatch, and a close, abort or trust lapse while confirming stops too.
Returns the refusal text, or undefined when the quoted spend may start.
*/
export async function refuseKeySpend(
  paid: TeamPaidPort,
  confirmations: readonly TeamWorkerConfirmation[],
  context: TeamToolContext,
  isStopped: () => boolean,
): Promise<string | undefined> {
  if (!(await hasTeamTaskConsent(paid, confirmations, context)))
    return TEAM_MODEL_TEXT.hostPaidDeclined
  return isStopped() ? TEAM_MODEL_TEXT.hostStopped : undefined
}
