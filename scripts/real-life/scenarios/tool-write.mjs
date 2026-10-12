// A person asks for a file. In the editor the agent asks first and the
// person says yes; at the terminal the person lets edits through with
// `--permission-mode acceptEdits`. Afterwards the file is on disk.
const FILE = 'real-life-note.txt'
const ask = (marker) =>
  `Create a file named ${FILE} in the workspace whose whole content is the single line ${marker}. Then reply with the one word DONE.`

export default {
  title: 'A tool turn writes a file after an approval',
  exec: {
    claims: ['ref/cli/exec/exec---permission-mode-value', 'ref/cli/exec/exec'],
    requests: 4,
    async run(person, see) {
      const marker = person.marker()
      const turn = await person.exec(ask(marker), { mode: 'acceptEdits', maxRequests: 4 })
      see('the command ends with exit code 0', turn.code === 0, `exit ${String(turn.code)}`)
      see(
        'the file is on disk with the content asked for',
        person.file(FILE)?.includes(marker) === true,
        person.file(FILE) ?? 'no such file',
      )
      see(
        'the result lists the file as changed',
        JSON.stringify(turn.result?.filesChanged ?? []).includes(FILE),
        JSON.stringify(turn.result?.filesChanged ?? []),
      )
    },
  },
  acp: {
    claims: ['ref/feature/permissions', 'ref/feature/acp'],
    requests: 4,
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const turn = await session.prompt(ask(marker), { permissions: 'allow' })
      see(
        'the agent asked before it wrote',
        turn.asked.length > 0,
        turn.asked.map((asked) => asked.toolCall?.title ?? '(no title)').join('; ') ||
          'no question',
      )
      see('the turn ends as a finished turn', turn.stopReason === 'end_turn', turn.stopReason)
      see(
        'the file is on disk with the content asked for',
        person.file(FILE)?.includes(marker) === true,
        person.file(FILE) ?? 'no such file',
      )
    },
  },
}
