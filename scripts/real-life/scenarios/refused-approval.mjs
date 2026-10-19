// A person asks for a file and then says no when the agent asks; at the
// terminal the run is in Plan, where nothing is written. Afterwards the
// workspace is as it was.
const FILE = 'real-life-refused.txt'
const ask = (marker) =>
  `Create a file named ${FILE} in the workspace whose whole content is the single line ${marker}. Do it now with your file tool; do not only describe it.`

export default {
  title: 'A refused approval changes nothing',
  exec: {
    claims: ['ref/cli/exec/exec---permission-mode-value'],
    requests: 3,
    async run(person, see) {
      const turn = await person.exec(ask(person.marker()), { mode: 'plan', maxRequests: 3 })
      see('no file was written', person.file(FILE) === undefined, person.file(FILE) ?? 'no file')
      see(
        'the result lists no changed file',
        (turn.result?.filesChanged ?? []).length === 0,
        JSON.stringify(turn.result?.filesChanged ?? null),
      )
      see(
        'the command ends with a result',
        turn.result !== undefined,
        `exit ${String(turn.code)}, status ${String(turn.result?.status)}`,
      )
    },
  },
  acp: {
    claims: ['ref/feature/permissions', 'ref/feature/acp'],
    requests: 3,
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const turn = await session.prompt(ask(person.marker()), { permissions: 'reject' })
      see(
        'the agent asked before it wrote',
        turn.asked.length > 0,
        turn.asked.map((asked) => asked.toolCall?.title ?? '(no title)').join('; ') ||
          'no question',
      )
      see('no file was written', person.file(FILE) === undefined, person.file(FILE) ?? 'no file')
      see(
        'the turn still ends',
        typeof turn.stopReason === 'string',
        `${String(turn.stopReason)}: ${turn.said}`,
      )
    },
  },
}
