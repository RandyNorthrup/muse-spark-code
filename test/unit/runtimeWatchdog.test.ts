import './helpers/lspPrivateDirectoryMock'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile, rm, mkdir, chmod, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as os from 'node:os'
import * as processTree from '../../src/host/processTree'
import type * as privateDirectories from '../../src/runtime/privateDirectory'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  treeReceiptSchema,
  isReceiptMatching,
  ownerSchema,
} from '../../src/runtime/lsp/stopReceipt'
import { LSP_LIMITS } from '../../src/shared/constants'
import {
  stopWorkspace,
  stopRuntime,
  runtimeLocatorDirectory,
  UnverifiedStopError,
} from '../../src/runtime/lsp/supervisor'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
import { workspaceKey } from '../../src/runtime/dataFolder'
import {
  requireLiveSupervision,
  requireProcessTable,
  trackFixtureTree,
} from './helpers/liveSupervision'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:os', async (original) => ({ ...(await original<typeof os>()) }))
vi.mock('../../src/host/processTree', async (original) => ({
  ...(await original<typeof processTree>()),
}))
const privateRoots = await vi.importActual<typeof privateDirectories>(
  '../../src/runtime/privateDirectory',
)
const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'mw-')))
const parentFile = path.join(folder, 'parent.js')
const { installLspNativeFixture, buildLspProcess } = await import('./helpers/lspNativeFixture')
afterAll(await installLspNativeFixture(folder))
const watchdogFile = path.join(folder, 'watchdog.js')
await buildLspProcess('test/unit/helpers/supervisorParent.ts', parentFile)
await buildLspProcess('src/runtime/lsp/watchdogEntry.ts', watchdogFile)
afterAll(() => removeFolder(folder))
const receiptSchema = z.strictObject({ root: z.int(), detached: z.int() })
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
async function receipt(file: string) {
  const deadline = Date.now() + LSP_LIMITS.startupMs
  while (Date.now() < deadline) {
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
      return receiptSchema.parse(raw)
    } catch {
      await pause(25)
    }
  }
  throw new Error('no process receipt')
}
async function waitExited(pid: number) {
  // kill(pid, 0) sees a zombie PID slot as alive; fixture PIDs here are never
  // this process's unreaped children (direct children are awaited on close),
  // so a slot that persists is a genuinely live process, not a zombie.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) return
    await pause(50)
  }
  throw new Error(`owned fixture still alive: ${String(pid)}`)
}

const { track, reap } = trackFixtureTree()
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
if (hostPlatform === undefined) throw new Error('fixture platform')
afterEach(async () => {
  Object.defineProperty(process, 'platform', hostPlatform)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await reap()
})
afterAll(reap)
const discoveryTrees = trackFixtureTree()

function runGuardian(label: string) {
  const registry = path.join(folder, label)
  const file = path.join(folder, `${label}.json`)
  const parent = track(
    spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
      stdio: 'ignore',
    }),
  )
  return { registry, file, parent }
}

function rootSelector(home: string, temporary: string, selector: string) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  if (platform === undefined) throw new Error('fixture platform')
  const homeRead = vi.spyOn(os, 'homedir').mockReturnValue(home)
  const actualProgram = processTree.runProgram
  const probing = vi
    .spyOn(processTree, 'runProgram')
    .mockImplementation((file, args, env) =>
      args[0] === 'private-temp'
        ? Promise.resolve(JSON.stringify({ directory: temporary }))
        : actualProgram(file, args, env),
    )
  Object.defineProperty(process, 'platform', { value: selector })
  return () => {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs()
    homeRead.mockRestore()
    probing.mockRestore()
  }
}

async function prepareDiscovery(selector: string) {
  const home = path.join(folder, selector)
  const rejected = path.join(home, 'tmp')
  const state = path.join(home, 'state')
  const changed = path.join(home, 'new')
  await mkdir(home, { mode: 0o700 })
  for (const root of [rejected, state, changed]) await mkdir(root, { mode: 0o700 })
  await chmod(rejected, 0o755)
  const restore = rootSelector(home, rejected, selector)
  let root: string
  let locatorDirectory: string
  try {
    vi.stubEnv('XDG_RUNTIME_DIR', rejected)
    vi.stubEnv('XDG_STATE_HOME', state)
    vi.stubEnv('XDG_CACHE_HOME', changed)
    vi.stubEnv('TMPDIR', rejected)
    locatorDirectory = await runtimeLocatorDirectory(folder, true)
    root = await privateRoots.trustedPrivateRoot(folder)
    expect(root).toBe(selector === 'linux' ? state : path.dirname(locatorDirectory))
  } finally {
    restore()
  }
  const registry = path.join(root, `muse-runtime-${workspaceKey(home)}`)
  const file = path.join(home, 'run.json')
  const parent = discoveryTrees.track(
    spawn(process.execPath, [parentFile, registry, home, watchdogFile, file, locatorDirectory], {
      stdio: 'ignore',
    }),
  )
  const closed = new Promise<number | null>((resolve) => parent.once('close', resolve))
  const owned = await receipt(file)
  await pause(600)
  return { home, rejected, changed, root, registry, locatorDirectory, parent, closed, owned }
}

// Windows uses the kill-on-close job instead, exercised by runtimeSupervisor.test.ts.
describe.skipIf(process.platform === 'win32')('M104L independent POSIX guardian', () => {
  const selectors = process.platform === 'darwin' ? ['linux', 'darwin'] : ['linux']
  const discovery = new Map<string, Awaited<ReturnType<typeof prepareDiscovery>>>()
  // Native launch and fallback directory acquisition belong to shared setup;
  // the unchanged five-second tests measure independent discovery and Stop.
  beforeAll(async () => {
    await requireLiveSupervision()
    for (const selector of selectors) discovery.set(selector, await prepareDiscovery(selector))
  })
  afterAll(async () => {
    await discoveryTrees.reap()
  })

  it.each(selectors)(
    'independent Stop discovers the original root after %s environment and trust changes',
    async (selector) => {
      await requireLiveSupervision()
      const run = discovery.get(selector)
      if (run === undefined) throw new Error('missing discovery fixture')
      const { home, rejected, changed, root, registry, locatorDirectory, owned, closed } = run
      const ownerFiles = await readdir(registry)
      const ownerFile = ownerFiles.find((name) => name.endsWith('.json'))
      if (ownerFile === undefined) throw new Error('missing owner')
      const owner = ownerSchema.parse(
        JSON.parse(await readFile(path.join(registry, ownerFile), 'utf8')),
      )
      expect(owner.trustRoot).toBe(root)
      await chmod(rejected, 0o700)
      const restore = rootSelector(home, rejected, selector)
      const diagnostics: string[] = []
      try {
        vi.stubEnv('XDG_RUNTIME_DIR', changed)
        vi.stubEnv('XDG_STATE_HOME', changed)
        vi.stubEnv('XDG_CACHE_HOME', changed)
        vi.stubEnv('TMPDIR', changed)
        expect(await privateRoots.trustedPrivateRoot(folder)).not.toBe(root)
        await stopRuntime(home, folder, home, (message) => {
          diagnostics.push(message)
        })
        restore()
        await waitExited(owned.root)
        await waitExited(owned.detached)
        expect(await closed).toBe(0)
        expect(diagnostics).toContain(`ELSP_PRIVATE_ROOT: ${root}`)
        expect(await readdir(locatorDirectory)).toEqual([])
      } finally {
        restore()
      }
    },
  )

  it.each(['duplicate', 'wrong-root', 'untrusted-forgery', 'separators'])(
    'independent Stop preflights every root and refuses or ignores %s before signalling',
    async (fault) => {
      await requireLiveSupervision()
      const home = path.join(folder, fault)
      const firstRoot = path.join(home, 'first')
      const secondRoot = path.join(home, 'second')
      await mkdir(home, { mode: 0o700 })
      await mkdir(firstRoot, { mode: 0o700 })
      await mkdir(secondRoot, { mode: 0o700 })
      const firstRegistry = path.join(firstRoot, `muse-runtime-${workspaceKey(home)}`)
      const secondRegistry = path.join(secondRoot, `muse-runtime-${workspaceKey(home)}`)
      await mkdir(secondRegistry, { mode: 0o700 })
      const file = path.join(home, 'run.json')
      const parent = track(
        spawn(process.execPath, [parentFile, firstRegistry, home, watchdogFile, file], {
          stdio: 'ignore',
        }),
      )
      const homeRead = vi.spyOn(os, 'homedir').mockReturnValue(home)
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')
      if (platform === undefined) throw new Error('fixture platform')
      let owned: z.infer<typeof receiptSchema> | undefined
      let original: string | undefined
      let ownerFile: string | undefined
      try {
        owned = await receipt(file)
        await pause(600)
        const ownerFiles = await readdir(firstRegistry)
        ownerFile = ownerFiles.find((name) => name.endsWith('.json'))
        if (ownerFile === undefined) throw new Error('missing owner')
        original = await readFile(path.join(firstRegistry, ownerFile), 'utf8')
        const owner = ownerSchema.parse(JSON.parse(original))
        const forged = JSON.stringify({
          ...owner,
          trustRoot: fault === 'separators' ? firstRoot.replaceAll('/', '\\') : secondRoot,
        })
        if (fault === 'wrong-root' || fault === 'separators')
          await writeFile(path.join(firstRegistry, ownerFile), forged)
        else await writeFile(path.join(secondRegistry, ownerFile), forged, { mode: 0o600 })
        if (fault === 'untrusted-forgery') {
          Object.defineProperty(process, 'platform', { value: 'linux' })
          const locators = await runtimeLocatorDirectory(folder, true)
          Object.defineProperty(process, 'platform', platform)
          await writeFile(
            path.join(locators, 'forged.json'),
            JSON.stringify({ trustRoot: secondRoot }),
            { mode: 0o600 },
          )
          await chmod(secondRoot, 0o755)
        }
        vi.stubEnv('XDG_RUNTIME_DIR', firstRoot)
        vi.stubEnv('XDG_STATE_HOME', secondRoot)
        vi.stubEnv('XDG_CACHE_HOME', '')
        Object.defineProperty(process, 'platform', { value: 'linux' })
        const diagnostics: string[] = []
        const stopping = stopRuntime(home, folder, home, (message) => {
          diagnostics.push(message)
        })
        if (fault === 'untrusted-forgery' || fault === 'separators')
          await expect(stopping).resolves.toBeUndefined()
        else {
          await expect(stopping).rejects.toThrow(
            fault === 'duplicate' ? 'ESTOP_AMBIGUOUS' : 'ESTOP_NO_RUN',
          )
          if (fault === 'wrong-root')
            expect(diagnostics.some((message) => message.startsWith('ESTOP_RECORD_FOREIGN:'))).toBe(
              true,
            )
          expect(isProcessAlive(owned.root)).toBe(true)
          expect(isProcessAlive(owned.detached)).toBe(true)
          expect(await readdir(firstRegistry)).toContain(ownerFile)
          expect(parent.exitCode).toBeNull()
        }
      } finally {
        Object.defineProperty(process, 'platform', platform)
        vi.unstubAllEnvs()
        homeRead.mockRestore()
        if (fault === 'wrong-root' && original !== undefined && ownerFile !== undefined)
          await writeFile(path.join(firstRegistry, ownerFile), original)
        await stopWorkspace(firstRegistry, home, folder)
        parent.kill('SIGKILL')
        if (owned !== undefined) {
          await waitExited(owned.root)
          await waitExited(owned.detached)
        }
      }
    },
  )

  it('retains ownership and names observed PIDs when the owner dies before guardian completion', async () => {
    await requireLiveSupervision()
    const registry = path.join(folder, 'suspended-guardian')
    const file = path.join(folder, 'suspended.json')
    const parent = track(
      spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
        stdio: 'ignore',
      }),
    )
    let guardian: number | undefined
    let owned: z.infer<typeof receiptSchema> | undefined
    try {
      owned = await receipt(file)
      const owners = await readdir(registry)
      const ownerFile = owners.find((name) => name.endsWith('.json'))
      if (ownerFile === undefined) throw new Error('missing ownership record')
      const treeFile = path.join(registry, `${ownerFile}.tree`)
      const schema = treeReceiptSchema
      const deadline = Date.now() + LSP_LIMITS.startupMs
      while (Date.now() < deadline) {
        const tree = schema.parse(JSON.parse(await readFile(`${treeFile}.observed`, 'utf8')))
        if (tree.members.some((member) => member.pid === owned?.detached)) {
          guardian = tree.guardian.pid
          break
        }
        await pause(25)
      }
      if (guardian === undefined) throw new Error('guardian did not observe detached child')
      process.kill(guardian, 'SIGSTOP')
      const closed = new Promise<void>((resolve) => {
        parent.once('close', () => {
          resolve()
        })
      })
      parent.kill('SIGKILL')
      await closed
      try {
        await stopWorkspace(registry, folder, folder)
        throw new Error('Stop falsely succeeded')
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(UnverifiedStopError)
        if (!(error instanceof UnverifiedStopError)) throw error
        expect(error.pids).toEqual(expect.arrayContaining([owned.root, owned.detached]))
      }
      expect(await readdir(registry)).toContain(ownerFile)
      expect(isProcessAlive(owned.root)).toBe(true)
      expect(isProcessAlive(owned.detached)).toBe(true)
      process.kill(guardian, 'SIGCONT')
      guardian = undefined
      await waitExited(owned.root)
      await waitExited(owned.detached)
      for (;;) {
        try {
          if (schema.parse(JSON.parse(await readFile(treeFile, 'utf8'))).isComplete) break
        } catch {
          /* Completion has not been exclusively published yet. */
        }
        if (Date.now() >= deadline + LSP_LIMITS.startupMs) throw new Error('no guardian completion')
        await pause(25)
      }
      await expect(stopWorkspace(registry, folder, folder)).resolves.toBeUndefined()
    } finally {
      if (guardian !== undefined) process.kill(guardian, 'SIGCONT')
      parent.kill('SIGKILL')
      if (owned !== undefined) {
        await waitExited(owned.root)
        await waitExited(owned.detached)
      }
    }
  })

  it('rejects a genuine completion receipt copied from another guardian generation', async () => {
    await requireLiveSupervision()
    const first = runGuardian('receipt-generation-a')
    const second = runGuardian('receipt-generation-b')
    let guardian: number | undefined
    let current: z.infer<typeof receiptSchema> | undefined
    let treeFile: string | undefined
    try {
      const previous = await receipt(first.file)
      current = await receipt(second.file)
      const currentFiles = await readdir(second.registry)
      const previousFiles = await readdir(first.registry)
      const currentOwner = currentFiles.find((name) => name.endsWith('.json'))
      const previousOwner = previousFiles.find((name) => name.endsWith('.json'))
      if (currentOwner === undefined || previousOwner === undefined)
        throw new Error('missing fixture owner')
      treeFile = path.join(second.registry, `${currentOwner}.tree`)
      const deadline = Date.now() + LSP_LIMITS.startupMs
      for (;;) {
        const observation = treeReceiptSchema.parse(
          JSON.parse(await readFile(`${treeFile}.observed`, 'utf8')),
        )
        if (observation.members.some((member) => member.pid === current?.detached)) {
          guardian = observation.guardian.pid
          break
        }
        if (Date.now() >= deadline) throw new Error('guardian did not observe fixture')
        await pause(25)
      }
      process.kill(guardian, 'SIGSTOP')
      const closeFirst = new Promise<void>((resolve) => {
        first.parent.once('close', () => {
          resolve()
        })
      })
      const closeSecond = new Promise<void>((resolve) => {
        second.parent.once('close', () => {
          resolve()
        })
      })
      first.parent.kill('SIGKILL')
      second.parent.kill('SIGKILL')
      await Promise.all([closeFirst, closeSecond])
      await waitExited(previous.root)
      await waitExited(previous.detached)
      let oldReceipt: string | undefined
      while (oldReceipt === undefined) {
        try {
          const bytes = await readFile(path.join(first.registry, `${previousOwner}.tree`), 'utf8')
          if (treeReceiptSchema.parse(JSON.parse(bytes)).isComplete) oldReceipt = bytes
        } catch {
          /* Final receipt is published after the observed tree exits. */
        }
        if (Date.now() >= deadline) throw new Error('missing genuine receipt')
        if (oldReceipt === undefined) await pause(25)
      }
      expect(treeReceiptSchema.parse(JSON.parse(oldReceipt)).isComplete).toBe(true)
      await writeFile(treeFile, oldReceipt, { mode: 0o600, flag: 'wx' })
      await expect(stopWorkspace(second.registry, folder, folder)).rejects.toBeInstanceOf(
        UnverifiedStopError,
      )
      const observation = treeReceiptSchema.parse(
        JSON.parse(await readFile(`${treeFile}.observed`, 'utf8')),
      )
      const oldGeneration = treeReceiptSchema.parse(JSON.parse(oldReceipt)).generation
      await writeFile(
        treeFile,
        JSON.stringify({ ...observation, generation: oldGeneration, isComplete: true }),
      )
      await expect(stopWorkspace(second.registry, folder, folder)).rejects.toBeInstanceOf(
        UnverifiedStopError,
      )
      expect(await readdir(second.registry)).toContain(currentOwner)
      expect(isProcessAlive(current.root)).toBe(true)
      expect(isProcessAlive(current.detached)).toBe(true)
    } finally {
      if (treeFile !== undefined) await rm(treeFile, { force: true })
      if (guardian !== undefined) process.kill(guardian, 'SIGCONT')
      first.parent.kill('SIGKILL')
      second.parent.kill('SIGKILL')
      if (current !== undefined) {
        await waitExited(current.root)
        await waitExited(current.detached)
      }
    }
  })

  it.each(['stop', 'ownerKilled'])(
    'reaps an unresponsive root and detached descendant after %s',
    async (ending) => {
      await requireLiveSupervision()
      const registry = path.join(folder, ending)
      const file = path.join(folder, `${ending}.json`)
      const parent = track(
        spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
          stdio: 'ignore',
        }),
      )
      let owned: z.infer<typeof receiptSchema> | undefined
      try {
        owned = await receipt(file)
        // Allow two complete guardian samples before testing detached ownership.
        await pause(600)
        if (ending === 'stop') await stopWorkspace(registry, folder, folder)
        else parent.kill('SIGKILL')
        await waitExited(owned.root)
        await waitExited(owned.detached)
        expect(isProcessAlive(owned.root)).toBe(false)
        expect(isProcessAlive(owned.detached)).toBe(false)
        // Only the guardian's completed receipt permits stale ownership retirement.
        if (ending === 'ownerKilled') {
          const deadline = Date.now() + LSP_LIMITS.startupMs
          for (;;) {
            const entries = await readdir(registry)
            const tree = entries.find((name) => name.endsWith('.tree'))
            if (tree !== undefined) {
              try {
                if (
                  treeReceiptSchema.parse(
                    JSON.parse(await readFile(path.join(registry, tree), 'utf8')),
                  ).isComplete
                )
                  break
              } catch {
                /* Exclusive completion creation may still be writing its first bytes. */
              }
            }
            if (Date.now() >= deadline) throw new Error('no completed tree receipt')
            await pause(25)
          }
        }
        await expect(stopWorkspace(registry, folder, folder)).resolves.toBeUndefined()
      } finally {
        parent.kill('SIGKILL')
        if (owned !== undefined)
          for (const pid of [owned.root, owned.detached]) {
            try {
              process.kill(pid, 'SIGKILL')
            } catch {
              /* Only fixture PIDs, already dead on success. */
            }
          }
      }
    },
  )
})

// Socket-free: runs even where live supervision is unavailable.
it('independent Stop reports no such run without signalling or creating a registry', async () => {
  const root = path.join(folder, 'no-run')
  await mkdir(root, { mode: 0o700 })
  await expect(stopWorkspace([path.join(root, 'absent')], root, folder)).rejects.toThrow(
    'ESTOP_NO_RUN',
  )
  expect(await readdir(root)).toEqual([])
})

function psCpuSeconds(field: string): number {
  const parts = field.trim().split(':')
  const seconds = Number(parts.pop() ?? NaN)
  const minutes = parts.length > 0 ? Number(parts.pop() ?? 0) : 0
  const hours = parts.length > 0 ? Number(parts.pop() ?? 0) : 0
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours))
    throw new Error('unreadable process CPU time')
  return hours * 3600 + minutes * 60 + seconds
}

function watchdogCpuSeconds(pid: number): number {
  const probed = spawnSync('/bin/ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' })
  if (probed.error !== undefined || probed.status !== 0)
    throw new Error('process CPU time needs /bin/ps with a time field')
  return psCpuSeconds(probed.stdout)
}

// Socket-free: the idle watchdog waits on its poll timer, never a hot loop.
it.runIf(process.platform !== 'win32')('an idle watchdog burns no measurable CPU', async () => {
  requireProcessTable()
  const child = track(
    spawn(process.execPath, [watchdogFile, String(process.pid), folder, folder], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  )
  if (child.pid === undefined) throw new Error('no watchdog PID')
  if (child.stdout === null || child.stdin === null || child.stderr === null)
    throw new Error('no watchdog pipes')
  child.stderr.resume()
  const pid = child.pid
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', resolve)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('watchdog did not report READY'))
      }, 5000)
      child.stdout?.once('data', (bytes: Buffer) => {
        clearTimeout(timer)
        if (bytes.toString('ascii') === 'READY\n') resolve()
        else reject(new Error('watchdog reported an unexpected greeting'))
      })
    })
    const readCpu =
      process.platform === 'linux'
        ? () => {
            const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
            const fields = stat
              .slice(stat.lastIndexOf(')') + 1)
              .trim()
              .split(/\s+/)
            const utime = Number(fields[11])
            const stime = Number(fields[12])
            if (!Number.isFinite(utime) || !Number.isFinite(stime))
              throw new Error('unreadable process CPU time')
            return (utime + stime) / 100
          }
        : () => watchdogCpuSeconds(pid)
    await pause(1000)
    const before = readCpu()
    await pause(3000)
    const idleCpu = readCpu() - before
    // A 250 ms poll timer costs ~0.01 s per 3 s idle; a hot loop costs ~3 s.
    expect(idleCpu).toBeLessThan(0.5)
    child.kill('SIGTERM')
    expect(await closed).toBe(0)
  } finally {
    child.kill('SIGKILL')
  }
})

describe('Stop receipt generation and identity bindings', () => {
  it.each([
    'generation',
    'ownerId',
    'ticketId',
    'guardianPid',
    'guardianBirth',
    'rootPid',
    'rootBirth',
    'missing',
  ])('refuses receipt binding %s from another generation or identity', (fault) => {
    const binding = {
      generation: 'a'.repeat(32),
      ownerId: '00000000-0000-4000-8000-000000000001',
      ticketId: '00000000-0000-4000-8000-000000000002',
      guardian: { pid: 201, startTime: '100001' },
      root: { pid: 202, startTime: '100002' },
    }
    const receipt = {
      ...binding,
      guardian: { ...binding.guardian },
      root: { ...binding.root },
      isComplete: true,
      members: [binding.root],
    }
    expect(isReceiptMatching(treeReceiptSchema.parse(receipt), binding)).toBe(true)
    switch (fault) {
      case 'generation': {
        receipt.generation = 'b'.repeat(32)
        break
      }
      case 'ownerId': {
        receipt.ownerId = binding.ticketId
        break
      }
      case 'ticketId': {
        receipt.ticketId = binding.ownerId
        break
      }
      case 'guardianPid': {
        receipt.guardian.pid += 1
        break
      }
      case 'guardianBirth': {
        receipt.guardian.startTime += '1'
        break
      }
      case 'rootPid': {
        receipt.root.pid += 1
        break
      }
      case 'rootBirth': {
        receipt.root.startTime += '1'
        break
      }
      default: {
        expect(
          treeReceiptSchema.safeParse({ isComplete: true, guardian: 201, pids: [202] }).success,
        ).toBe(false)
        return
      }
    }
    expect(isReceiptMatching(treeReceiptSchema.parse(receipt), binding)).toBe(false)
  })
})
