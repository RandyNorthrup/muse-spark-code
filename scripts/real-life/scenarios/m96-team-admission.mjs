// M96b: a headless team starts only with edits allowed and two models.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/teamConstants.test.ts, the team caps, roles and tool-set rows
//   (admission needs edits allowed, a hard budget, and a second runnable
//   model: D227's two-model rule)
// - test/unit/teamSchedulerPick.test.ts, the reserved-child-slot rows
//   (a child behind its parent refuses at once)
//
// Both refusals land before anything is sent: the run's own request check
// fails this cell if one model request was made. The full team run (two
// models ticked, work delegated, merged and landed) is a lead-only run:
// the index names its steps.
//
// Expected model attempts: 0. Dollar cap: $0.00.
import { EXEC_ADMIT_USD } from '../lib/limits.mjs'
import { routeArguments } from '../lib/routes.mjs'

export default {
  title: 'exec --team refuses without edits allowed and without a second model',
  // Meta's key rides on standard input, which only person.exec carries; a
  // raw command cannot reach the run-start check there. Admission is the
  // same on every route, so providers prove it.
  only: (route) => route.kind === 'provider' && route.note === undefined,
  exec: {
    claims: ['ref/cli/exec/exec---team', 'ref/feature/teams'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const base = [
        'exec',
        ...routeArguments(person.route),
        '--max-requests',
        '1',
        '--max-budget-usd',
        EXEC_ADMIT_USD,
        '--output',
        'jsonl',
        '--team',
      ]
      const planMode = await person.command([
        ...base,
        '--permission-mode',
        'plan',
        'Write one file.',
      ])
      see(
        'a team in Plan mode is refused with exit code 2',
        planMode.code === 2,
        `exit ${String(planMode.code)}`,
      )
      see(
        'the refusal names the mode it needs',
        planMode.stderr.includes('--team needs --permission-mode acceptEdits.'),
        planMode.stderr.trim(),
      )
      const oneModel = await person.command([
        ...base,
        '--permission-mode',
        'acceptEdits',
        'Write one file.',
      ])
      see(
        'a team with one model ticked is refused before it starts',
        oneModel.code !== 0,
        `exit ${String(oneModel.code)}`,
      )
      see(
        'that refusal says why too',
        `${oneModel.stdout} ${oneModel.stderr}`.trim() !== '',
        `${oneModel.stdout} ${oneModel.stderr}`.trim(),
      )
    },
  },
}
