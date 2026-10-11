// C-M113-3: the `security` kind from M109's vault audit and the developer
// audit. Counts, kinds, decisions and outcomes only: the source projects
// away every value before these rows are built, and this collector never
// reintroduces one.
import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import type { SecurityFacts, SourceSnapshot } from '../sources/types'
import { compare, count, row, sourcedSection, text } from './common'

function grouped(
  entries: readonly (readonly [string, string])[],
  prefix: string,
  ids: readonly string[],
  cells: (kind: string, outcome: string, total: number) => ReportRow['cells'],
): ReportRow[] {
  const totals = new Map<string, { kind: string; outcome: string; total: number }>()
  for (const [kind, outcome] of entries) {
    const identity = JSON.stringify([kind, outcome])
    const group = totals.get(identity) ?? { kind, outcome, total: 0 }
    group.total += 1
    totals.set(identity, group)
  }
  return [...totals]
    .toSorted(
      ([, left], [, right]) =>
        compare(left.kind, right.kind) || compare(left.outcome, right.outcome),
    )
    .map(([, group]) =>
      row(prefix, [group.kind, group.outcome], cells(group.kind, group.outcome, group.total), ids),
    )
}

export function collectSecurity(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const source = snapshot.sources.security
  const facts: SecurityFacts | null = source.data
  const ids = [source.record.id]
  const make = (
    heading: 'vault' | 'breakdown' | 'grants' | 'usage' | 'denials' | 'locks' | 'developerAudit',
    columns: Parameters<typeof sourcedSection>[4],
    rows: readonly ReportRow[],
  ) =>
    sourcedSection(snapshot, options, `security/${heading}`, heading, columns, rows, ['security'])
  const vault = facts?.vault
  return [
    make(
      'vault',
      ['name', 'kind'],
      vault === null || vault === undefined
        ? []
        : [
            row('vault', ['state'], { name: text('state'), kind: text(vault.state) }, ids),
            row(
              'vault',
              ['tier'],
              { name: text('tier'), kind: text(vault.tier ?? 'unknown') },
              ids,
            ),
            row(
              'vault',
              ['items'],
              { name: text('items'), kind: text(String(vault.itemCount)) },
              ids,
            ),
          ],
    ),
    make(
      'breakdown',
      ['kind', 'count'],
      vault?.itemsByKind.map((entry) =>
        row('vault-kind', [entry.kind], { kind: text(entry.kind), count: count(entry.count) }, ids),
      ) ?? [],
    ),
    make(
      'grants',
      ['kind', 'count'],
      vault?.grants.map((entry) =>
        row(
          'vault-grant',
          [entry.scope],
          { kind: text(entry.scope), count: count(entry.count) },
          ids,
        ),
      ) ?? [],
    ),
    make(
      'usage',
      ['kind', 'outcome', 'count'],
      grouped(
        (facts?.audit ?? [])
          .filter((entry) => entry.decision === 'allow')
          .map((entry) => [entry.kind, entry.outcome] as const),
        'vault-use',
        ids,
        (kind, outcome, total) => ({
          kind: text(kind),
          outcome: text(outcome),
          count: count(total),
        }),
      ),
    ),
    make(
      'denials',
      ['kind', 'outcome', 'count'],
      grouped(
        (facts?.audit ?? [])
          .filter((entry) => entry.decision === 'deny' || entry.outcome === 'denied')
          .map((entry) => [entry.kind, entry.outcome] as const),
        'vault-denial',
        ids,
        (kind, outcome, total) => ({
          kind: text(kind),
          outcome: text(outcome),
          count: count(total),
        }),
      ),
    ),
    make(
      'locks',
      ['kind', 'outcome', 'count'],
      grouped(
        (facts?.audit ?? [])
          .filter((entry) => entry.outcome === 'locked')
          .map((entry) => [entry.kind, entry.outcome] as const),
        'vault-lock',
        ids,
        (kind, outcome, total) => ({
          kind: text(kind),
          outcome: text(outcome),
          count: count(total),
        }),
      ),
    ),
    make(
      'developerAudit',
      ['name', 'kind', 'count'],
      grouped(
        (facts?.developerAudit ?? []).map((entry) => [entry.action, entry.source] as const),
        'developer-audit',
        ids,
        (action, origin, total) => ({
          name: text(action),
          kind: text(origin),
          count: count(total),
        }),
      ),
    ),
  ]
}
