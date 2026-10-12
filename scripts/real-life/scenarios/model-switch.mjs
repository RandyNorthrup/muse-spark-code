// The editor shows the models a session can run on; the person picks one,
// and the next turn runs on it: the product's own usage names that model.
export default {
  title: 'The model list and a model switch',
  acp: {
    claims: ['ref/slash/model', 'ref/feature/providers', 'ref/feature/acp'],
    requests: 1,
    async run(person, see) {
      const wanted = person.route.modelId
      const editor = await person.openEditor()
      const session = await editor.newSession()
      see(
        'the list offers the model of this route',
        session.models().includes(wanted),
        session.models().join(', '),
      )
      const other = session.models().find((model) => model !== wanted)
      if (other !== undefined) {
        const moved = await session.setModel(other)
        see('the session moves to another listed model', moved === other, String(moved))
      }
      const back = await session.setModel(wanted)
      see('the session moves to the model the person picks', back === wanted, String(back))
      const marker = person.marker()
      const turn = await session.prompt(`Reply with exactly this and nothing else: ${marker}`)
      see(
        'a turn completes on it',
        turn.stopReason === 'end_turn' && turn.said.includes(marker),
        turn.said,
      )
      const records = await person.usage()
      const mine = records.filter((record) => record.session === session.sessionId)
      see(
        'the usage names that model for the turn',
        mine.length > 0 && mine.every((record) => record.model === wanted),
        mine.map((record) => record.model).join(', ') || 'no request recorded for the session',
      )
    },
  },
}
