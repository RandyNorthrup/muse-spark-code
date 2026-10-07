import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import * as processTree from '../../../src/host/processTree'
import { treeSpawnOptions, type TreeRoot } from '../../../src/host/processTree'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  spawnVaultFeeder,
  vaultExecProcessRunner,
  type VaultExecSpawnDeps,
} from '../../../src/host/vault/vaultExecSpawn'
import { ShellTimeLimit } from '../../../src/core/backends/modelapi/tools'
import { UI_TEXT, VAULT_LIMITS, PROCESS_TABLE_TIMEOUT_MS } from '../../../src/shared/constants'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { envelope } from './execFixture'

const paths = { root: '', feeder: '', hanging: '', forged: '', oversized: '' }
const log = vi.fn()
// Native pipes on every OS; Windows containment is a fake port, not a platform receipt.
vi.mock('../../../src/host/processTree', async (original) => {
  const real = await original<typeof processTree>()
  return process.platform === 'win32'
    ? {
        ...real,
        killTree: async (root: TreeRoot) => {
          root.kill('SIGKILL')
          await Promise.resolve()
        },
      }
    : real
})
beforeAll(async () => {
  paths.root = await realpath(await mkdtemp(path.join(process.cwd(), 'temp/m109-x-spawn-')))
  paths.feeder = path.join(paths.root, 'feeder.mjs')
  paths.hanging = path.join(paths.root, 'hang.mjs')
  paths.forged = path.join(paths.root, 'forged.mjs')
  paths.oversized = path.join(paths.root, 'oversized.mjs')
  await writeFile(
    paths.oversized,
    `process.stdout.write(JSON.stringify({stdout:'bounded-result',stderr:'',exitCode:0,isTimedOut:false,isCancelled:false})+' '.repeat(${String(VAULT_LIMITS.frameBytes)}));`,
  )
  await writeFile(
    paths.feeder,
    `import {readFileSync} from 'node:fs'; const frame=JSON.parse(readFileSync(3,'utf8')); const id=frame.approvals[0].ticket.id; process.stdout.write(JSON.stringify({stdout:JSON.stringify({received:true,argumentTicket:process.argv.some(v=>v.includes(id)),environmentTicket:Object.values(process.env).some(v=>v.includes(id)),ambientCredential:process.env.META_API_KEY!==undefined}),stderr:'',exitCode:0,isTimedOut:false,isCancelled:false}));`,
  )
  await writeFile(paths.hanging, 'setInterval(()=>{},1000);')
  await writeFile(
    paths.forged,
    `process.stdout.write(JSON.stringify({stdout:'untrusted',stderr:'',exitCode:0,isTimedOut:false,isCancelled:false,isWorkspaceShutdownProven:true}));`,
  )
})
afterAll(async () => {
  await rm(paths.root, { recursive: true, force: true })
})

async function terminateTree(root: processTree.TreeRoot): Promise<void> {
  if (process.platform === 'win32') {
    await processTree.killTree(root, { platform: 'win32', systemRoot: undefined, log }, Date.now())
    return
  }
  if (root.pid !== undefined) {
    try {
      process.kill(-root.pid, 'SIGKILL')
    } catch {
      /* The private group has already exited. */
    }
  }
}
function wipe(bytes: Buffer): void {
  bytes.fill(0)
}
function deps(feederPath = paths.feeder): VaultExecSpawnDeps {
  return {
    nodePath: process.execPath,
    feederPath,
    env: () => ({
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      META_API_KEY: 'generated-test-marker',
    }),
    tree: { platform: process.platform, systemRoot: process.env['SystemRoot'], log },
    timeoutMs: 2000,
    terminateContained: terminateTree,
    job: { name: 'generated-test-job', assemblyPath: path.join(paths.root, 'test-only-job') },
    spawnContained: (file, args, env) =>
      spawn(file, [...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
        ...treeSpawnOptions(process.platform),
      }),
  }
}
describe('M109 X native feeder boundary', () => {
  it('passes its ticket only through an inherited pipe with the ambient environment fenced', async () => {
    const result = await spawnVaultFeeder(
      deps(),
      envelope(),
      new AbortController().signal,
      () => undefined,
    )
    expect(JSON.parse(result.stdout)).toEqual({
      received: true,
      argumentTicket: false,
      environmentTicket: false,
      ambientCredential: false,
    })
    expect(result.isWorkspaceShutdownProven).toBeUndefined()
  })
  it('bounds the outgoing ticket frame before spawn and refuses an oversized valid result prefix', async () => {
    const input = envelope()
    input.run.command.argv = Array.from({ length: VAULT_LIMITS.argv }, () =>
      '😀'.repeat(VAULT_LIMITS.text / 2),
    )
    const approved = input.approvals[0]!
    if (approved.use.kind !== 'environment') throw new Error('expected env use')
    approved.use.command = input.run.command
    approved.ticket.digest = vaultUseDigest(approved.use)
    const spawn = vi.fn(deps().spawnContained)
    const rejected = await spawnVaultFeeder(
      { ...deps(), spawnContained: spawn },
      input,
      new AbortController().signal,
      () => undefined,
    )
    expect(rejected.isWorkspaceShutdownProven).toBe(true)
    expect(spawn).not.toHaveBeenCalled()
    const oversized = await spawnVaultFeeder(
      // Fake containment waits for the successful root exit; the frame must still be invalid.
      {
        ...deps(paths.oversized),
        terminateContained: async (child) => {
          if (child.exitCode === null && child.signalCode === null)
            await new Promise<void>((resolve) => {
              child.once('exit', () => {
                resolve()
              })
            })
        },
      },
      envelope(),
      new AbortController().signal,
      () => undefined,
    )
    expect(oversized.stdout).toBe('')
    expect(oversized.exitCode).toBeNull()
  })
  it('refuses forged process-provenance fields instead of forwarding unvalidated output', async () => {
    const result = await spawnVaultFeeder(
      deps(paths.forged),
      envelope(),
      new AbortController().signal,
      () => undefined,
    )
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(UI_TEXT.vault.noAccess)
    expect(result.isWorkspaceShutdownProven).toBeUndefined()
  })
  it('rechecks local admission and requires Windows prebound containment before ticket release', async () => {
    const guard = vi.fn(() => {
      throw new Error('entry revoked')
    })
    const result = await spawnVaultFeeder(deps(), envelope(), new AbortController().signal, guard)
    expect(result.isWorkspaceShutdownProven).toBe(true)
    expect(guard).toHaveBeenCalledOnce()
    const { job: _job, spawnContained: _spawn, ...base } = deps()
    const windows = { ...base, tree: { ...deps().tree, platform: 'win32' as const } }
    const blocked = await spawnVaultFeeder(
      windows,
      envelope(),
      new AbortController().signal,
      () => undefined,
    )
    expect(blocked.stderr).toBe(UI_TEXT.vault.brokerBlocked)
  })
  it('refuses an uncontained launcher and waits for complete termination before returning a result', async () => {
    const { terminateContained: _terminate, ...missing } = deps()
    await expect(
      spawnVaultFeeder(missing, envelope(), new AbortController().signal, () => undefined),
    ).resolves.toMatchObject({
      stderr: UI_TEXT.vault.brokerBlocked,
      isWorkspaceShutdownProven: true,
    })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let hasReturned = false
    const result = (async () => {
      const value = await spawnVaultFeeder(
        {
          ...deps(),
          terminateContained: async (root) => {
            entered.resolve(undefined)
            await release.promise
            await terminateTree(root)
          },
        },
        envelope(),
        new AbortController().signal,
        () => undefined,
      )
      hasReturned = true
      return value
    })()
    await entered.promise
    expect(hasReturned).toBe(false)
    release.resolve(undefined)
    const completed = await result
    expect(completed.exitCode).toBe(0)
    await expect(
      spawnVaultFeeder(
        {
          ...deps(),
          terminateContained: () =>
            Promise.reject(new Error('generated private containment error')),
        },
        envelope(),
        new AbortController().signal,
        () => undefined,
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: UI_TEXT.vault.noAccess, exitCode: null })
  })
  it('bounds a stuck termination port, reports uncertainty, and falls back to ending the root group', async () => {
    const started = Promise.withResolvers<undefined>()
    const root: { child?: ChildProcess } = {}
    const controller = new AbortController()
    const observed: { result?: Awaited<ReturnType<typeof spawnVaultFeeder>> } = {}
    const pending = (async () => {
      observed.result = await spawnVaultFeeder(
        {
          ...deps(paths.hanging),
          spawnContained: (...args) => {
            const child = deps(paths.hanging).spawnContained!(...args)
            root.child = child
            child.once('spawn', () => {
              started.resolve(undefined)
            })
            return child
          },
          terminateContained: () => new Promise<void>(() => undefined),
        },
        envelope(),
        controller.signal,
        () => undefined,
      )
    })()
    await started.promise
    vi.useFakeTimers()
    try {
      controller.abort()
      await vi.advanceTimersByTimeAsync(PROCESS_TABLE_TIMEOUT_MS)
      expect(observed.result).toMatchObject({
        stdout: '',
        stderr: UI_TEXT.vault.noAccess,
        exitCode: null,
      })
      await pending
    } finally {
      vi.useRealTimers()
      if (root.child) await terminateTree(root.child)
    }
  })
  it('lets the host lift its command timeout while keeping cleanup bounded', async () => {
    const limit = new ShellTimeLimit()
    limit.lift()
    const controller = new AbortController()
    const started = Promise.withResolvers<undefined>()
    const call = spawnVaultFeeder(
      {
        ...deps(paths.hanging),
        timeoutMs: 1,
        limit,
        spawnContained: (...args) => {
          const child = deps(paths.hanging).spawnContained!(...args)
          child.once('spawn', () => {
            started.resolve(undefined)
          })
          return child
        },
      },
      envelope(),
      controller.signal,
      () => undefined,
    )
    await started.promise
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    controller.abort()
    const lifted = await call
    expect(lifted.isTimedOut).toBe(false)
  })
  it('ends the feeder process group on cancellation and timeout', async () => {
    const controller = new AbortController()
    const call = spawnVaultFeeder(
      deps(paths.hanging),
      envelope(),
      controller.signal,
      () => undefined,
    )
    controller.abort()
    const cancelled = await call
    expect(cancelled.isCancelled).toBe(true)
    const timedOut = await spawnVaultFeeder(
      { ...deps(paths.hanging), timeoutMs: 100 },
      envelope(),
      new AbortController().signal,
      () => undefined,
    )
    expect(timedOut.isTimedOut).toBe(true)
  })
  it('uses the outer command clock and an independent hard cleanup timeout, reporting termination failure', async () => {
    const run = vaultExecProcessRunner(deps().tree, 30, terminateTree, deps().job)
    const invocation = {
      file: process.execPath,
      args: ['-e', 'setTimeout(()=>{},150)'],
      cwd: paths.root,
      env: {},
      stdin: null,
    }
    const completed = await run(invocation, new AbortController().signal, wipe, wipe)
    expect(completed).toMatchObject({ exitCode: 0, isTimedOut: false })
    const cleanup = await run(
      { ...invocation, cleanup: true },
      new AbortController().signal,
      wipe,
      wipe,
    )
    expect(cleanup.isTimedOut).toBe(true)
    const failing = vaultExecProcessRunner(
      deps().tree,
      2000,
      () => {
        throw new Error('generated private termination failure')
      },
      deps().job,
    )
    const rejected = await failing(
      { ...invocation, args: ['-e', ''] },
      new AbortController().signal,
      wipe,
      wipe,
    )
    expect(rejected.exitCode).toBeNull()
  })
  it('routes native process output to private scrub streams with no raw text in its result', async () => {
    const kill = vi.fn(terminateTree)
    const stdout = vi.fn((bytes: Buffer) => {
      expect(bytes.toString()).toBe('generated-output')
      bytes.fill(0)
    })
    const stderr = vi.fn((bytes: Buffer) => {
      expect(bytes.toString()).toBe('generated-error')
      bytes.fill(0)
    })
    const run = vaultExecProcessRunner(deps().tree, 2000, kill, deps().job)
    const result = await run(
      {
        file: process.execPath,
        args: [
          '-e',
          "process.stdout.write('generated-output');process.stderr.write('generated-error');",
        ],
        cwd: paths.root,
        env: {},
        stdin: null,
      },
      new AbortController().signal,
      stdout,
      stderr,
    )
    expect(result.exitCode).toBe(0)
    expect(result).not.toHaveProperty('stdout')
    expect(result).not.toHaveProperty('stderr')
    expect(stdout).toHaveBeenCalledOnce()
    expect(stderr).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledOnce()
    await expect(
      vaultExecProcessRunner({ ...deps().tree, platform: 'win32' }, 2000, kill)(
        { file: process.execPath, args: [], cwd: paths.root, env: {}, stdin: null },
        new AbortController().signal,
        stdout,
        stderr,
      ),
    ).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
  })
})
