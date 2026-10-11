import type { ReportOptions, ReportSection } from '../../../shared/reportSchema'
import type { SourceSnapshot } from '../sources/types'
import {
  CHECK_COLUMNS,
  checkRows,
  compare,
  certificationRows,
  label,
  row,
  sourcedSection,
  text,
} from './common'
import { ciSection } from './repository'

export function collectQuality(snapshot: SourceSnapshot, options: ReportOptions): ReportSection[] {
  const pkg = snapshot.sources.package
  const checks = snapshot.sources.checkRuns
  const certification = snapshot.sources.certification
  const lastChecks = new Map<string, NonNullable<typeof checks.data>[number]>()
  const orderedChecks =
    checks.data?.toSorted(
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) ||
        compare(JSON.stringify(left), JSON.stringify(right)),
    ) ?? []
  for (const run of orderedChecks) {
    lastChecks.set(run.check, run)
  }
  const missingRuns =
    pkg.data?.qualityScripts
      .filter((script) => !lastChecks.has(script.name))
      .map((script) =>
        row(
          '0-check',
          [script.name],
          {
            name: text(script.name),
            outcome: label('unavailable'),
            duration: label('unknown'),
            commit: label('unknown'),
            date: label('unknown'),
            status: label('unavailable'),
            reason: text(`checkRuns/${script.name}=undefined`),
          },
          [pkg.record.id, checks.record.id],
        ),
      ) ?? []
  return [
    sourcedSection(
      snapshot,
      options,
      'gates',
      'gates',
      ['name', 'gates'],
      pkg.data?.qualityScripts.map((script) =>
        row('gate', [script.name], { name: text(script.name), gates: text(script.command) }, [
          pkg.record.id,
        ]),
      ) ?? [],
      ['package'],
    ),
    sourcedSection(
      snapshot,
      options,
      'lastLocalRuns',
      'checks',
      CHECK_COLUMNS,
      [
        ...missingRuns,
        ...checkRows(
          Array.from(lastChecks, ([, record]) => record),
          checks.record.id,
        ),
      ],
      ['checkRuns'],
    ),
    ciSection(snapshot, options),
    sourcedSection(
      snapshot,
      options,
      'certification',
      'certification',
      ['milestones', 'files', 'count', 'totals'],
      certificationRows(certification.data?.records ?? [], certification.record.id),
      ['certification'],
    ),
  ]
}
