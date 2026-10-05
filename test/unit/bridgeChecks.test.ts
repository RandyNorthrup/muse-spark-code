import { describe, expect, it, vi } from 'vitest'
import { bridgeRunChecks, type BridgeChecksDeps } from '../../src/host/team/mcpBridge'
import { routeWorkerCheck } from '../../src/core/team/workers/engineWorker'
import type { Runner } from '../../src/shared/team'
import { runnerTestProcess } from './helpers/runnerProcesses'
import type { CheckJob } from '../../src/core/runners/routing'
import { VERIFY_TOOLS, CHECK_COMMANDS_MAX } from '../../src/shared/constants'

const denial: BridgeChecksDeps['guard'] = () => Promise.reject(new Error('shell guard denied'))

function dependencies(): BridgeChecksDeps {
  return {
    checks: () => [{ name: 'unit', command: 'npm test', changedFiles: true, timeoutSeconds: 2 }],
    platform: 'linux',
    isCurrentAndAllowed: () => true,
    pathsFor: (paths) => Promise.resolve(paths ?? ['test/a.test.ts']),
    makeJob: (command, timeoutMs) => ({
      runId: 'run-1',
      cwd: '/copy',
      command,
      timeoutMs,
      commandClass: 'tests',
      labels: [],
      preferredRunners: [],
      lockfiles: ['package-lock.json'],
      signal: new AbortController().signal,
      onOutput: vi.fn(),
    }),
    guard: vi.fn((job: CheckJob) => Promise.resolve(job.command)),
    runners: () => [],
    routing: {
      isTrusted: () => true,
      localLabels: ['os:linux'],
      sample: vi.fn(() => Promise.resolve(undefined)),
      remote: vi.fn<BridgeChecksDeps['routing']['remote']>(() =>
        Promise.resolve({ kind: 'offline' }),
      ),
      local: vi.fn((job: CheckJob) =>
        Promise.resolve({
          runId: job.runId,
          exitCode: 0,
          output: 'x'.repeat(20_000),
          location: 'local',
        }),
      ),
    },
    pack: vi.fn((results) => Promise.resolve({ packed: results })),
  }
}
describe('bridge run_checks and engine test-command region', () => {
  it('offers the existing run_checks definition, quotes paths, runs guards and packs the full output', async () => {
    const deps = dependencies()
    const tool = bridgeRunChecks(deps)
    expect(tool.definition.name).toBe(VERIFY_TOOLS.runChecks)
    expect(tool.definition.properties).toHaveProperty('names')
    const answer = await tool.call({ names: ['unit'], paths: ['test/a b.test.ts'] })
    expect(answer).toMatchObject({ packed: [{ output: 'x'.repeat(20_000) }] })
    expect(deps.guard).toHaveBeenCalledWith(
      expect.objectContaining({ command: "npm test -- 'test/a b.test.ts'", timeoutMs: 2000 }),
    )
    expect(deps.pack).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ output: 'x'.repeat(20_000) }),
    ])
  })
  it('quotes scoped files for the declared runner OS and guards the final command', async () => {
    const deps = dependencies()
    const runner: Runner = {
      id: 'mac',
      destination: 'fake',
      os: 'darwin',
      workFolder: '/rig',
      maxJobs: 1,
      labels: [],
      commandClasses: ['tests'],
      setupCommand: 'npm ci',
      cacheKey: 'npm',
      environmentNames: [],
    }
    const remote = vi.fn<BridgeChecksDeps['routing']['remote']>(async (_, job) => {
      const result = await runnerTestProcess({
        file: '/bin/bash',
        args: ['-c', job.command],
        cwd: process.cwd(),
        env: {},
        timeoutMs: 2000,
      })
      return {
        kind: 'finished',
        result: {
          runId: job.runId,
          exitCode: result.exitCode,
          output: result.output,
          location: runner.id,
        },
      }
    })
    const answer = await bridgeRunChecks({
      ...deps,
      platform: 'win32',
      checks: () => [
        {
          name: 'unit',
          command: `'${process.execPath}' -e 'console.log(JSON.stringify(process.argv.slice(1)))'`,
          changedFiles: true,
        },
      ],
      runners: () => [runner],
      routing: {
        ...deps.routing,
        sample: () =>
          Promise.resolve({ cores: 2, load: 0, freeSlots: 1, inputReady: true, sampledAt: 0 }),
        remote,
      },
    }).call({ paths: ["test/O'Brien.test.ts"] })
    expect(answer).toMatchObject({
      packed: [{ exitCode: 0, output: JSON.stringify(["test/O'Brien.test.ts"]) + '\n' }],
    })
    expect(deps.guard).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.stringContaining(String.raw`'test/O'\''Brien.test.ts'`),
      }),
    )
  })
  it('refuses Windows-unsafe scoped paths on a Windows runner from a POSIX host', async () => {
    const deps = dependencies()
    const runner: Runner = {
      id: 'win',
      destination: 'fake',
      os: 'win32',
      workFolder: 'C:/rig',
      maxJobs: 1,
      labels: [],
      commandClasses: ['tests'],
      setupCommand: 'npm ci',
      cacheKey: 'npm',
      environmentNames: [],
    }
    await expect(
      bridgeRunChecks({
        ...deps,
        runners: () => [runner],
        routing: {
          ...deps.routing,
          sample: () =>
            Promise.resolve({ cores: 2, load: 0, freeSlots: 1, inputReady: true, sampledAt: 0 }),
        },
      }).call({ paths: ['test/a&b.test.ts'] }),
    ).rejects.toThrow()
    expect(deps.routing.remote).not.toHaveBeenCalled()
    expect(deps.routing.local).not.toHaveBeenCalled()
  })
  it('rechecks trust, cancellation and refusal after the destination-command guard', async () => {
    for (const mode of ['trust', 'cancel', 'empty', 'denied']) {
      const deps = dependencies()
      const controller = new AbortController()
      let isTrusted = true
      let guards = 0
      const guarded = bridgeRunChecks({
        ...deps,
        makeJob: (command, timeoutMs) => ({
          ...deps.makeJob(command, timeoutMs),
          signal: controller.signal,
        }),
        guard: (job) => {
          guards += 1
          if (guards === 2) {
            switch (mode) {
              case 'trust': {
                isTrusted = false
                break
              }
              case 'cancel': {
                controller.abort()
                break
              }
              case 'denied': {
                return Promise.reject(new Error('final command denied'))
              }
              default: {
                return Promise.resolve('')
              }
            }
          }
          return Promise.resolve(job.command)
        },
        routing: { ...deps.routing, isTrusted: () => isTrusted },
      })
      await expect(guarded.call({ paths: ['test/a.test.ts'] })).rejects.toThrow()
      expect(deps.routing.local).not.toHaveBeenCalled()
      expect(deps.pack).not.toHaveBeenCalled()
    }
  })
  it('dispatches the command after a hook rewrite and refuses an empty hook command', async () => {
    const deps = dependencies()
    const job = deps.makeJob('original command', 2000)
    await routeWorkerCheck(job, { ...deps, guard: () => Promise.resolve('rewritten check') })
    expect(deps.routing.local).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ command: 'rewritten check', runId: job.runId }),
    )
    const fresh = dependencies()
    await expect(
      routeWorkerCheck(job, { ...fresh, guard: () => Promise.resolve('') }),
    ).rejects.toThrow()
    expect(fresh.routing.local).not.toHaveBeenCalled()
  })
  it('refuses guarded tests and then_run before any runner probe, snapshot or install', async () => {
    const deps = dependencies()
    for (const command of ['npm test', 'then_run check']) {
      await expect(
        routeWorkerCheck(deps.makeJob(command, 2000), { ...deps, guard: denial }),
      ).rejects.toThrow('shell guard denied')
    }
    expect(deps.routing.local).not.toHaveBeenCalled()
    expect(deps.routing.sample).not.toHaveBeenCalled()
    expect(deps.routing.remote).not.toHaveBeenCalled()
  })
  it('rejects unknown fields, missing checks, unknown names, unsafe paths and oversized calls', async () => {
    const deps = dependencies()
    const tool = bridgeRunChecks(deps)
    for (const input of [
      { command: 'evil' },
      { names: ['unknown'] },
      { names: [] },
      { names: Array.from({ length: CHECK_COMMANDS_MAX + 1 }, () => 'unit') },
      { paths: ['@response-file'] },
      { paths: ['newline\nfile'] },
    ])
      await expect(tool.call(input)).rejects.toThrow()
    await expect(bridgeRunChecks({ ...deps, checks: () => [] }).call({})).rejects.toThrow()
    await expect(
      bridgeRunChecks({
        ...deps,
        pathsFor: () => Promise.reject(new Error('path outside copy')),
      }).call({ paths: ['../outside'] }),
    ).rejects.toThrow('path outside copy')
    expect(deps.routing.local).not.toHaveBeenCalled()
    expect(deps.pack).not.toHaveBeenCalled()
  })
  it('binds access to the current authenticated attempt and rechecks it after waits', async () => {
    const deps = dependencies()
    await expect(
      bridgeRunChecks({ ...deps, isCurrentAndAllowed: () => false }).call({}),
    ).rejects.toThrow()
    expect(deps.guard).not.toHaveBeenCalled()
    let isCurrent = true
    const guard: (job: CheckJob) => Promise<string> = (job) => {
      isCurrent = false
      return Promise.resolve(job.command)
    }
    await expect(
      bridgeRunChecks({ ...deps, isCurrentAndAllowed: () => isCurrent, guard }).call({}),
    ).rejects.toThrow()
    expect(deps.routing.local).not.toHaveBeenCalled()
    expect(deps.pack).not.toHaveBeenCalled()
    isCurrent = true
    await expect(
      bridgeRunChecks({
        ...dependencies(),
        isCurrentAndAllowed: () => isCurrent,
        pack: () => {
          isCurrent = false
          return Promise.resolve({ packed: [] })
        },
      }).call({}),
    ).rejects.toThrow()
  })
})
