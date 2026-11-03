// M80: the headless command refuses what it cannot run, in its own words.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/execStdio.e2e.test.ts, `M80 E1-E7 built exec > E2/H1 refuses %s with usage/2`
// - the headless refusals of workspace trust and hosted search
//   (src/runtime/exec/execArgs.ts: `execTrustRefused`, `execWebSearchUnbounded`)
//
// Expected model attempts: 0. Dollar cap: $0.00.
import { routeArguments } from '../lib/routes.mjs'

const TRUST_REFUSED = 'Headless runs refuse workspace trust and bypass permissions.'
const SEARCH_REFUSED = 'Hosted web search has no bounded allowance and is refused.'

export default {
  title: 'exec refuses a bad flag, a bad value, trust and hosted search',
  exec: {
    claims: ['ref/cli/exec/exec---help---h', 'ref/feature/exec-refusals'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const mistyped = await person.command(['exec', '--max-requets', '5', 'hi'])
      see(
        'a mistyped flag is refused with exit code 2',
        mistyped.code === 2,
        `exit ${String(mistyped.code)}`,
      )
      see(
        'the refusal suggests the flag it meant',
        mistyped.stderr.includes('--max-requests'),
        mistyped.stderr.trim(),
      )
      const badMode = await person.command([
        'exec',
        ...routeArguments(person.route),
        '--permission-mode',
        'sometimes',
        'hi',
      ])
      see(
        'a bad permission mode is refused with exit code 2',
        badMode.code === 2,
        `exit ${String(badMode.code)}`,
      )
      see(
        'the refusal names an accepted mode',
        badMode.stderr.includes('acceptEdits'),
        badMode.stderr.trim(),
      )
      for (const [flag, sentence] of [
        ['--trust-workspace', TRUST_REFUSED],
        ['--web-search', SEARCH_REFUSED],
      ]) {
        const refused = await person.command([
          'exec',
          ...routeArguments(person.route),
          flag,
          '--permission-mode',
          'plan',
          '--max-budget-usd',
          '3.00',
          'hi',
        ])
        see(
          `${flag} is refused with exit code 2`,
          refused.code === 2,
          `exit ${String(refused.code)}`,
        )
        see(
          `${flag} is refused in the product's own sentence`,
          refused.stderr.includes(sentence),
          refused.stderr.trim(),
        )
      }
    },
  },
}
