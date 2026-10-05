import { describe, expect, it, vi } from 'vitest'
import { readRunnerConfig, runnerEnvironment } from '../../src/core/runners/runnerConfig'
import { RunnerHealthStore } from '../../src/core/runners/health'
import { routeChecks, type CheckJob, type CheckRoutingDeps } from '../../src/core/runners/routing'
import type { Runner } from '../../src/shared/team'
import { HOOK_CONFIG_MAX_BYTES, RUNNER_HEALTH_MS } from '../../src/shared/constants'

const runner: Runner = {
  id: 'mac',
  destination: 'mac-rig',
  os: 'darwin',
  workFolder: '/tmp/checks',
  maxJobs: 2,
  labels: ['gpu'],
  commandClasses: ['tests'],
  setupCommand: 'npm ci',
  cacheKey: 'npm',
  environmentNames: [],
}
const job: CheckJob = {
  runId: 'run-1',
  cwd: '/copy',
  command: 'npm test',
  timeoutMs: 1000,
  commandClass: 'tests',
  labels: [],
  preferredRunners: [],
  lockfiles: ['package-lock.json'],
  signal: new AbortController().signal,
  onOutput: vi.fn(),
}
const health = { cores: 4, load: 1, freeSlots: 1, inputReady: true }
function deps(): CheckRoutingDeps {
  return {
    isTrusted: () => true,
    localLabels: ['os:macos'],
    sample: vi.fn(() => Promise.resolve(health)),
    remote: vi.fn(() =>
      Promise.resolve({
        kind: 'finished',
        result: { runId: job.runId, exitCode: 0, output: 'ok', location: 'remote' },
      }),
    ),
    local: vi.fn(() =>
      Promise.resolve({ runId: job.runId, exitCode: 0, output: 'ok', location: 'local' }),
    ),
  }
}
describe('user-level runner config', () => {
  it('reads only the config-home file and refuses unknown authority and oversized data', async () => {
    const read = vi.fn(() => Promise.resolve(JSON.stringify([runner])))
    expect(await readRunnerConfig('/personal', read)).toEqual([runner])
    expect(read).toHaveBeenCalledWith(
      '/personal/muse-spark-code/runners.json',
      HOOK_CONFIG_MAX_BYTES,
    )
    expect(await readRunnerConfig('/personal', () => Promise.resolve(undefined))).toEqual([])
    await expect(
      readRunnerConfig('/personal', () =>
        Promise.resolve(JSON.stringify([{ ...runner, command: 'evil' }])),
      ),
    ).rejects.toThrow()
    await expect(
      readRunnerConfig('/personal', () =>
        Promise.resolve('[]' + ' '.repeat(HOOK_CONFIG_MAX_BYTES)),
      ),
    ).rejects.toThrow()
  })
  it('drops credential names case-insensitively even when allowlisted, and keeps the SSH agent only for transport', () => {
    const env = {
      PATH: '/bin',
      BUILD_MODE: 'fast',
      VENDOR_API_KEY: 'fixture-only',
      Gh_ToKeN: 'fixture-only',
      SSH_AUTH_SOCK: '/fixture-agent',
      GIT_DIR: '/evil',
      SSH_ASKPASS: '/evil',
    }
    expect(runnerEnvironment(env)).toEqual({ PATH: '/bin', BUILD_MODE: 'fast' })
    expect(runnerEnvironment(env, Object.keys(env))).toEqual({ PATH: '/bin', BUILD_MODE: 'fast' })
    expect(runnerEnvironment(env, ['BUILD_MODE'])).toEqual({ BUILD_MODE: 'fast' })
    expect(runnerEnvironment(env, undefined, true)).toEqual({
      PATH: '/bin',
      BUILD_MODE: 'fast',
      SSH_AUTH_SOCK: '/fixture-agent',
    })
  })
  it('expires health, refuses malformed measurements, and treats a clock rewind as unknown', () => {
    let now = 0
    const store = new RunnerHealthStore(() => now)
    expect(store.record('mac', health)).toEqual(health)
    expect(store.get('mac')).toEqual(health)
    now = RUNNER_HEALTH_MS
    expect(store.get('mac')).toBeUndefined()
    now = -1
    expect(store.get('mac')).toBeUndefined()
    expect(store.record('bad', { ...health, load: -1 })).toBeUndefined()
    expect(store.record('bad', { ...health, cores: 0 })).toBeUndefined()
    expect(store.record('bad', { ...health, freeSlots: 65 })).toBeUndefined()
    expect(store.record('bad', { ...health, extra: true })).toBeUndefined()
  })
})
describe('check routing after shell guards', () => {
  it('runs every shell guard before any probe or dispatch', async () => {
    const d = deps()
    await expect(
      routeChecks(job, [runner], d, () => Promise.reject(new Error('guard denied'))),
    ).rejects.toThrow('guard denied')
    expect(d.sample).not.toHaveBeenCalled()
    expect(d.remote).not.toHaveBeenCalled()
    expect(d.local).not.toHaveBeenCalled()
  })
  it('refuses untrusted work and trust lost while sampling', async () => {
    const d = deps()
    await expect(
      routeChecks(job, [runner], { ...d, isTrusted: () => false }, () => Promise.resolve()),
    ).rejects.toThrow()
    expect(d.sample).not.toHaveBeenCalled()
    let isTrusted = true
    await expect(
      routeChecks(
        job,
        [runner],
        {
          ...d,
          isTrusted: () => isTrusted,
          sample: () => {
            isTrusted = false
            return Promise.resolve(health)
          },
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    expect(d.remote).not.toHaveBeenCalled()
  })
  it('matches Windows-only labels and command classes instead of routing to a Mac', async () => {
    const d = deps()
    const windows: Runner = { ...runner, id: 'win', os: 'win32' }
    await routeChecks({ ...job, labels: ['os:windows'] }, [runner, windows], d, () =>
      Promise.resolve(),
    )
    expect(d.sample).toHaveBeenCalledExactlyOnceWith(windows)
    const build = deps()
    expect(
      await routeChecks({ ...job, commandClass: 'builds' }, [runner], build, () =>
        Promise.resolve(),
      ),
    ).toMatchObject({ location: 'local' })
    expect(build.sample).not.toHaveBeenCalled()
  })
  it('refuses a Windows-only job when no Windows runner or local slot is available', async () => {
    const d = deps()
    await expect(
      routeChecks({ ...job, labels: ['os:windows'] }, [runner], d, () => Promise.resolve()),
    ).rejects.toThrow()
    expect(d.local).not.toHaveBeenCalled()
  })
  it('tries affinity first, then falls back from offline, busy and uncertain runners', async () => {
    const other = { ...runner, id: 'other' }
    const d = deps()
    expect(
      await routeChecks({ ...job, preferredRunners: ['other'] }, [runner, other], d, () =>
        Promise.resolve(),
      ),
    ).toMatchObject({ location: 'remote' })
    expect(d.remote).toHaveBeenCalledExactlyOnceWith(other, expect.anything())
    for (const kind of ['offline', 'busy', 'uncertain'] as const) {
      const fallback = { ...deps(), remote: vi.fn(() => Promise.resolve({ kind })) }
      expect(
        await routeChecks(job, [runner, other], fallback, () => Promise.resolve()),
      ).toMatchObject({ location: 'local' })
      expect(fallback.remote).toHaveBeenCalledTimes(2)
    }
  })
  it('samples before dispatch and refuses overloaded, full, input-hung and offline runners', async () => {
    for (const sample of [
      undefined,
      { ...health, load: health.cores },
      { ...health, freeSlots: 0 },
      { ...health, inputReady: false },
    ]) {
      const d = { ...deps(), sample: () => Promise.resolve(sample) }
      expect(await routeChecks(job, [runner], d, () => Promise.resolve())).toMatchObject({
        location: 'local',
      })
      expect(d.remote).not.toHaveBeenCalled()
    }
  })
  it('rejects late remote and local answers by run id, and respects cancellation', async () => {
    const d = deps()
    const remote: CheckRoutingDeps['remote'] = () =>
      Promise.resolve({
        kind: 'finished',
        result: { runId: `${job.runId}-old`, exitCode: 0, output: 'late', location: 'remote' },
      })
    expect(
      await routeChecks(job, [runner], { ...d, remote }, () => Promise.resolve()),
    ).toMatchObject({ location: 'local' })
    await expect(
      routeChecks(
        job,
        [],
        {
          ...d,
          local: () =>
            Promise.resolve({ runId: 'old-run', exitCode: 0, output: '', location: 'local' }),
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow()
    const abort = new AbortController()
    abort.abort()
    await expect(
      routeChecks({ ...job, signal: abort.signal }, [runner], d, () => Promise.resolve()),
    ).rejects.toThrow()
  })
})
