import { Usd as PortUsd } from '../../src/shared/usd'
import { describe, expect, it, vi } from 'vitest'
import { parseScheduleCommand } from '../../src/runtime/schedules/args'
import { runScheduleCommand } from '../../src/runtime/schedules/command'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { UI_TEXT } from '../../src/shared/constants'
import { workspaceKey } from '../../src/runtime/dataFolder'
import type { ScheduleReportAction } from '../../src/shared/scheduleV2'
import { fakeRuntimeScheduleControl, fakeScheduleDraft } from './helpers/schedules/runtimeFixtures'

const draft = JSON.stringify(fakeScheduleDraft())
const action: ScheduleReportAction = {
  kind: 'report',
  reportKind: 'project',
  args: { full: true },
  format: 'markdown',
  destinations: [
    {
      id: 'saved',
      kind: 'save',
      rootId: 'approved-root',
      directory: '.',
      nameTemplate: '{kind}-{date}.{ext}',
      retention: 30,
    },
    { id: 'self', kind: 'email', recipientId: 'verified-self', connectionId: 'vault-mail' },
  ],
}
const argv = [
  'add',
  '--draft',
  draft,
  '--report',
  'project',
  '--to',
  String.raw`save:C:\reports`,
  '--to',
  'email:self@example.test',
  '--format',
  'md',
  '--json',
  '--',
  '--full',
]
describe('schedule report CLI flags', () => {
  it('parses repeatable destinations and forwards report arguments through the existing CLI boundary', async () => {
    const parsed = parseCommandLine(['schedule', ...argv])
    expect(parsed.command).toBe('schedule')
    if (parsed.command !== 'schedule') throw new Error('parse failed')
    expect(parsed.options).toMatchObject({
      reportKind: 'project',
      reportArgs: ['--full'],
      reportTo: [String.raw`save:C:\reports`, 'email:self@example.test'],
      reportFormat: 'md',
    })
    const control = fakeRuntimeScheduleControl({ kind: 'accepted', id: 'report-1' })
    const resolve = vi.fn().mockResolvedValue({ action, destinationIds: ['saved', 'self'] })
    const result = await runScheduleCommand(parsed.options, '/workspace', control, { resolve })
    expect(result).toEqual({ exitCode: 0, output: '{"kind":"accepted","id":"report-1"}' })
    expect(resolve).toHaveBeenCalledWith(
      'project',
      ['--full'],
      'markdown',
      [String.raw`save:C:\reports`, 'email:self@example.test'],
      '/workspace',
    )
    expect(control.request).toHaveBeenCalledWith({
      method: 'schedules/create',
      workspaceKey: workspaceKey('/workspace'),
      draft: {
        ...fakeScheduleDraft(),
        action,
        grant: {
          rules: [],
          destinationIds: ['saved', 'self'],
          paidCapUsd: PortUsd.from(0).toAmount(),
        },
        paidCapUsd: PortUsd.from(0).toAmount(),
      },
    })
    expect(JSON.stringify(control.request.mock.calls)).not.toContain('self@example')
    expect(control.close).toHaveBeenCalledOnce()
  })
  it('refuses an unbound report resolver explicitly without storing a prompt', async () => {
    const parsed = parseScheduleCommand(argv)
    if (!parsed.ok) throw new Error('parse failed')
    const control = fakeRuntimeScheduleControl()
    expect(await runScheduleCommand(parsed.options, '/workspace', control)).toEqual({
      exitCode: 1,
      output: JSON.stringify({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.reportAction.unavailable,
      }),
    })
    expect(control.request).not.toHaveBeenCalled()
    expect(control.close).toHaveBeenCalledOnce()
  })
  it('requires successful destination consent and a matching report kind before creating', async () => {
    const parsed = parseScheduleCommand(argv)
    if (!parsed.ok) throw new Error('parse failed')
    const control = fakeRuntimeScheduleControl()
    const resolve = vi.fn()
    for (const value of [
      { action, destinationIds: ['saved'] },
      { action: { ...action, reportKind: 'other' }, destinationIds: ['saved', 'self'] },
      { action: { ...action, format: 'html' }, destinationIds: ['saved', 'self'] },
      { action: { ...action, destinations: [] }, destinationIds: [] },
      { action: { ...action, credential: 'private' }, destinationIds: ['saved', 'self'] },
    ]) {
      resolve.mockResolvedValue(value)
      expect(
        await runScheduleCommand(parsed.options, '/workspace', control, { resolve }),
      ).toMatchObject({ exitCode: 1 })
      expect(control.request).not.toHaveBeenCalled()
    }
    resolve.mockRejectedValue(new Error('private SMTP login'))
    expect(await runScheduleCommand(parsed.options, '/workspace', control, { resolve })).toEqual({
      exitCode: 1,
      output: JSON.stringify({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.invalidRequest,
      }),
    })
  })
  it('clears prompt paid caps for a deterministic report and keeps its trigger, target and delivery', async () => {
    const paidDraft = {
      ...fakeScheduleDraft(),
      grant: { rules: [], destinationIds: [], paidCapUsd: PortUsd.from(1).toAmount() },
      paidCapUsd: PortUsd.from(1).toAmount(),
    }
    const parsed = parseScheduleCommand([
      'add',
      '--draft',
      JSON.stringify(paidDraft),
      '--report',
      'project',
      '--to',
      'browser',
    ])
    if (!parsed.ok) throw new Error('parse failed')
    const control = fakeRuntimeScheduleControl({ kind: 'accepted' })
    const resolve = vi.fn().mockResolvedValue({ action, destinationIds: ['saved', 'self'] })
    await runScheduleCommand(parsed.options, '/workspace', control, { resolve })
    expect(control.request.mock.calls[0]?.[0]).toMatchObject({
      draft: {
        action,
        paidCapUsd: PortUsd.from(0).toAmount(),
        grant: { paidCapUsd: PortUsd.from(0).toAmount() },
        trigger: paidDraft.trigger,
        target: paidDraft.target,
        delivery: paidDraft.delivery,
      },
    })
  })
  it('rejects missing, misplaced, invalid and credential-like destination flags without echoing them', () => {
    for (const input of [
      ['add', '--draft', draft, '--report', 'project'],
      ['add', '--draft', draft, '--report', '', '--to', 'browser'],
      ['list', '--report', 'project', '--to', 'browser'],
      ['add', '--draft', draft, '--to', 'browser'],
      ['add', '--draft', draft, '--format', 'md'],
      ['add', '--draft', draft, '--report', 'project', '--to', 'save:'],
      ['add', '--draft', draft, '--report', 'project', '--to', 'https://private'],
      ['add', '--draft', draft, '--report', 'project', '--to', 'email:\nprivate'],
      ['add', '--draft', draft, '--report', 'project', '--to', 'browser', '--format', 'pdf'],
      ['add', '--report', 'project', '--to', 'browser'],
    ])
      expect(parseScheduleCommand(input)).toEqual({
        ok: false,
        reason: UI_TEXT.scheduleV2.runtime.usage,
      })
    expect(
      parseScheduleCommand([
        'add',
        '--draft',
        draft,
        '--report',
        'milestone',
        '--to',
        'browser',
        '115',
      ]),
    ).toMatchObject({ ok: true, options: { reportArgs: ['115'] } })
    expect(parseCommandLine(['exec', '--report', 'project'])).toMatchObject({ command: 'invalid' })
  })
})
