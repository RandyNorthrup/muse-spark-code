// M49: a remembered fact survives into a session that never heard it.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case07 memory:
//   a fact remembered where the memory store places it (M49)`
//
// The first session tells the model the code word; a NEW session, with no
// history of it, must still answer it. Only the memory store carries facts
// across sessions, so the recall proves the memory. The editor starts
// trusted: the memory tools are offered only then, with a memory store.
//
// Expected model attempts: 4. Dollar cap: $0.10.
export default {
  title: 'A remembered code word answers in a new session',
  acp: {
    claims: ['ref/feature/memory', 'ref/feature/acp'],
    requests: 4,
    maxUsd: '0.10',
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor(['--trust-workspace'])
      const first = await editor.newSession()
      const told = await first.prompt(
        `Remember this: my code word is ${marker}. Reply with the one word OK.`,
      )
      see('the first turn completed', told.stopReason === 'end_turn', told.stopReason)
      const second = await editor.newSession()
      const asked = await second.prompt('What is my code word? Reply with the code word only.')
      see('the new session answers', asked.stopReason === 'end_turn', asked.stopReason)
      see('it answers the word it never heard', asked.said.includes(marker), asked.said)
    },
  },
}
