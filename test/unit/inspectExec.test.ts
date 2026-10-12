import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileIdentityKey, statIdentity } from '../../src/core/fs/fileIdentity'
import {
  InspectRunner,
  type InspectExecOptions,
  type InspectResult,
} from '../../src/core/judge/fast/inspectExec'
import { SHELL_DEFAULT_TIMEOUT_MS } from '../../src/shared/constants'
import { inspectStart } from './helpers/inspectStart'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(mode: string, onStart?: (args: readonly string[]) => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'b1-exec-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace'),
    storage = path.join(root, 'storage')
  await mkdir(workspace)
  const identity = fileIdentityKey(await statIdentity(workspace))
  if (identity === undefined) throw new Error('Missing workspace identity')
  const binding = { root: workspace, identity }
  const processes: Awaited<ReturnType<InspectExecOptions['start']>>[] = []
  const start = vi.fn<InspectExecOptions['start']>(async (_file, args, options) => {
    const launched = await inspectStart(
      process.execPath,
      [path.resolve('test/fixtures/inspect-helper.mjs'), mode, ...args],
      options,
    )
    processes.push(launched)
    let hasNotified = false
    const notify = () => {
      if (hasNotified) return
      hasNotified = true
      onStart?.(args)
    }
    launched.child.stdout.once('data', notify)
    launched.child.stderr.once('data', notify)
    return launched
  })
  const runner = new InspectRunner({ helper: 'installed-confine-helper', storage, start })
  return { runner, binding, storage, start, processes }
}

async function cancelWaiting(controller: AbortController, run: Promise<InspectResult>) {
  controller.abort()
  expect(await Promise.race([run, new Promise<void>((resolve) => setImmediate(resolve))])).toEqual({
    kind: 'refused',
    reason: 'cancelled',
  })
}

if (process.platform === 'linux') {
  describe('internal inspect runner failure and lifecycle boundary', () => {
    it('shares one self-test across requests and sends a fixed environment to the governed launcher', async () => {
      const h = await fixture('normal')
      try {
        const results = await Promise.all([
          h.runner.run('cat ordinary.txt', h.binding),
          h.runner.run('cat ordinary.txt', h.binding),
        ])
        expect(results).toEqual(
          Array.from({ length: 2 }, () => ({
            kind: 'output',
            stdout: 'ordinary output',
            stderr: '',
            exitCode: 1,
            excluded: 0,
          })),
        )
        expect(h.start.mock.calls.filter((call) => call[1][0] === 'probe')).toHaveLength(1)
        for (const call of h.start.mock.calls) {
          expect(call[2].env).toEqual({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' })
          expect(call[0]).toBe('installed-confine-helper')
        }
        expect(await readdir(h.storage)).toEqual([])
      } finally {
        await h.runner.dispose()
      }
    })
    it('snapshots the trusted workspace binding before waiting for readiness', async () => {
      const h = await fixture('normal')
      const original = h.binding.root
      const other = await mkdtemp(path.join(os.tmpdir(), 'b1-other-'))
      roots.push(other)
      const identity = fileIdentityKey(await statIdentity(other))
      if (identity === undefined) throw new Error('Missing other identity')
      try {
        const run = h.runner.run('cat ordinary.txt', h.binding)
        h.binding.root = other
        h.binding.identity = identity
        const result = await run
        expect(result.kind).toBe('output')
        expect(h.start.mock.calls.at(-1)?.[1][1]).toBe(original)
      } finally {
        await h.runner.dispose()
      }
    })
    it.each([
      'badProbe',
      'nativeProbeFailure',
      'malformed',
      'failure',
      'limit',
      'secret',
      'stderrSecret',
    ])('refuses %s without leaking its output', async (mode) => {
      const reasons = new Map([
        ['badProbe', 'selfTest'],
        ['nativeProbeFailure', 'landlockAbi'],
        ['malformed', 'confinement'],
        ['failure', 'confinement'],
        ['limit', 'outputLimit'],
        ['secret', 'secret'],
        ['stderrSecret', 'secret'],
      ])
      const h = await fixture(mode)
      try {
        const result = await h.runner.run('cat ordinary.txt', h.binding)
        expect(result.kind).toBe('refused')
        if (result.kind === 'refused') expect(result.reason).toBe(reasons.get(mode))
        if (mode === 'badProbe') {
          expect(await h.runner.run('cat ordinary.txt', h.binding)).toEqual({
            kind: 'refused',
            reason: 'selfTest',
          })
          expect(h.start).toHaveBeenCalledTimes(1)
        }
        expect(await readdir(h.storage)).toEqual([])
      } finally {
        await h.runner.dispose()
      }
    })
    it('never reads a killed program’s stderr as the helper’s verdict', async () => {
      // The fake prints the confined line, then a program-owned line that
      // looks like a refusal, then dies by signal. The runner knows the
      // program and the signal: du reports the existing process-creation
      // refusal (it dies asking for a thread the boundary denies), and any
      // other program reports the generic one — never the forged word.
      for (const [command, reason] of [
        ['wc -l ordinary.txt', 'confinement'],
        ['du -s .', 'processCreation'],
      ] as const) {
        const h = await fixture('killedAfterJson')
        try {
          expect(await h.runner.run(command, h.binding)).toEqual({ kind: 'refused', reason })
        } finally {
          await h.runner.dispose()
        }
      }
    })
    it('does not start a helper for grammar misses, root or pre-cancelled requests', async () => {
      const h = await fixture('normal')
      try {
        expect(await h.runner.run('git status', h.binding)).toEqual({
          kind: 'refused',
          reason: 'grammar',
        })
        expect(await h.runner.run('cat x', h.binding, AbortSignal.abort())).toEqual({
          kind: 'refused',
          reason: 'cancelled',
        })
        vi.spyOn(process, 'getuid').mockReturnValue(0)
        expect(await h.runner.run('cat x', h.binding)).toEqual({
          kind: 'refused',
          reason: 'root',
        })
        expect(h.start).not.toHaveBeenCalled()
      } finally {
        await h.runner.dispose()
      }
    })
    it('disposal cancels a pending self-test, observes close and cleans its tree', async () => {
      const { promise: ready, resolve: started } = Promise.withResolvers<true>()
      const h = await fixture('hangProbe', () => {
        started(true)
      })
      const run = h.runner.run('cat x', h.binding)
      await ready
      await h.runner.dispose()
      expect(await run).toEqual({ kind: 'refused', reason: 'cancelled' })
      expect(await readdir(h.storage)).toEqual([])
      expect(await h.runner.run('cat x', h.binding)).toEqual({
        kind: 'refused',
        reason: 'cancelled',
      })
    })
    it('detaches a cancelled readiness waiter during admission while a concurrent caller completes the shared probe', async () => {
      const h = await fixture('normal')
      const original = h.start.getMockImplementation()
      if (original === undefined) throw new Error('Missing launcher fixture')
      const { promise: admitted, resolve: release } = Promise.withResolvers<true>()
      const { promise: ready, resolve: started } = Promise.withResolvers<true>()
      h.start.mockImplementationOnce(async (file, args, options) => {
        started(true)
        await admitted
        return await original(file, args, options)
      })
      const controller = new AbortController()
      const cancelled = h.runner.run('cat ordinary.txt', h.binding, controller.signal)
      const survivor = h.runner.run('cat ordinary.txt', h.binding)
      try {
        await ready
        await cancelWaiting(controller, cancelled)
        expect(h.start.mock.calls[0]?.[2].signal?.aborted).toBe(false)
        release(true)
        expect(await survivor).toMatchObject({ kind: 'output', stdout: 'ordinary output' })
        expect(h.start.mock.calls.filter((call) => call[1][0] === 'probe')).toHaveLength(1)
        expect(h.start.mock.calls.filter((call) => call[1][1] === h.binding.root)).toHaveLength(1)
        expect(await readdir(h.storage)).toEqual([])
      } finally {
        release(true)
        await h.runner.dispose()
      }
    })
    it('detaches a cancelled readiness waiter while the real hangProbe child remains alive for the session', async () => {
      const { promise: ready, resolve: started } = Promise.withResolvers<true>()
      const h = await fixture('hangProbe', () => {
        started(true)
      })
      const controller = new AbortController()
      const run = h.runner.run('cat x', h.binding, controller.signal)
      try {
        await ready
        await cancelWaiting(controller, run)
        const probe = h.processes[0]
        expect(probe?.child.exitCode).toBeNull()
        expect(probe?.child.signalCode).toBeNull()
        expect(h.start.mock.calls[0]?.[2].signal?.aborted).toBe(false)
      } finally {
        await h.runner.dispose()
      }
      expect(await readdir(h.storage)).toEqual([])
    })
    it('disposal waits for shared readiness cleanup after its only caller has detached', async () => {
      const h = await fixture('normal')
      const { promise: ready, resolve: started } = Promise.withResolvers<true>()
      const { promise: stopping, resolve: stopped } = Promise.withResolvers<true>()
      const { promise: drained, resolve: release } = Promise.withResolvers<true>()
      h.start.mockImplementationOnce((_file, _args, options) => {
        started(true)
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => {
              stopped(true)
              void (async () => {
                await drained
                reject(new Error('Synthetic drained admission'))
              })()
            },
            { once: true },
          )
        })
      })
      const controller = new AbortController()
      const run = h.runner.run('cat x', h.binding, controller.signal)
      try {
        await ready
        await cancelWaiting(controller, run)
        let hasDisposed = false
        const disposal = (async () => {
          await h.runner.dispose()
          hasDisposed = true
        })()
        await stopping
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(hasDisposed).toBe(false)
        release(true)
        await disposal
        expect(await readdir(h.storage)).toEqual([])
      } finally {
        release(true)
        await h.runner.dispose()
      }
    })
    it('cancels an active run and times out at the normal tool deadline', async () => {
      for (const isTimeout of [false, true]) {
        const { promise: ready, resolve: started } = Promise.withResolvers<true>()
        const h = await fixture('hang', (args) => {
          if (args[0] === 'run' && !args[1]?.includes('b1-test-')) started(true)
        })
        const controller = new AbortController()
        if (isTimeout) vi.useFakeTimers()
        const run = h.runner.run('cat x', h.binding, controller.signal)
        await ready
        if (isTimeout) vi.advanceTimersByTime(SHELL_DEFAULT_TIMEOUT_MS)
        else controller.abort()
        expect(await run).toEqual({ kind: 'refused', reason: isTimeout ? 'timeout' : 'cancelled' })
        vi.useRealTimers()
        await h.runner.dispose()
        expect(await readdir(h.storage)).toEqual([])
      }
    })
    it('latches off when the governed launcher rejects, without publishing raw errors', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'b1-refused-'))
      roots.push(root)
      const runner = new InspectRunner({
        helper: '',
        storage: root,
        start: () => Promise.reject(new Error('private launch failure')),
      })
      expect(await runner.run('cat x', { root, identity: '0:0' })).toEqual({
        kind: 'refused',
        reason: 'selfTest',
      })
      await runner.dispose()
    })
    it('preserves the deadline reason while awaiting governed admission', async () => {
      const h = await fixture('normal')
      const original = h.start.getMockImplementation()
      if (original === undefined) throw new Error('Missing launcher fixture')
      const { promise: ready, resolve: started } = Promise.withResolvers<true>()
      h.start.mockImplementation((file, args, options) => {
        if (args[0] !== 'run' || args[1]?.includes('b1-test-')) return original(file, args, options)
        started(true)
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('governed admission aborted'))
            },
            { once: true },
          )
        })
      })
      vi.useFakeTimers()
      try {
        const run = h.runner.run('cat x', h.binding)
        await ready
        vi.advanceTimersByTime(SHELL_DEFAULT_TIMEOUT_MS)
        expect(await run).toEqual({ kind: 'refused', reason: 'timeout' })
      } finally {
        await h.runner.dispose()
      }
    })
  })
} else {
  it('has no execution path on uncertified platforms', async () => {
    const h = await fixture('normal')
    expect(await h.runner.run('cat x', h.binding)).toEqual({
      kind: 'refused',
      reason: 'platform',
    })
    expect(h.start).not.toHaveBeenCalled()
    await h.runner.dispose()
  })
}
