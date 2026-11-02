// M70: /review reads an uncommitted change and finds its flaw.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case23 /review
//   as the Reviewer: git's material marked untrusted, tools that only read,
//   findings the panel lists (M70)`
// - test/unit/review.test.ts, the Reviewer rows (the role and the method; the
//   tools are the workspace readers and the Problems panel, nothing that
//   writes, runs or reaches the network)
// - test/unit/reviewMaterial.test.ts, the uncommitted-change rows (staged and
//   unstaged changes diffed against HEAD; files that may hold secrets left out)
//
// The model stages a one-file repository with one committed file and one
// uncommitted flaw; /review must name that file. The asked titles ride the
// record, so the lead can read that the review only read. The editor starts
// trusted: git runs only in a trusted workspace (src/core/review/
// reviewMaterial.ts), and the review refuses first otherwise.
//
// Expected model attempts: 8. Dollar cap: $0.15.
const FILE = 'calc.mjs'

export default {
  title: '/review names the file an uncommitted change flawed',
  acp: {
    claims: ['ref/slash/review', 'ref/feature/review', 'ref/feature/acp'],
    requests: 8,
    maxUsd: '0.15',
    async run(person, see) {
      const editor = await person.openEditor(['--trust-workspace'])
      const session = await editor.newSession()
      const staged = await session.prompt(
        `In the workspace, with your shell and file tools: initialize a git repository, ` +
          `set a local test identity, and commit a file ${FILE} holding ` +
          `export function add(a, b) { return a + b; }. ` +
          `Then change add to return a - b instead, without committing. ` +
          `Reply with the one word STAGED.`,
        { permissions: 'allow' },
      )
      see('the staging turn completed', staged.stopReason === 'end_turn', staged.stopReason)
      see(
        'the working file holds the flaw',
        person.file(FILE)?.includes('a - b') === true,
        person.file(FILE) ?? 'no such file',
      )
      // Bare: any trailing text would make it custom instructions, which
      // read no git (src/shared/reviewCommand.ts).
      const review = await session.prompt('/review', { permissions: 'allow' })
      see('the review ends as a finished turn', review.stopReason === 'end_turn', review.stopReason)
      see('the findings name the flawed file', review.said.includes(FILE), review.said)
      see(
        'the review asked before it read',
        review.asked.length > 0,
        review.asked.map((asked) => asked.toolCall?.title ?? '(no title)').join('; ') ||
          'no question',
      )
    },
  },
}
