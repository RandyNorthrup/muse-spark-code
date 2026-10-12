// A person asks one thing and gets the answer.
export default {
  title: 'A plain turn completes',
  order: 1,
  exec: {
    claims: [
      'ref/cli/exec/exec',
      'ref/cli/exec/exec---model-value',
      'ref/cli/exec/exec---output-value',
    ],
    requests: 1,
    async run(person, see) {
      const marker = person.marker()
      const turn = await person.exec(`Reply with exactly this and nothing else: ${marker}`)
      see('the command ends with exit code 0', turn.code === 0, `exit ${String(turn.code)}`)
      see(
        'the answer carries the word that was asked for',
        turn.result?.finalMessage?.includes(marker) === true,
        turn.result?.finalMessage ?? turn.result?.error?.message ?? turn.stderr,
      )
      see(
        'the result names the model the person chose',
        turn.result?.model === person.route.modelId,
        String(turn.result?.model),
      )
      const usage = turn.result?.usage
      see(
        'one request was made and it cost more than nothing',
        usage?.requests === 1 && Number(usage.costUsd?.total) > 0,
        `${String(usage?.requests)} request(s), $${String(usage?.costUsd?.total)}`,
      )
    },
  },
  acp: {
    claims: ['ref/feature/acp', 'ref/feature/chat'],
    requests: 1,
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const turn = await session.prompt(`Reply with exactly this and nothing else: ${marker}`)
      see('the turn ends as a finished turn', turn.stopReason === 'end_turn', turn.stopReason)
      see('the answer carries the word that was asked for', turn.said.includes(marker), turn.said)
      see(
        'the session runs on the model the person chose',
        session.currentModel() === person.route.modelId,
        String(session.currentModel()),
      )
    },
  },
}
