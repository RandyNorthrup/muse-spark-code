import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { parseScheduleCommand } from '../../src/runtime/schedules/args'
import { runScheduleCommand, scheduleResultText } from '../../src/runtime/schedules/command'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { scheduleViewV2Of } from '../../src/shared/scheduleV2'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { fakeRuntimeScheduleControl, fakeScheduleDraft } from './helpers/schedules/runtimeFixtures'

const CWD = '/workspace/schedules'
function control() {
  return fakeRuntimeScheduleControl({ kind: 'accepted', id: 'schedule-1' })
}
describe('schedule terminal commands', () => {
  it.each(['remove', 'run-now', 'pause', 'resume', 'fire'])(
    'routes %s with a validated id and workspace',
    async (operation) => {
      const parsed = parseScheduleCommand([operation, 'schedule-1', '--json'])
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error('parse failed')
      const c = control()
      expect(await runScheduleCommand(parsed.options, CWD, c)).toEqual({
        exitCode: 0,
        output: '{"kind":"accepted","id":"schedule-1"}',
      })
      expect(c.request).toHaveBeenCalledWith({
        method: `schedules/${operation === 'run-now' ? 'runNow' : operation}`,
        workspaceKey: workspaceKey(CWD),
        id: 'schedule-1',
      })
      expect(c.close).toHaveBeenCalledOnce()
    },
  )
  it('validates a draft without accepting host-owned authority', async () => {
    const c = control()
    const value = fakeScheduleDraft()
    await runScheduleCommand(
      { operation: 'add', isJson: true, draft: JSON.stringify(value) },
      CWD,
      c,
    )
    expect(c.request).toHaveBeenCalledWith({
      method: 'schedules/create',
      workspaceKey: workspaceKey(CWD),
      draft: value,
    })
    for (const invalid of [
      '{broken',
      JSON.stringify({ ...value, paidConsent: {} }),
      JSON.stringify({ ...value, mode: 'bypass' }),
      JSON.stringify({ ...value, creator: { kind: 'user' } }),
    ]) {
      c.request.mockClear()
      const result = await runScheduleCommand(
        { operation: 'add', isJson: true, draft: invalid },
        CWD,
        c,
      )
      expect(result.exitCode).toBe(1)
      expect(JSON.parse(result.output)).toEqual({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.invalidRequest,
      })
      expect(c.request).not.toHaveBeenCalled()
    }
  })
  it('settles run-due once and closes after both success and failure', async () => {
    const c = control()
    expect(await runScheduleCommand({ operation: 'run-due', isJson: true }, CWD, c)).toEqual({
      exitCode: 0,
      output: '{"kind":"accepted"}',
    })
    expect(c.runDue).toHaveBeenCalledOnce()
    expect(c.request).not.toHaveBeenCalled()
    c.runDue.mockRejectedValue(new Error('private path'))
    const result = await runScheduleCommand({ operation: 'run-due', isJson: true }, CWD, c)
    expect(result).toEqual({
      exitCode: 1,
      output: JSON.stringify({ kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.unavailable }),
    })
    expect(c.close).toHaveBeenCalledTimes(2)
  })
  it('rejects invalid responses and preserves refusal exit status', async () => {
    const c = control()
    c.request.mockResolvedValue({ kind: 'accepted', extra: 'unparsed' })
    expect(await runScheduleCommand({ operation: 'list', isJson: true }, CWD, c)).toEqual({
      exitCode: 1,
      output: JSON.stringify({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.invalidResponse,
      }),
    })
    c.request.mockResolvedValue({ kind: 'refused', reason: 'No authority' })
    expect(await runScheduleCommand({ operation: 'list', isJson: true }, CWD, c)).toEqual({
      exitCode: 1,
      output: '{"kind":"refused","reason":"No authority"}',
    })
  })
  it('parses list, timeline and background controls, and refuses ambiguous options', async () => {
    const c = control()
    for (const argv of [
      ['list'],
      ['timeline', '--hours', '168'],
      ['timeline', '--hours', '24'],
      ['timeline'],
      ['background', 'off'],
      ['background', 'status'],
    ]) {
      const parsed = parseCommandLine(['schedule', ...argv])
      expect(parsed.command).toBe('schedule')
      if (parsed.command !== 'schedule') throw new Error('parse failed')
      await runScheduleCommand(parsed.options, CWD, c)
    }
    expect(c.request.mock.calls.map(([request]) => request.method)).toEqual([
      'schedules/list',
      'schedules/timeline',
      'schedules/timeline',
      'schedules/timeline',
      'schedules/backgroundRemove',
      'schedules/backgroundStatus',
    ])
    expect(
      c.request.mock.calls.flatMap(([r]) => (r.method === 'schedules/timeline' ? [r.hours] : [])),
    ).toEqual([168, 24, 24])
    for (const argv of [
      [],
      ['add'],
      ['list', 'id'],
      ['remove'],
      ['timeline', '--hours', '25'],
      ['timeline', '--hours', '024'],
      ['timeline', '--hours', '24.0'],
      ['background', 'on'],
      ['list', '--draft', '{}'],
      ['run-due', '--cwd', '/tmp'],
      ['background', 'off', '--cwd', '/tmp'],
      ['list', '--unknown', 'private'],
      ['list', '--unknown'],
      ['list', '--cwd', ''],
      ['remove', 'id', 'extra'],
      ['add', 'id', '--draft', '{}'],
      ['add', '--draft', ''],
      ['add', '--draft', '{}', '--hours', '24'],
      ['timeline', 'id'],
      ['list', '--hours', '24'],
    ])
      expect(parseScheduleCommand(argv)).toEqual({
        ok: false,
        reason: UI_TEXT.scheduleV2.runtime.usage,
      })
    expect(parseCommandLine(['exec', '--schedule', 'list'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
  })
  it('prints the shared projections in human-readable form', () => {
    expect(
      scheduleResultText({ kind: 'list', schedules: [scheduleViewV2Of(fakeSchedule())] }),
    ).toContain('Check the build (schedule-1)')
    expect(scheduleResultText({ kind: 'list', schedules: [] })).toBe(
      UI_TEXT.scheduleV2.runtime.empty,
    )
    expect(scheduleResultText({ kind: 'timeline', entries: [] })).toBe(
      UI_TEXT.scheduleV2.runtime.empty,
    )
  })
})
