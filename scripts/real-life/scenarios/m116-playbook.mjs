// M116: the orchestrator playbook from the terminal and the editor.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/acpPlaybook.test.ts, the whole file (ACP /playbook renders
//   status, record and settings through the same port as the CLI)
// - test/unit/playbookCommand.test.ts, the CLI view rows (status, record
//   and settings without any model) and the bad-syntax row
//
// Rule changes (a reason required, the safety switch forbidden) mutate the
// shared journal and are a lead-only run: the index names the steps.
//
// Expected model attempts: 0. Dollar cap: $0.00.
export default {
  title: 'playbook status, record and settings agree on both surfaces',
  exec: {
    claims: ['ref/cli/playbook/playbook', 'ref/feature/playbook'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      for (const view of ['status', 'record', 'settings']) {
        const shown = await person.command(['playbook', view])
        see(
          `playbook ${view} ends with exit code 0`,
          shown.code === 0,
          `exit ${String(shown.code)}`,
        )
        see(`playbook ${view} renders text`, shown.stdout.trim() !== '', shown.stdout.trim())
      }
      const bad = await person.command(['playbook', 'frobnicate'])
      see('a bad view is refused with exit code 2', bad.code === 2, `exit ${String(bad.code)}`)
    },
  },
  acp: {
    claims: ['ref/slash/playbook', 'ref/feature/playbook'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const fromCli = await person.command(['playbook', 'status'])
      see(
        'the terminal renders the status first',
        fromCli.code === 0 && fromCli.stdout.trim() !== '',
        `exit ${String(fromCli.code)}`,
      )
      const editor = await person.openEditor()
      const session = await editor.newSession()
      const turn = await session.prompt('/playbook status')
      see('/playbook ends as a finished turn', turn.stopReason === 'end_turn', turn.stopReason)
      see(
        'the editor renders the same status as the terminal',
        turn.said.trim() === fromCli.stdout.trim(),
        turn.said,
      )
    },
  },
}
