// M69: a page is fetched and its words reach the model.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/webFetch.test.ts, the end-to-end rows (a page read pinned to
//   its checked address as marked Markdown; text inside the untrusted
//   markers; a long page cut for the model, saying so)
// - test/unit/cards.test.tsx, `ApprovalCard > names the page a web fetch
//   will read (M69)` (the approval names the page; its title rides the record)
//
// The proof is the Fetch Page tool call: the page left the network. The
// heading it quotes proves its words reached the model. Private addresses,
// redirects and the encoding rows need live edge servers and stay manual:
// the index names them. The editor starts trusted: web_fetch is offered
// only then.
//
// Expected model attempts: 4. Dollar cap: $0.10.
const FETCHED = 'Fetch Page'
const PAGE = 'https://example.com'

export default {
  title: 'A page is fetched and its heading quoted',
  acp: {
    claims: ['ref/feature/web-fetch', 'ref/feature/acp'],
    requests: 4,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor(['--trust-workspace'])
      const session = await editor.newSession()
      const turn = await session.prompt(
        `Fetch ${PAGE} and quote its main heading, then stop with this reference code: ${marker}.`,
        { permissions: 'allow' },
      )
      see('the turn ends as a finished turn', turn.stopReason === 'end_turn', turn.stopReason)
      const titles = turn.updates
        .map((entry) => entry.update?.sessionUpdate === 'tool_call' && entry.update.title)
        .filter((title) => typeof title === 'string')
      see(
        'the page left the network through the fetch tool',
        titles.some((title) => title.startsWith(FETCHED)),
        titles.join('; ') || 'no tool call',
      )
      see(
        'the agent asked before it fetched',
        turn.asked.length > 0,
        turn.asked.map((asked) => asked.toolCall?.title ?? '(no title)').join('; ') ||
          'no question',
      )
      see(
        'the heading and the reference code came back',
        turn.said.includes('Example Domain') && turn.said.includes(marker),
        turn.said,
      )
    },
  },
}
