// M102: every usage view reads the same home this run spent in.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/usageText.test.ts, the command rows (`renders daily, model and
//   limit commands as their requested sections`; unknown usage is never a
//   zero; the combined charge once after exact accumulation)
// - test/unit/usageTable.test.ts, the English rows (English without a file;
//   the installed display language: the run pins English, so English proves it)
// - test/unit/sampler.test.ts and test/unit/samplerProbes.test.ts, the whole
//   files (the machine sampler runs in composition behind the resources
//   readout; fault-injection rows stay lead-only: the index names them)
//
// One turn spends first; then each view must open. History at scale (thirty
// days times two thousand calls) is a lead-only run: the index names it.
//
// Expected model attempts: 1. Dollar cap: $0.05.
export default {
  title: 'usage and resource readouts open',
  exec: {
    claims: [
      'ref/cli/usage/summary',
      'ref/cli/usage/daily',
      'ref/cli/usage/models',
      'ref/cli/usage/limits',
      'ref/cli/resources/status',
    ],
    requests: 1,
    maxUsd: '0.05',
    async run(person, see) {
      const turn = await person.exec(person.connectionCheck(person.marker()))
      see('the turn completed', turn.code === 0, `exit ${String(turn.code)}`)
      for (const view of ['summary', 'daily', 'models', 'limits']) {
        const shown = await person.command(['usage', view])
        see(
          `usage ${view} ends with exit code 0`,
          shown.code === 0,
          `exit ${String(shown.code)}: ${`${shown.stdout} ${shown.stderr}`.trim()}`,
        )
        see(`usage ${view} prints text`, shown.stdout.trim() !== '', shown.stdout.trim())
      }
      const models = await person.command(['usage', 'models', '--json'])
      let parsed
      try {
        parsed = JSON.parse(models.stdout)
      } catch {
        parsed = undefined
      }
      see(
        'usage models --json prints JSON',
        models.code === 0 && parsed !== undefined,
        `exit ${String(models.code)}`,
      )
      const status = await person.command(['resources', 'status'])
      see(
        'resources status ends with exit code 0',
        status.code === 0,
        `exit ${String(status.code)}: ${`${status.stdout} ${status.stderr}`.trim()}`,
      )
      see('resources status prints text', status.stdout.trim() !== '', status.stdout.trim())
      const history = await person.command(['resources', 'history', '--json'])
      let past
      try {
        past = JSON.parse(history.stdout)
      } catch {
        past = undefined
      }
      see(
        'resources history --json prints JSON',
        history.code === 0 && past !== undefined,
        `exit ${String(history.code)}`,
      )
    },
  },
}
