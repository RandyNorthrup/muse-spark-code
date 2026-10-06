import { describe, expect, it, vi } from 'vitest'
import { ScheduleRuntime } from '../../src/runtime/schedules/runtime'
import { RuntimeScheduleHost } from '../../src/runtime/schedules/host'
import { ScheduleSurface } from '../../src/runtime/schedules/surface'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { FakeScheduleBackground } from './helpers/schedules/background'
import type { ScheduleControlPort } from '../../src/runtime/schedules/command'
import {
  fakeRuntimeScheduleControl,
  transientBackgroundConsent,
} from './helpers/schedules/runtimeFixtures'

function setup() {
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
    dueWorkspaces = vi.fn<() => Promise<readonly string[]>>().mockResolvedValue(['/one', '/two'])
  const runtime = new ScheduleRuntime({
    controlFor,
    host,
    surface,
    background,
    watchWorkspace,
    dueWorkspaces,
    close,
  })
  return { runtime, control, controlFor, host, unwatch, watchWorkspace, close, entry, reconcile }
}
describe('schedule runtime lifecycle', () => {
  it('hosts persisted due workspaces before firing, settles, closes resources and removes a spent wake', async () => {
    const { runtime, control, host, unwatch, close, reconcile } = setup()
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
    vi.mocked(control.runDue).mockRejectedValue(new Error('Engine failed'))
    const result = await runtime.command({ operation: 'run-due', isJson: true }, '/launcher')
    expect(result.exitCode).toBe(1)
    expect(unwatch).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(host.holds(workspaceKey('/one'))).toBe(false)
  })
  it('reports failed due-workspace teardown after attempting every release', async () => {
    const { runtime, unwatch, close } = setup()
    unwatch.mockRejectedValueOnce(new Error('Watcher failed'))
    expect(
      await runtime.command({ operation: 'run-due', isJson: true }, '/launcher'),
    ).toMatchObject({
      exitCode: 1,
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
    expect(control.request).toHaveBeenCalledWith({
      method: 'schedules/list',
      workspaceKey: workspaceKey('/one'),
    })
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
