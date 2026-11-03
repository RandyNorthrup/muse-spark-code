// M80: what `exec --output jsonl` prints is one valid envelope per line.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/execOutput.test.ts, `M80 egress (A12–A14, A17, A19, A20) >
//   A12 emits valid increasing JSONL envelopes with one final result and a summary`
// - test/unit/execSchema.test.ts, `M80 schemas (A15/A16/F1) > A15 matches
//   deterministic committed schemas and fails on field drift` (the shape a
//   run must match; the committed files stay the authority)
// - test/unit/execSchema.test.ts, `M80 schemas (A15/A16/F1) > A16 enforces
//   %s = %i, error and null signal` (a finished turn's result shape)
// - test/e2e/execStdio.e2e.test.ts, `M80 E1-E7 built exec > E5 %s while
//   streaming is bounded` (a long answer streams to its end within bounds)
//
// Meta's key rides on standard input, which only person.exec carries; a raw
// command cannot turn there. The envelope shape is the same on every route,
// so providers prove it.
//
// Expected model attempts: 4. Dollar cap: $0.10.
import { EXEC_ADMIT_USD } from '../lib/limits.mjs'
import { routeArguments } from '../lib/routes.mjs'

/** Every stdout line parsed, or the lines that are not JSON. */
function envelopes(stdout) {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '')
  const parsed = []
  const broken = []
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line))
    } catch {
      broken.push(line)
    }
  }
  return { lines, parsed, broken }
}

const LONG =
  'In your reply itself, with no tool and no file, count from 1 to 300 in words, one number per line, and do not stop or summarise before 300.'
const FINISHED = /three hundred|\b300\b/iu

export default {
  title: 'exec --output jsonl prints valid envelopes with one final result',
  only: (route) => route.kind === 'provider' && route.note === undefined,
  exec: {
    claims: ['ref/cli/exec/exec---output-value', 'ref/feature/exec-egress'],
    requests: 4,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const turn = await person.command([
        'exec',
        ...routeArguments(person.route),
        '--permission-mode',
        'plan',
        '--max-requests',
        '1',
        '--max-budget-usd',
        EXEC_ADMIT_USD,
        '--output',
        'jsonl',
        person.connectionCheck(marker),
      ])
      see('the command ends with exit code 0', turn.code === 0, `exit ${String(turn.code)}`)
      const { lines, parsed, broken } = envelopes(turn.stdout)
      see('every line is one JSON envelope', broken.length === 0, broken.join('\n') || '(all JSON)')
      see('more than a bare result was printed', lines.length > 1, `${String(lines.length)} lines`)
      const results = parsed.filter((event) => event?.type === 'result')
      see('exactly one final result closes the stream', results.length === 1, turn.stdout)
      const result = results[0]?.result
      see(
        'the result carries the turn for the model asked',
        result?.model === person.route.modelId && result?.usage?.requests === 1,
        JSON.stringify({ model: result?.model, requests: result?.usage?.requests }),
      )
      see(
        'the answer carries the word that was asked for',
        result?.finalMessage?.includes(marker) === true,
        result?.finalMessage ?? result?.error?.message ?? turn.stderr,
      )
      const long = await person.command([
        'exec',
        ...routeArguments(person.route),
        '--permission-mode',
        'plan',
        '--max-requests',
        '3',
        '--max-budget-usd',
        EXEC_ADMIT_USD,
        '--output',
        'jsonl',
        LONG,
      ])
      see('a long answer streams to its end', long.code === 0, `exit ${String(long.code)}`)
      const streamed = envelopes(long.stdout)
      see(
        'its lines are all valid envelopes too',
        streamed.broken.length === 0,
        streamed.broken.join('\n') || `(all ${String(streamed.lines.length)} JSON)`,
      )
      const last = streamed.parsed.filter((event) => event?.type === 'result')
      see(
        'the long answer finished its count',
        last.length === 1 && FINISHED.test(last[0]?.result?.finalMessage ?? ''),
        `${String(last.length)} result(s)`,
      )
    },
  },
}
