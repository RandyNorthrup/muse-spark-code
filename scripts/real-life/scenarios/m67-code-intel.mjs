// M67/D49: references are found, then a rename lands through its approval.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case19 code
//   intelligence: references, then a rename through its card (M67, D49)`
//
// The editor's permission answer is the card: the rename must ask first,
// then both files carry the new name. The asked titles ride the record, so
// the lead can read that the rename asked before it wrote. The editor starts
// trusted, as an editor with a trusted workspace does.
//
// Expected model attempts: 8. Dollar cap: $0.15.
const FROM = 'total'
const TO = 'grandTotal'

export default {
  title: 'References are listed, then a rename lands after an approval',
  acp: {
    claims: ['ref/feature/code-intel', 'ref/feature/permissions', 'ref/feature/acp'],
    requests: 8,
    maxUsd: '0.15',
    async run(person, see) {
      const editor = await person.openEditor(['--trust-workspace'])
      const session = await editor.newSession()
      const staged = await session.prompt(
        `Write two files in the workspace with your file tool, then reply with the one word STAGED. ` +
          `The file math.mjs exports a function ${FROM} that sums an array. ` +
          `The file main.mjs imports ${FROM} from math.mjs and prints ${FROM}([1, 2]).`,
        { permissions: 'allow' },
      )
      see('the staging turn completed', staged.stopReason === 'end_turn', staged.stopReason)
      see(
        'both files are on disk',
        person.file('math.mjs')?.includes(FROM) === true &&
          person.file('main.mjs')?.includes(FROM) === true,
        `math.mjs: ${person.file('math.mjs') ?? 'missing'}; main.mjs: ${person.file('main.mjs') ?? 'missing'}`,
      )
      const found = await session.prompt(
        `Find every reference to the function ${FROM} in the workspace. ` +
          `Reply with each as file:line, one per line, then stop.`,
      )
      see('the references turn completed', found.stopReason === 'end_turn', found.stopReason)
      see(
        'both files are listed as references',
        found.said.includes('math.mjs') && found.said.includes('main.mjs'),
        found.said,
      )
      const renamed = await session.prompt(
        `Rename the function ${FROM} to ${TO} across the workspace, using your rename tool.`,
        { permissions: 'allow' },
      )
      see('the rename turn completed', renamed.stopReason === 'end_turn', renamed.stopReason)
      see(
        'the rename asked before it wrote',
        renamed.asked.length > 0,
        renamed.asked.map((asked) => asked.toolCall?.title ?? '(no title)').join('; ') ||
          'no question',
      )
      see(
        'both files carry the new name',
        person.file('math.mjs')?.includes(TO) === true &&
          person.file('main.mjs')?.includes(TO) === true,
        `math.mjs: ${person.file('math.mjs') ?? 'missing'}; main.mjs: ${person.file('main.mjs') ?? 'missing'}`,
      )
    },
  },
}
