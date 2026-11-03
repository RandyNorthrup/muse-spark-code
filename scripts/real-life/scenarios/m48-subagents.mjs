// M48: a child task runs and its answer returns to the parent.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/e2e/modelApi.live.e2e.test.ts, `live Model API sweep > case10
//   subagents: a child task, its price accepted, runs and returns (M48)`
//
// The permission answer accepts the child's price (src/acp/paid.ts). The
// proof is not the code word alone — the prompt holds it, so the model could
// echo it — but the Spawn Agent tool call beside it: a child ran. The editor
// starts trusted: the agents catalogue is hidden otherwise.
//
// Expected model attempts: 6. Dollar cap: $0.15.
const SPAWNED = 'Spawn Agent'

export default {
  title: 'A subagent runs and its answer returns',
  acp: {
    claims: ['ref/feature/subagents', 'ref/feature/acp'],
    requests: 6,
    maxUsd: '0.15',
    async run(person, see) {
      const marker = person.marker()
      const editor = await person.openEditor(['--trust-workspace'])
      const session = await editor.newSession()
      const turn = await session.prompt(
        `Spawn a subagent with this exact objective: Reply with only this code: ${marker}. ` +
          `Wait for its result, then reply with only the code it returned.`,
        { permissions: 'allow' },
      )
      see('the turn ends as a finished turn', turn.stopReason === 'end_turn', turn.stopReason)
      const titles = turn.updates
        .map((entry) => entry.update?.sessionUpdate === 'tool_call' && entry.update.title)
        .filter((title) => typeof title === 'string')
      see(
        'a subagent was spawned',
        titles.some((title) => title.startsWith(SPAWNED)),
        titles.join('; ') || 'no tool call',
      )
      see('the child’s code came back', turn.said.includes(marker), turn.said)
    },
  },
}
