import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PlaybookRefusedError,
  runPlaybookWork,
} from '../../src/core/orchestration/playbookIntegration'
import { dispatchPlaybookSubagent } from '../../src/core/backends/modelapi/subagentTools'
import { collectPlaybookReport } from '../../src/core/orchestration/playbookReports'
import { renderPlaybookBrief } from '../../src/core/orchestration/playbookBrief'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../src/shared/constants'
import type { PlaybookPushRange } from '../../src/shared/playbook'
import { integrationFixture } from './helpers/playbookIntegration'

afterEach(() => {
  vi.useRealTimers()
})

describe('M116 planner integrations', () => {
  it('G8 serializes the owner and uses the policy lease for other module jobs', () => {
    const f = integrationFixture()
    const first = f.integration.start(f.work)
    expect(() => f.integration.start(f.work)).toThrow()
    expect(() => f.integration.start({ ...f.work, id: 'other-job' })).toThrow(PlaybookRefusedError)
    first.cancel()
    f.integration.start({ ...f.work, id: 'other-job' }).cancel()
  })
  it('G17 records shared Git configuration drift as an owner item and refuses completion', async () => {
    const f = integrationFixture()
    const snapshot = vi.fn().mockReturnValueOnce('before-digest').mockReturnValue('changed-digest')
    f.registry.snapshotRepositoryConfig = snapshot
    await expect(
      f.panel.dispatch('node', 's1', undefined, () => Promise.resolve('agent says done')),
    ).rejects.toThrow()
    expect(f.registry.recordRepositoryDrift).toHaveBeenCalledWith(
      'work-1',
      'before-digest',
      'changed-digest',
    )
    expect(f.finish).not.toHaveBeenCalled()
  })
  it('G3/G4 renders required brief sections structurally and records its base/hash before dispatch', async () => {
    const f = integrationFixture()
    const effect = vi.fn(() => {
      const expected = renderPlaybookBrief(f.work.brief)
      expect(f.registry.recordDispatch).toHaveBeenCalledWith('work-1', expected)
      expect(JSON.parse(expected.text)).toEqual(f.work.brief)
      return Promise.resolve()
    })
    await f.panel.dispatch('team', 's1', undefined, effect)
    expect(effect).toHaveBeenCalledOnce()
    expect(() => renderPlaybookBrief({ ...f.work.brief, acceptance: [] })).toThrow()
    f.registry.dispatch = () => ({ ...f.work, brief: { ...f.work.brief, objective: '' } })
    await expect(f.panel.dispatch('node', 's1', undefined, effect)).rejects.toThrow()
    expect(effect).toHaveBeenCalledOnce()
  })
  it('re-reads contracts and prerequisites at actual dispatch after a pick', () => {
    const f = integrationFixture()
    expect(f.integration.pick()?.id).toBe('0')
    const planned = { ...f.work, lane: { milestoneId: 'M116', id: 'I' } }
    expect(() => f.integration.start(planned)).toThrow(PlaybookRefusedError)
    expect(f.begin).not.toHaveBeenCalled()
    f.board.merge('0', false)
    expect(() => f.integration.start(planned)).toThrow(PlaybookRefusedError)
    f.board.merge('0', true)
    expect(() => f.integration.start(planned)).toThrow(PlaybookRefusedError)
    expect(f.events.note).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'prerequisiteMissing', missing: ['P'] }),
    )
    f.board.merge('P', true)
    const handle = f.integration.start(planned)
    expect(f.begin).toHaveBeenCalledWith(f.work.module, f.work.refs)
    handle.cancel()
  })

  it('M96c picks dependency then estimate and keeps original prerequisites', () => {
    const f = integrationFixture()
    f.board.merge('0', true)
    expect(f.integration.pick()).toMatchObject({ id: 'K', starts: ['0'] })
    f.board.merge('K', true)
    expect(f.integration.pick()?.id).toBe('U')
    f.board.merge('U', true)
    expect(f.integration.pick()?.id).toBe('P')
    f.board.merge('P', true)
    expect(f.integration.pick()?.id).toBe('I')
    f.board.merge('I', true)
    f.board.merge('W', true)
    expect(f.integration.pick()).toBeUndefined()
  })

  it.each(['subagent', 'delegate', 'bestOfN', 'team', 'node', 'watchdog'] as const)(
    'binds %s to the same shared policy and waits for outcome receipts',
    async (kind) => {
      const f = integrationFixture()
      const completion = Promise.withResolvers<undefined>()
      const waitForCompletion = vi.fn(() => completion.promise)
      f.registry.waitForCompletion = waitForCompletion
      const effect = vi.fn(() => Promise.resolve('submission'))
      const running = f.panel.dispatch(kind, 's1', 'child-1', effect)
      await vi.waitFor(() => {
        expect(waitForCompletion).toHaveBeenCalled()
      })
      expect(f.registry.dispatch).toHaveBeenCalledWith(kind, 's1', 'child-1')
      expect(f.finish).not.toHaveBeenCalled()
      completion.resolve(undefined)
      await expect(running).resolves.toBe('submission')
      expect(f.verify).toHaveBeenCalledWith('work-1')
      expect(f.finish).toHaveBeenCalledWith('work-1')
      expect(f.policy.beforeFixRound(f.work.module).kind).toBe('allow')
    },
  )

  it('refuses hook bypass and same-effect delegated retries before starting work', async () => {
    const f = integrationFixture()
    const effect = vi.fn(() => Promise.resolve())
    f.registry.dispatch = () => ({
      ...f.work,
      commands: [
        { kind: 'shell', command: 'git commit --no-verify', effect: 'commit', subject: 'repo' },
      ],
    })
    await expect(dispatchPlaybookSubagent(f.panel, 's1', undefined, effect)).rejects.toThrow(
      PlaybookRefusedError,
    )
    expect(effect).not.toHaveBeenCalled()
    expect(f.events.note.mock.calls.some(([note]) => note.code === 'hookTampering')).toBe(true)
    f.policy.recordRefusal(f.work.commands[0]!, f.work.requester, 'permission')
    f.registry.dispatch = () => ({
      ...f.work,
      requester: { agentId: 'delegate', teamId: 'another' },
    })
    await expect(f.panel.dispatch('delegate', 's1', 'child', effect)).rejects.toThrow(
      PlaybookRefusedError,
    )
    expect(effect).not.toHaveBeenCalled()
    expect(f.begin).not.toHaveBeenCalled()
  })

  it.each([
    { kind: 'shell', command: 'git commit --no-verify', effect: 'commit', subject: 'repo' },
    {
      kind: 'shell',
      command: 'git -c core.hooksPath=empty commit',
      effect: 'commit',
      subject: 'repo',
    },
    {
      kind: 'shell',
      command: 'git config core.hooksPath empty',
      effect: 'configure',
      subject: 'repo',
    },
    {
      kind: 'edit',
      paths: [String.raw`C:\workspace\.husky\pre-commit`],
      effect: 'write',
      subject: '.husky/pre-commit',
    },
    { kind: 'gate', gate: 'quality', skip: true, effect: 'gate', subject: 'quality' },
  ] as const)('rule nine refuses $subject through the dispatch binding', async (command) => {
    const f = integrationFixture()
    f.registry.dispatch = () => ({ ...f.work, commands: [command] })
    const effect = vi.fn(() => Promise.resolve())
    await expect(f.panel.dispatch('subagent', 's1', undefined, effect)).rejects.toThrow(
      PlaybookRefusedError,
    )
    expect(effect).not.toHaveBeenCalled()
    expect(f.begin).not.toHaveBeenCalled()
  })

  it('keeps a classifier block after the permission window expires', async () => {
    const f = integrationFixture()
    const effect = vi.fn(() => Promise.resolve())
    f.policy.recordRefusal(f.work.commands[0]!, f.work.requester, 'classifier')
    f.advance(PLAYBOOK_LAUNDER_WINDOW_MS + 1)
    await expect(f.panel.dispatch('delegate', 's1', 'child', effect)).rejects.toThrow(
      PlaybookRefusedError,
    )
    expect(effect).not.toHaveBeenCalled()
    expect(f.events.note.mock.calls.some(([note]) => note.code === 'classifierBlocked')).toBe(true)
  })

  it('hook failure blocks completion and reports scrubbed output', () => {
    const f = integrationFixture()
    const handle = f.integration.start(f.work)
    f.verify.mockReturnValue({
      decision: {
        kind: 'refuse',
        note: { rule: 'neverAround', code: 'hookVerificationFailed', needsUser: true, at: 100 },
      },
      output: 'hook failed [REDACTED]',
    })
    expect(() => {
      handle.complete()
    }).toThrow(PlaybookRefusedError)
    expect(f.finish).not.toHaveBeenCalled()
    expect(f.events.hookOutput).toHaveBeenCalledWith('hook failed [REDACTED]')
    handle.cancel()
  })

  it('push verifies and admits the exact detached OIDs before the effect', () => {
    const f = integrationFixture()
    const handle = f.integration.start(f.work)
    const range: PlaybookPushRange = {
      remote: 'origin',
      url: 'https://example.invalid/repo',
      updates: [
        {
          localRef: 'refs/heads/lane',
          localOid: 'a'.repeat(40),
          remoteRef: 'refs/heads/main',
          remoteOid: 'b'.repeat(40),
        },
      ],
    }
    const effect = vi.fn((exact: PlaybookPushRange) => {
      expect(f.verify).toHaveBeenCalledWith('work-1', exact)
      expect(f.push).toHaveBeenCalledWith('work-1', exact)
      expect(exact).not.toBe(range)
    })
    handle.push(range, effect)
    expect(effect).toHaveBeenCalledOnce()
    f.push.mockReturnValue({
      kind: 'refuse',
      note: { rule: 'neverAround', code: 'unverifiedCommit', needsUser: true, at: 100 },
    })
    expect(() => {
      handle.push(range, effect)
    }).toThrow(PlaybookRefusedError)
    expect(effect).toHaveBeenCalledOnce()
    handle.cancel()
  })

  it('renews during work and cancellation makes the old handle unusable', async () => {
    vi.useFakeTimers()
    const f = integrationFixture()
    const renew = vi.spyOn(f.policy, 'renewPatch')
    const handle = f.integration.start(f.work)
    const completion = Promise.withResolvers<undefined>()
    const running = runPlaybookWork(handle, () => completion.promise)
    f.advance(PLAYBOOK_LAUNDER_WINDOW_MS / 2)
    await vi.advanceTimersByTimeAsync(PLAYBOOK_LAUNDER_WINDOW_MS / 2)
    expect(renew).toHaveBeenCalled()
    completion.resolve(undefined)
    await running
    expect(() => {
      handle.renew()
    }).toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('offloads checks only to the governor-admitted target', async () => {
    const f = integrationFixture()
    const run = vi.fn(() => Promise.resolve('receipt'))
    await f.integration.check({ id: 'tests', heavy: true, fullGate: false }, run)
    expect(run).toHaveBeenLastCalledWith({ kind: 'worker', id: 'macmini' })
    await f.integration.check({ id: 'quality', heavy: true, fullGate: true }, run)
    expect(run).toHaveBeenLastCalledWith({ kind: 'ci' })
    f.options.checkAdmission.admit.mockReturnValue(false)
    await expect(
      f.integration.check({ id: 'tests', heavy: true, fullGate: false }, run),
    ).rejects.toThrow(PlaybookRefusedError)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not merge without integration-trunk and drill receipts', () => {
    const f = integrationFixture()
    const merge = vi.fn()
    expect(() => {
      f.integration.merge({ milestoneId: 'M116', id: 'I' }, merge)
    }).toThrow(PlaybookRefusedError)
    expect(merge).not.toHaveBeenCalled()
    expect(f.events.note).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'drillMissing' }),
    )
  })

  it.each(['playbook', 'milestone', 'fleet'] as const)(
    'M113 %s puts owner/residual and failure rows first',
    (kind) => {
      const f = integrationFixture()
      const report = collectPlaybookReport(
        f.policy,
        kind,
        [
          { id: 'done', needsUser: false, failing: false, payload: 'progress' },
          { id: 'failure', needsUser: false, failing: true, payload: 'failed test' },
          {
            id: 'residual',
            needsUser: true,
            failing: true,
            payload: { name: 'native-binding', followUp: 'I/W' },
          },
        ],
        f.events.note,
      )
      expect(report.kind).toBe(kind)
      expect(report.rows.map((row) => row.id)).toEqual(['residual', 'failure', 'done'])
      expect(report.rows[0]?.payload).toEqual({ name: 'native-binding', followUp: 'I/W' })
      expect(report.record).toEqual(f.policy.getRecord())
    },
  )
})
