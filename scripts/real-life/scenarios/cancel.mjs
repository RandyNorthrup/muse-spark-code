// A person stops a turn while the answer is still coming. The turn ends as
// cancelled, and the conversation can be used again.
const LONG =
  'Count from 1 to 300 in words, one number per line, and do not stop or summarise before 300.'

export default {
  title: 'A turn is cancelled in the middle',
  acp: {
    claims: ['ref/feature/acp'],
    requests: 2,
    async run(person, see) {
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const firstWords = editor.nextUpdate(
        (entry) => entry.update?.sessionUpdate === 'agent_message_chunk',
      )
      const running = session.start(LONG)
      await firstWords
      running.cancel()
      const turn = await running.done
      see('the turn ends as cancelled', turn.stopReason === 'cancelled', turn.stopReason)
      see(
        'the answer stopped before its end',
        !/three hundred/iu.test(turn.said),
        `${String(turn.said.length)} characters arrived`,
      )
      // What the model makes of a cut-off request is its own business: the
      // conversation taking the next message and answering it is the product's.
      const next = await session.prompt('Reply with the one word OK.')
      see(
        'the conversation takes the next message and answers it',
        next.stopReason === 'end_turn' && next.said.trim() !== '',
        `${next.stopReason}: ${next.said}`,
      )
    },
  },
}
