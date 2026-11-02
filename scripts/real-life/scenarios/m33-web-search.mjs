// M33: hosted web search runs in the editor and is refused headless.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case11 web
//   search: a search runs, is counted, and replays (M33)`
//
// In the editor the search is a paid feature: the permission answer accepts
// its price (src/acp/paid.ts), and the usage records the turn above zero.
// Whether the provider searched or the model answered from memory is in the
// answer's own words: the lead reads the record for it. Headless, hosted
// search has no bounded allowance and is refused at parse.
//
// Expected model attempts: 4. Dollar cap: $0.15.
import { routeArguments } from '../lib/routes.mjs'

const REFUSED = 'Hosted web search has no bounded allowance and is refused.'

export default {
  title: 'Web search runs in the editor and is refused headless',
  exec: {
    claims: ['ref/cli/exec/exec---web-search'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const refused = await person.command([
        'exec',
        ...routeArguments(person.route),
        '--web-search',
        '--permission-mode',
        'plan',
        '--max-budget-usd',
        '3.00',
        'hi',
      ])
      see(
        'headless search is refused with exit code 2',
        refused.code === 2,
        `exit ${String(refused.code)}`,
      )
      see(
        'the refusal is the product’s own sentence',
        refused.stderr.includes(REFUSED),
        refused.stderr.trim(),
      )
    },
  },
  acp: {
    claims: ['ref/feature/web-search', 'ref/feature/acp'],
    requests: 4,
    maxUsd: '0.15',
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor(['--web-search'])
      const session = await editor.newSession()
      const turn = await session.prompt(
        `Search the web for the current stable version of Node.js. ` +
          `Reply with the version number, one sentence, and this reference code: ${marker}.`,
        { permissions: 'allow' },
      )
      see(
        'the search turn ends as a finished turn',
        turn.stopReason === 'end_turn',
        turn.stopReason,
      )
      see('the answer carries the reference code', turn.said.includes(marker), turn.said)
      const records = await person.usage()
      const mine = records.filter((record) => record.session === session.sessionId)
      see(
        'the usage records the turn above zero',
        mine.length > 0 && mine.every((record) => Number(record.cost?.usd) > 0),
        mine.map((record) => `$${String(record.cost?.usd)}`).join(', ') || 'no request recorded',
      )
    },
  },
}
