// A conversation is saved; the editor is closed and the agent's process
// ends; a new process lists the conversation, loads it with what was said,
// and goes on with it.
export default {
  title: 'A session is saved, the process ends, the session loads and continues',
  acp: {
    claims: ['ref/feature/history', 'ref/feature/acp'],
    requests: 2,
    async run(person, see) {
      const marker = person.marker()
      const first = await person.openEditor()
      const session = await first.newSession()
      const told = await session.prompt(
        `Remember this code word for later: ${marker}. Reply with the one word OK.`,
      )
      see('the first turn completed', told.stopReason === 'end_turn', told.stopReason)
      const exit = await first.stop()
      see('the agent ends when the editor closes it', exit.code === 0, `exit ${String(exit.code)}`)

      const second = await person.openEditor()
      const listed = await second.listSessions()
      see(
        'the new process lists the conversation',
        listed.some((one) => one.sessionId === session.sessionId),
        `${String(listed.length)} listed`,
      )
      const loaded = await second.loadSession(session.sessionId)
      const replayed = JSON.stringify(loaded.replayed)
      see(
        'loading it shows what was said before',
        replayed.includes(marker),
        `${String(loaded.replayed.length)} updates replayed`,
      )
      if (loaded.currentModel() !== person.route.modelId)
        await loaded.setModel(person.route.modelId)
      const asked = await loaded.prompt(
        'What was the code word I asked you to remember? Reply with the code word only.',
      )
      see('the conversation goes on', asked.stopReason === 'end_turn', asked.stopReason)
      see(
        'and knows what was said before the process ended',
        asked.said.includes(marker),
        asked.said,
      )
    },
  },
}
