import { describe, expect, it, vi } from 'vitest'
import { ScheduleRuntime, type ScheduleRuntimeDeps } from '../../src/runtime/schedules/runtime'
import { RuntimeScheduleHost } from '../../src/runtime/schedules/host'
import { ScheduleSurface } from '../../src/runtime/schedules/surface'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { SCHEDULE_CLEANUP_EXIT_CODE, UI_TEXT } from '../../src/shared/constants'
import { FakeScheduleBackground } from './helpers/schedules/background'
import type { ScheduleWakeAuthorization } from '../../src/runtime/schedules/registration'
import { NativeScheduleBackground } from '../../src/runtime/schedules/nativeBackground'
import type { ScheduleControlPort } from '../../src/runtime/schedules/command'
import {
  fakeRuntimeScheduleControl,
  fakeScheduleDraft,
  transientBackgroundConsent,
  serializedBackgroundConsent,
} from './helpers/schedules/runtimeFixtures'

function setup(platform?: NodeJS.Platform, overrides: Partial<ScheduleRuntimeDeps> = {}) {
  const control = fakeRuntimeScheduleControl()
  const host = new RuntimeScheduleHost({ deliver: vi.fn() }),
    entry = new FakeScheduleBackground()
  const background = new ScheduleBackgroundCoordinator({
    entry,
    consent: transientBackgroundConsent(),
    now: () => 1000,
    nextWakeAtMs: () => Promise.resolve(undefined),
  })
  const reconcile = vi.spyOn(background, 'reconcile')
  const surface = new ScheduleSurface({
    background,
    request: (request) => control.request(request),
    askBackground: vi.fn(),
    notice: vi.fn(),
  })
  const unwatch = vi.fn<() => Promise<void>>().mockResolvedValue(),
    close = vi.fn<() => Promise<void>>().mockResolvedValue()
  const watchWorkspace = vi
    .fn<(cwd: string) => Promise<() => Promise<void>>>()
    .mockImplementation((cwd) => {
      expect(host.holds(workspaceKey(cwd))).toBe(true)
      return Promise.resolve(unwatch)
    })
  const controlFor = vi.fn().mockResolvedValue(control),
    dueWorkspaces = vi
      .fn<() => Promise<readonly string[]>>()
      .mockResolvedValue([workspaceKey('/one'), workspaceKey('/two')])
  const verifyWake = vi
    .fn<(id?: string) => Promise<ScheduleWakeAuthorization>>()
    .mockResolvedValue({ scheduledPrompts: false })
  const runtime = new ScheduleRuntime({
    controlFor,
    host,
    surface,
    background,
    watchWorkspace,
    dueWorkspaces,
    close,
    verifyWake,
    ...(platform !== undefined && { platform }),
    ...overrides,
  })
  return {
    runtime,
    control,
    controlFor,
    host,
    unwatch,
    watchWorkspace,
    close,
    entry,
    reconcile,
    background,
    verifyWake,
  }
}
describe('schedule runtime lifecycle', () => {
  it('breaks the macOS cycle when a wake publishes its marker during reconciliation next-fire lookup', async () => {
    vi.useFakeTimers()
    const lookup = Promise.withResolvers<number | undefined>(),
      entered = Promise.withResolvers<undefined>(),
      wakeExit = Promise.withResolvers<undefined>()
    let isWakeLive = false
    const waitForWake = vi.fn((_dataDir: string, shouldWait = true) => {
      if (!isWakeLive) return Promise.resolve()
      return shouldWait
        ? wakeExit.promise
        : Promise.reject(new Error(UI_TEXT.scheduleV2.runtime.backgroundRearmUnavailable))
    })
    const entry = new NativeScheduleBackground({
      platform: 'darwin',
      homeDir: '/home/rig',
      dataDir: '/data',
      executable: '/node',
      agentFile: '/acp.js',
      uid: 1000,
      effectiveUid: 1000,
      now: () => 1000,
      isWakeProcess: false,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files: {
        trustedPath: (file) => Promise.resolve(file),
        prepare: vi.fn(),
        hash: vi.fn(),
        waitForWake,
        read: vi.fn(),
        write: vi.fn(),
        remove: vi.fn(),
      },
      run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    })
    const background = new ScheduleBackgroundCoordinator({
      entry,
      consent: serializedBackgroundConsent().store,
      now: () => 1000,
      nextWakeAtMs: () => {
        entered.resolve(undefined)
        return lookup.promise
      },
    })
    const { runtime, controlFor, control } = setup('darwin', { background })
    let hasMutationSettled = false
    const mutation = (async () => {
      try {
        await background.decide({ choice: 'yes', decidedAtMs: 1000 })
      } catch {
        hasMutationSettled = true
      }
    })()
    await entered.promise
    isWakeLive = true
    const command = runtime.command({ operation: 'run-due', isJson: true }, '/launcher')
    lookup.resolve(61_000)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(hasMutationSettled).toBe(true)
      expect(waitForWake).toHaveBeenCalledWith('/data', false)
      expect(controlFor).toHaveBeenCalledOnce()
      expect(control.runDue).toHaveBeenCalledOnce()
      expect(await command).toMatchObject({ exitCode: 0 })
    } finally {
      isWakeLive = false
      wakeExit.resolve(undefined)
      await mutation
      await command
      await runtime.close()
      vi.useRealTimers()
    }
  })
  it('uses verified native authorization for each fire and ignores unverified run-due flags', async () => {
    for (const authorization of [
      { scheduledPrompts: false },
      { scheduledPrompts: true, maxBudgetUsd: 1 },
    ]) {
      const { runtime, controlFor, control, verifyWake } = setup()
      verifyWake.mockResolvedValue(authorization)
      expect(
        await runtime.command(
          {
            operation: 'run-due',
            isJson: true,
            registrationId: 'verified-record',
            scheduledPrompts: true,
            maxBudgetUsd: 100,
          },
          '/launcher',
        ),
      ).toMatchObject({ exitCode: 0 })
      expect(verifyWake).toHaveBeenCalledWith('verified-record')
      expect(controlFor).toHaveBeenCalledWith('/launcher', {
        source: 'cli',
        isInteractive: false,
        ...authorization,
      })
      expect(control.runDue).toHaveBeenCalledOnce()
    }
  })
  it('refuses a tampered native wake before acquiring controls or starting work', async () => {
    const { runtime, verifyWake, controlFor, control } = setup()
    verifyWake.mockRejectedValue(new Error('untrusted record'))
    expect(
      await runtime.command(
        { operation: 'run-due', isJson: true, registrationId: 'record' },
        '/launcher',
      ),
    ).toMatchObject({ exitCode: 1 })
    expect(controlFor).not.toHaveBeenCalled()
    expect(control.runDue).not.toHaveBeenCalled()
    await runtime.close()
  })
  it('reports a failed macOS wake barrier without acquiring controls or starting work', async () => {
    const { runtime, background, controlFor, verifyWake, control } = setup('darwin')
    vi.spyOn(background, 'wakeBarrier').mockRejectedValue(
      new Error(UI_TEXT.scheduleV2.runtime.wakeBarrierTimeout),
    )
    const result = await runtime.command({ operation: 'run-due', isJson: true }, '/launcher')
    expect(JSON.parse(result.output)).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.wakeBarrierTimeout,
    })
    expect(result.exitCode).toBe(1)
    expect(controlFor).not.toHaveBeenCalled()
    expect(verifyWake).not.toHaveBeenCalled()
    expect(control.runDue).not.toHaveBeenCalled()
    await runtime.close()
  })
  it('blocks macOS engine startup behind a mutator that already holds the shared consent lock', async () => {
    const { runtime, control, controlFor, background } = setup('darwin')
    const held = Promise.withResolvers<undefined>()
    const barrier = vi.spyOn(background, 'wakeBarrier').mockReturnValue(held.promise)
    const command = runtime.command({ operation: 'run-due', isJson: true }, '/launcher')
    await Promise.resolve()
    expect(barrier).toHaveBeenCalledOnce()
    expect(controlFor).not.toHaveBeenCalled()
    expect(control.runDue).not.toHaveBeenCalled()
    held.resolve(undefined)
    expect(await command).toMatchObject({ exitCode: 0 })
  })
  it('leaves macOS wake rearm to the independent after-exit helper after engine settlement', async () => {
    const { runtime, control, close, reconcile } = setup('darwin')
    expect(
      await runtime.command({ operation: 'run-due', isJson: true }, '/launcher'),
    ).toMatchObject({ exitCode: 0 })
    expect(control.runDue).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(reconcile).not.toHaveBeenCalled()
  })
  it.each(['cli', 'acp'] as const)(
    'requires both explicit paid conditions on %s and forwards caller context',
    async (source) => {
      const { runtime, control, controlFor } = setup()
      vi.mocked(control.request).mockResolvedValue({ kind: 'accepted', id: 'paid-1' })
      const value = fakeScheduleDraft()
      const draft = JSON.stringify({
        ...value,
        paidCapUsd: 1,
        grant: { ...value.grant, paidCapUsd: 1 },
      })
      for (const authorization of [
        {},
        { maxBudgetUsd: 1 },
        { scheduledPrompts: true },
        { scheduledPrompts: true, maxBudgetUsd: 0 },
        { scheduledPrompts: true, maxBudgetUsd: 0.5 },
      ]) {
        let result: string
        if (source === 'cli') {
          const command = await runtime.command(
            { operation: 'add', isJson: true, draft, ...authorization },
            '/one',
          )
          result = command.output
        } else {
          result = await runtime.run(`/schedule add ${draft}`, {
            cwd: '/one',
            sessionId: 'session-1',
            backend: 'modelApi',
            ...authorization,
          })
        }
        expect(result).toContain(UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired)
        expect(control.request).not.toHaveBeenCalled()
      }
      const authorization = { scheduledPrompts: true, maxBudgetUsd: 1 }
      if (source === 'cli')
        await runtime.command(
          { operation: 'add', isJson: true, draft, ...authorization },
          '/one',
          false,
        )
      else
        await runtime.run(`/schedule add ${draft}`, {
          cwd: '/one',
          sessionId: 'session-1',
          backend: 'modelApi',
          ...authorization,
        })
      const caller = {
        source,
        isInteractive: source === 'acp',
        ...authorization,
        ...(source === 'acp' && { cwd: '/one', sessionId: 'session-1', backend: 'modelApi' }),
      }
      expect(controlFor).toHaveBeenLastCalledWith('/one', caller)
      expect(control.request).toHaveBeenLastCalledWith(
        expect.objectContaining({ method: 'schedules/create' }),
        caller,
      )
      await runtime.close()
    },
  )
  it('hosts persisted due workspaces before firing, settles, closes resources and removes a spent wake', async () => {
    const { runtime, control, host, unwatch, close, reconcile } = setup()
    // Global run-due takes persisted keys; existing session watches close too.
    await runtime.holdWorkspace('/one')
    await runtime.holdWorkspace('/two')
    vi.mocked(control.runDue).mockImplementation(() => {
      expect(host.holds(workspaceKey('/one'))).toBe(true)
      expect(host.holds(workspaceKey('/two'))).toBe(true)
      return Promise.resolve()
    })
    expect(await runtime.command({ operation: 'run-due', isJson: true }, '/launcher')).toEqual({
      exitCode: 0,
      output: '{"kind":"accepted"}',
    })
    expect(control.runDue).toHaveBeenCalledOnce()
    expect(control.close).toHaveBeenCalledOnce()
    expect(unwatch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(reconcile).toHaveBeenCalledOnce()
    expect(host.holds(workspaceKey('/one'))).toBe(false)
    await runtime.close()
    expect(close).toHaveBeenCalledOnce()
    await expect(runtime.holdWorkspace('/one')).rejects.toThrow()
  })
  it('releases every due-workspace lease and engine even when a run fails', async () => {
    const { runtime, control, host, unwatch, close } = setup()
    // Global run-due takes persisted keys; existing session watches close too.
    await runtime.holdWorkspace('/one')
    await runtime.holdWorkspace('/two')
    vi.mocked(control.runDue).mockRejectedValue(new Error('Engine failed'))
    const result = await runtime.command({ operation: 'run-due', isJson: true }, '/launcher')
    expect(result.exitCode).toBe(1)
    expect(unwatch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(host.holds(workspaceKey('/one'))).toBe(false)
  })
  it('reports failed due-workspace teardown after attempting every release', async () => {
    const { runtime, unwatch, close } = setup()
    // Global run-due takes persisted keys; existing session watches close too.
    await runtime.holdWorkspace('/one')
    await runtime.holdWorkspace('/two')
    unwatch.mockRejectedValueOnce(new Error('Watcher failed'))
    expect(
      await runtime.command({ operation: 'run-due', isJson: true }, '/launcher'),
    ).toMatchObject({
      exitCode: SCHEDULE_CLEANUP_EXIT_CODE,
      output: '{"kind":"accepted"}',
      warning: UI_TEXT.scheduleV2.runtime.cleanupFailed,
    })
    expect(unwatch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })
  it('routes ACP locally through its scoped control and never runs global due work', async () => {
    const { runtime, control, close } = setup()
    await runtime.run('/schedule list', {
      cwd: '/one',
      sessionId: 'session-1',
      backend: 'museCode',
    })
    expect(control.request).toHaveBeenCalledWith(
      {
        method: 'schedules/list',
        workspaceKey: workspaceKey('/one'),
      },
      {
        cwd: '/one',
        sessionId: 'session-1',
        backend: 'museCode',
        source: 'acp',
        isInteractive: true,
        scheduledPrompts: false,
      },
    )
    expect(control.runDue).not.toHaveBeenCalled()
    expect(control.close).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    await runtime.close()
  })
  it('does not leak a lease on failed or late workspace startup', async () => {
    const { runtime, watchWorkspace, host, close, unwatch } = setup()
    watchWorkspace.mockRejectedValueOnce(new Error('Watcher failed'))
    await expect(runtime.holdWorkspace('/one')).rejects.toThrow('Watcher failed')
    expect(host.holds(workspaceKey('/one'))).toBe(false)
    const starting = Promise.withResolvers<() => Promise<void>>()
    watchWorkspace.mockReturnValue(starting.promise)
    const pending = runtime.holdWorkspace('/two')
    await runtime.close()
    starting.resolve(unwatch)
    await expect(pending).rejects.toThrow()
    expect(host.holds(workspaceKey('/two'))).toBe(false)
    expect(unwatch).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
  it('closes a late control and attempts all releases after one fails', async () => {
    const { runtime, controlFor, control, unwatch, close } = setup()
    await runtime.holdWorkspace('/one')
    await runtime.holdWorkspace('/two')
    unwatch.mockRejectedValueOnce(new Error('Watcher failed'))
    const pendingControl = Promise.withResolvers<ScheduleControlPort>()
    controlFor.mockReturnValue(pendingControl.promise)
    const command = runtime.command({ operation: 'list', isJson: true }, '/one')
    await expect(runtime.close()).rejects.toThrow()
    pendingControl.resolve(control)
    await expect(command).rejects.toThrow()
    expect(control.request).not.toHaveBeenCalled()
    expect(control.close).toHaveBeenCalledOnce()
    expect(unwatch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })
  it('releases a workspace lease idempotently across replacement and close', async () => {
    const { runtime, host, unwatch } = setup()
    const release = await runtime.holdWorkspace('/one')
    await release()
    await release()
    await runtime.close()
    expect(unwatch).toHaveBeenCalledOnce()
    expect(host.holds(workspaceKey('/one'))).toBe(false)
  })
})
