import { recoverSourceFacts } from './boundary'
// C-M113-3: the reporting `accounts` source from M108's registry. Labels
// name accounts and are resolved locally; no credential, key or vendor
// secret ever enters these facts. Only the accounts kind reads this port:
// every other kind sees it as not applicable, never as empty success.
import * as z from 'zod/mini'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import { legacyUsdSchema } from '../../../shared/usdSchema'
import type { AccountsFacts, SourceReadContext } from './types'
import {
  codeUnitCompare,
  localSource,
  LocalSourceError,
  scrubSourceValue,
  type SourceScrub,
} from './local'

const name = z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS))
const count = z.number().check(z.int(), z.nonnegative())
const period = z.enum(['day', 'week', 'month'])
const rows = <T extends z.ZodMiniType>(entry: T) =>
  z.array(entry).check(z.maxLength(REPORT_MAX_ROWS))

export const accountsThresholdsSchema = z.strictObject({
  spendUsd: rows(
    z.strictObject({
      period,
      value: legacyUsdSchema,
    }),
  ),
  counts: rows(
    z.strictObject({
      metric: z.enum(['inputTokens', 'outputTokens', 'requests']),
      period,
      value: count,
    }),
  ),
  percents: rows(
    z.strictObject({
      name,
      value: z.number().check(z.minimum(0), z.maximum(100)),
    }),
  ),
})

/**
 * One injected usage, event or confirmation row, exported so the runtime
 * reader can validate each row on its own: a bad row is skipped with the
 * invalid reason while the good rows still report (RVCM1133B).
 */
export const accountsUsageRowSchema = z.strictObject({
  provider: name,
  account: name,
  label: name,
  period: name,
  inputTokens: count,
  outputTokens: count,
  costUsd: z.nullable(legacyUsdSchema),
  certainty: z.enum(['reported', 'estimated', 'unknown']),
})

export const accountsEventRowSchema = z.strictObject({
  type: z.enum(['swap', 'stop', 'spread']),
  provider: name,
  account: name,
  time: z.iso.datetime({ offset: true }),
  trigger: name,
  previousAccount: z.nullable(name),
})

export const accountsConfirmationRowSchema = z.strictObject({
  provider: name,
  product: name,
  choice: z.enum(['confirm', 'ownCapsOnly', 'cancel']),
  answeredAt: z.iso.datetime({ offset: true }),
})

export const accountsAccountRowSchema = z.strictObject({
  id: name,
  label: name,
  order: count,
  limitGroup: z.nullable(name),
  thresholds: accountsThresholdsSchema,
})

export const accountsProviderRowSchema = z.strictObject({
  provider: name,
  product: name,
  auth: name,
  accounts: rows(accountsAccountRowSchema),
})

const factsSchema = z.strictObject({
  providers: rows(accountsProviderRowSchema),
  usage: rows(accountsUsageRowSchema),
  events: rows(accountsEventRowSchema),
  confirmations: rows(accountsConfirmationRowSchema),
})

/** M108's registry, use, swaps and stops, and confirmations for one report. */
export interface ReportAccountsReader {
  read(context: SourceReadContext): Promise<{
    facts: AccountsFacts
    observedAt?: string
    partial?: string
  } | null>
}

function byProvider(left: { provider: string }, right: { provider: string }): number {
  return codeUnitCompare(left.provider, right.provider)
}

function sortFacts(facts: AccountsFacts): AccountsFacts {
  return {
    providers: facts.providers.toSorted(byProvider).map((provider) => ({
      ...provider,
      accounts: provider.accounts.toSorted((left, right) => left.order - right.order),
    })),
    usage: facts.usage.toSorted(
      (left, right) => byProvider(left, right) || codeUnitCompare(left.account, right.account),
    ),
    events: facts.events.toSorted(
      (left, right) =>
        codeUnitCompare(left.time, right.time) ||
        byProvider(left, right) ||
        codeUnitCompare(left.account, right.account),
    ),
    confirmations: facts.confirmations.toSorted(
      (left, right) => byProvider(left, right) || codeUnitCompare(left.product, right.product),
    ),
  }
}

export function accountsSource(reader: ReportAccountsReader | undefined, scrub: SourceScrub) {
  return localSource('accounts', async (context) => {
    if (reader === undefined) throw new LocalSourceError('unbound')
    if (context.options.kind !== 'accounts') throw new LocalSourceError('disabled')
    const read = await reader.read(context)
    if (read === null) throw new LocalSourceError('missing')
    const recovered = recoverSourceFacts(
      context.reportText,
      'accounts',
      'accounts',
      factsSchema,
      read,
    )
    return {
      data: sortFacts(factsSchema.parse(scrubSourceValue(recovered.data, scrub))),
      ...(read.observedAt !== undefined && { observedAt: read.observedAt }),
      ...(recovered.partial !== undefined && { partial: scrub(recovered.partial) }),
    }
  })
}
