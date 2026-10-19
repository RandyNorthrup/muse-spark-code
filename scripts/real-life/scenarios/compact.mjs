// A person compacts a conversation with `/compact` and goes on with it: the
// product says what it did, and the next turn still knows what was said
// before. At the terminal, on a conversation with nothing in it, `/compact`
// has nothing to do and says so.
export default {
  title: '/compact works',
  exec: {
    claims: ['ref/slash/compact'],
    requests: 0,
    async run(person, see) {
      const turn = await person.exec('/compact')
      see(
        'no model request was made',
        (turn.result?.usage?.requests ?? -1) === 0,
        `${String(turn.result?.usage?.requests)} request(s)`,
      )
      see(
        'the result says there was nothing to compact',
        turn.result?.incompleteReason === 'no_compactable_history',
        `exit ${String(turn.code)}, status ${String(turn.result?.status)}, ${String(turn.result?.incompleteReason)}`,
      )
    },
  },
  acp: {
    claims: ['ref/slash/compact', 'ref/feature/compaction'],
    requests: 8,
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const first = await session.prompt(
        `Remember this code word for later: ${marker}. Reply with the one word OK.`,
      )
      see('the first turn completed', first.stopReason === 'end_turn', first.stopReason)
      const second = await session.prompt(
        'Write four short sentences about why tests should use the real product. Plain text.',
      )
      see('the second turn completed', second.stopReason === 'end_turn', second.stopReason)
      const compacted = await session.prompt('/compact')
      see(
        '/compact ends as a finished turn',
        compacted.stopReason === 'end_turn',
        compacted.stopReason,
      )
      see(
        'the person is told what /compact did',
        compacted.said.trim() !== '',
        compacted.said.trim() === '' ? 'nothing was shown' : compacted.said,
      )
      const after = await session.prompt(
        'What was the code word I asked you to remember? Reply with the code word only.',
      )
      see('the conversation goes on after it', after.stopReason === 'end_turn', after.stopReason)
      see('and still knows what was said before', after.said.includes(marker), after.said)
    },
  },
}
