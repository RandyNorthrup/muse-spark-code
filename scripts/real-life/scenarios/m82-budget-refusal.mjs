// M82: a run that cannot afford one request is refused before anything is sent.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/sessionBudget.test.ts, the reserveRequest rows (a request with
//   no room for one output token is refused with its reason; spend past the
//   cap refuses whatever the request; an unpriced model refuses because the
//   cap could not be kept)
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case22 session
//   budget: each request estimated at or above what Meta counts, and one that
//   cannot fit never sent (M82)` (the never-sent half; the estimate half is
//   a lead-only comparison against Meta's own counts)
//
// The budget is the run's own read-back value (one millionth of a dollar),
// under which nothing can be sent. Runs late: a refused run keeps its
// reservation in the product's daily ledger for the rest of the day, so it
// must not starve the scenarios after it. Meta's key rides on standard
// input, which only person.exec carries; a raw command cannot turn there.
// The refusal is the same on every route, so providers prove it.
//
// Expected model attempts: 0. Dollar cap: $0.00.
import { routeArguments } from '../lib/routes.mjs'

const NOTHING_SENDS_USD = '0.000001'

export default {
  title: 'A run under its budget is refused before anything is sent',
  only: (route) => route.kind === 'provider' && route.note === undefined,
  // With the other refusals, late: the reservation stays in the day's ledger.
  order: 85,
  exec: {
    claims: ['ref/cli/exec/exec---max-budget-usd-value', 'ref/feature/budget'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const turn = await person.command([
        'exec',
        ...routeArguments(person.route),
        '--permission-mode',
        'plan',
        '--max-requests',
        '1',
        '--max-budget-usd',
        NOTHING_SENDS_USD,
        '--output',
        'jsonl',
        'Reply with the one word OK.',
      ])
      const results = turn.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => {
          try {
            return JSON.parse(line)
          } catch {
            return
          }
        })
        .filter((event) => event?.type === 'result')
      see(
        'the run ends with one result, not a sent turn',
        results.length === 1,
        `${String(results.length)} result(s), exit ${String(turn.code)}`,
      )
      see(
        'the result says the budget stopped it before anything was sent',
        results[0]?.result?.status === 'budget_exceeded' &&
          results[0]?.result?.usage?.requests === 0,
        JSON.stringify({
          status: results[0]?.result?.status,
          requests: results[0]?.result?.usage?.requests,
        }),
      )
      // EXEC_EXIT.limit, as for any run a cap stops (src/runtime/exec/execProtocol.ts).
      see('the command ends with exit code 5', turn.code === 5, `exit ${String(turn.code)}`)
    },
  },
}
