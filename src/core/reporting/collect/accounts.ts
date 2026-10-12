// C-M113-3: the `accounts` kind from M108's registry facts. Accounts per
// provider with their placement, configured thresholds, use, swaps and
// stops, and confirmations; labels are resolved locally by the reader.
import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { AccountsFacts, SourceSnapshot } from '../sources/types'
import { count, label, row, sourcedSection, text } from './common'

export function collectAccounts(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const source = snapshot.sources.accounts
  const facts: AccountsFacts | null = source.data
  const ids = [source.record.id]
  const make = (
    heading: 'accounts' | 'limits' | 'usage' | 'swaps' | 'refusals' | 'confirmations',
    columns: Parameters<typeof sourcedSection>[4],
    rows: readonly ReportRow[],
  ) =>
    sourcedSection(snapshot, options, `accounts/${heading}`, heading, columns, rows, ['accounts'])
  const accounts =
    facts?.providers.flatMap((provider) =>
      provider.accounts.map((account) => ({ provider, account })),
    ) ?? []
  const accountLabel = new Map<string, string>()
  for (const { provider, account } of accounts)
    accountLabel.set(JSON.stringify([provider.provider, account.id]), account.label)
  const nameOf = (provider: string, account: string) =>
    accountLabel.get(JSON.stringify([provider, account])) ?? account
  const eventRows = (
    heading: 'swaps' | 'refusals',
    kinds: readonly ('swap' | 'stop' | 'spread')[],
    prefix: string,
  ) =>
    make(
      heading,
      ['name', 'kind', 'outcome', 'date'],
      facts?.events
        .filter((event) => kinds.includes(event.type))
        .map((event) =>
          row(
            prefix,
            [event.provider, event.account, event.type, event.time, event.trigger],
            {
              name: text(nameOf(event.provider, event.account)),
              kind: text(event.type),
              outcome: text(event.trigger),
              date: { type: 'timestamp', value: event.time },
            },
            ids,
          ),
        ) ?? [],
    )
  return [
    make(
      'accounts',
      ['provider', 'account', 'name', 'scope', 'count'],
      accounts.map(({ provider, account }) =>
        row(
          'account',
          [provider.provider, account.id],
          {
            provider: text(provider.provider),
            account: text(account.id),
            name: text(account.label),
            scope: text(account.limitGroup ?? ''),
            // One row names one account: the cell counts accounts, never
            // the account's placement order (RVCM1133).
            count: count(1),
          },
          ids,
        ),
      ),
    ),
    make(
      'limits',
      ['name', 'kind', 'count'],
      accounts.flatMap(({ provider, account }) => {
        const name = text(account.label)
        const identity = [provider.provider, account.id]
        return [
          ...account.thresholds.spendUsd.map((threshold) =>
            row(
              'limit',
              [...identity, 'spendUsd', threshold.period],
              {
                name,
                kind: text(`spendUsd/${threshold.period}`),
                count: { type: 'usd', value: threshold.value, certainty: 'reported' },
              },
              ids,
            ),
          ),
          ...account.thresholds.counts.map((threshold) =>
            row(
              'limit',
              [...identity, threshold.metric, threshold.period],
              {
                name,
                kind: text(`${threshold.metric}/${threshold.period}`),
                count: count(threshold.value),
              },
              ids,
            ),
          ),
          ...account.thresholds.percents.map((threshold) =>
            row(
              'limit',
              [...identity, 'percent', threshold.name],
              {
                name,
                kind: text(`percent/${threshold.name}`),
                count: { type: 'percent', value: threshold.value },
              },
              ids,
            ),
          ),
        ]
      }),
    ),
    make(
      'usage',
      ['name', 'scope', 'inputTokens', 'outputTokens', 'cost', 'certainty'],
      facts?.usage.map((entry) =>
        row(
          'usage',
          [entry.provider, entry.account],
          {
            name: text(entry.label),
            scope: text(entry.provider),
            inputTokens: count(entry.inputTokens),
            outputTokens: count(entry.outputTokens),
            cost: { type: 'usd', value: entry.costUsd, certainty: entry.certainty },
            certainty: label(entry.certainty),
          },
          ids,
        ),
      ) ?? [],
    ),
    eventRows('swaps', ['swap', 'spread'], 'swap'),
    eventRows('refusals', ['stop'], 'refusal'),
    make(
      'confirmations',
      ['provider', 'name', 'kind', 'date'],
      facts?.confirmations.map((entry) =>
        row(
          'confirmation',
          [entry.provider, entry.product],
          {
            provider: text(entry.provider),
            name: text(entry.product),
            kind: text(entry.choice),
            date: { type: 'timestamp', value: entry.answeredAt },
          },
          ids,
        ),
      ) ?? [],
    ),
  ]
}
