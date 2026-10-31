// M96b exec --team flags (C-M96b-0, PLAN.md D75): grammar, validation and the
// headless engine admission after all ordinary argument checks.
import { describe, expect, it } from 'vitest'
import { parseExec } from '../../src/runtime/exec/execArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const BUDGET = { backend: 'modelApi', 'max-budget-usd': '1' }

// D227: no availability switch stands before --team. The parser admits the
// flag on its own checks; the two-model rule at run start refuses a team
// run without a second runnable model (teamAvailability.test.ts).

describe('M96b exec --team flags', () => {
  it('parses without --team exactly as before', () => {
    const parsed = parseExec(BUDGET, ['task'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.options.team).toBe(false)
  })
  it('refuses --team off the Model API backend', () => {
    // The refusal names the option as typed; the unfilled template reached
    // people through the packed agent (RLF-M96CERT, 2026-10-30).
    const reason = fill(UI_TEXT.execModelApiOnly, { options: '--team' })
    expect(parseExec({ team: true }, ['task'])).toEqual({ ok: false, reason })
    expect(
      parseExec({ team: true, backend: 'museCode', 'permission-mode': 'acceptEdits' }, ['task']),
    ).toEqual({ ok: false, reason })
  })
  it('refuses --team without acceptEdits', () => {
    expect(parseExec({ ...BUDGET, team: true }, ['task'])).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNeedsEdits,
    })
  })
  it('admits a valid bounded --team request', () => {
    expect(
      parseExec({ ...BUDGET, team: true, 'permission-mode': 'acceptEdits' }, ['task']),
    ).toMatchObject({ ok: true, options: { team: true, mode: 'acceptEdits' } })
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
  it('documents the shared hard budget and headless merge policy', () => {
    expect(UI_TEXT.referenceCliOptions.team).toContain('hard budget')
    expect(UI_TEXT.referenceCliOptions.team).toContain('acceptEdits')
    expect(UI_TEXT.referenceCliOptions.team).toContain('prompts deny')
  })
  it('admits --team through the real command line', () => {
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
    ).toMatchObject({ command: 'exec', options: { team: true, mode: 'acceptEdits' } })
  })
})

it('requires the hard run budget before admitting a headless team', () => {
  expect(
    parseExec({ backend: 'modelApi', team: true, 'permission-mode': 'acceptEdits' }, ['task']),
  ).toEqual({
    ok: false,
    reason: UI_TEXT.execBudgetRequired,
  })
})
