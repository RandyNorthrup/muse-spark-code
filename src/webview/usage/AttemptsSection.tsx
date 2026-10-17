import { USAGE_TEXT } from '../../shared/l10n/usageTable'
import type { UsagePageState } from '../../shared/usagePage'
import { count, dayLabel } from './display'

export function AttemptsSection({ attempts }: { readonly attempts: UsagePageState['attempts'] }) {
  if (attempts.length === 0)
    return (
      <section>
        <h2>{USAGE_TEXT.attempts}</h2>
        <p>{USAGE_TEXT.emptyRange}</p>
      </section>
    )
  const origins = {
    turn: USAGE_TEXT.originTurn,
    reminder: USAGE_TEXT.originReminder,
    subagent: USAGE_TEXT.originSubagent,
  }
  return (
    <section>
      <h2>{USAGE_TEXT.attempts}</h2>
      <p>{USAGE_TEXT.attemptsNote}</p>
      <div
        className="usage-table-scroll"
        role="region"
        aria-label={USAGE_TEXT.attempts}
        tabIndex={0}
      >
        <table>
          <caption>{USAGE_TEXT.attempts}</caption>
          <thead>
            <tr>
              <th scope="col">{USAGE_TEXT.dateColumn}</th>
              <th scope="col">{USAGE_TEXT.feature}</th>
              <th scope="col">{USAGE_TEXT.attempts}</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((row) => (
              <tr key={`${row.day}:${row.origin}`}>
                <th scope="row">{dayLabel(row.day)}</th>
                <td>{origins[row.origin]}</td>
                <td>{count(row.attempts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
