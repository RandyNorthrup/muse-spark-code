// M96b exec --team flags (C-M96b-0, PLAN.md D75): grammar, validation and the
// loud refusal until the runner lane (C-M96b-2) admits team runs.
import { describe, expect, it } from 'vitest'
import { parseExec } from '../../src/runtime/exec/execArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const BUDGET = { backend: 'modelApi', 'max-budget-usd': '1' }

describe('M96b exec --team flags', () => {
  it('parses without --team exactly as before', () => {
    const parsed = parseExec(BUDGET, ['task'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.team).toBe(false)
  })
  it('refuses --team off the Model API backend', () => {
    expect(parseExec({ team: true }, ['task'])).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    expect(
      parseExec({ team: true, backend: 'museCode', 'permission-mode': 'acceptEdits' }, ['task']),
    ).toEqual({ ok: false, reason: UI_TEXT.execModelApiOnly })
  })
  it('refuses --team without acceptEdits', () => {
    expect(parseExec({ ...BUDGET, team: true }, ['task'])).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNeedsEdits,
    })
  })
  it('refuses a valid --team request out loud until the runner lane lands', () => {
    expect(
      parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits' }, ['task']),
    ).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNotReady,
    })
  })
  it('rejects a non-boolean --team', () => {
    expect(parseExec({ ...BUDGET, team: 'true' }, ['task']).ok).toBe(false)
  })
  // RVCM96B0 finding 6: the team refusal runs after every other request
  // check, so an invalid team request reports its own defect instead of
  // hiding behind the not-ready refusal.
  it('reports unconditional defects before the team refusal', () => {
    expect(parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits' }, [])).toEqual({
      ok: false,
      reason: UI_TEXT.execPromptMissing,
    })
    expect(
      parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits', 'prompt-file': 'f' }, [
        'task',
      ]),
    ).toEqual({ ok: false, reason: UI_TEXT.execPromptTwice })
    expect(
      parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits', provider: 'nope!' }, [
        'task',
      ]),
    ).toEqual({ ok: false, reason: fill(UI_TEXT.providerUnknown, { provider: 'nope!' }) })
    expect(
      parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits', 'key-stdin': true }, [
        '-',
      ]),
    ).toEqual({ ok: false, reason: UI_TEXT.execStdinTwice })
  })
  // RVCM96B0 finding 5: public Help must not advertise the refused flag as
  // a working team-run option.
  it('tells help readers --team is refused until the runner lane lands', () => {
    expect(UI_TEXT.referenceCliOptions.team).toContain('refused')
    expect(UI_TEXT.referenceCliOptions.team).toContain('exits 2')
  })
  it('ends --team at the command line with exit 2, never a run', () => {
    expect(
      parseCommandLine([
        'exec',
        '--team',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--permission-mode',
        'acceptEdits',
        'task',
      ]),
    ).toEqual({ command: 'invalid', reason: UI_TEXT.execTeamNotReady, exitCode: 2 })
  })
})
