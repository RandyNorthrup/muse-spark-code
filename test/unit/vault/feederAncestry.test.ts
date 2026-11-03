import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  hasVaultFeederAncestry,
  type VaultAncestryPort,
  type VaultProcessIdentity,
} from '../../../src/core/vault/broker/peer'
import { compileVaultPeerHelper } from '../helpers/vault/peerBuild'

// RLF-M109H item 3 on real processes, reviewed by RVM109H: the broker's
// feeder ancestry walk binds every step to the start time recorded for
// that pid, and the helper's `parent` mode refuses unless the process
// it reads still has that exact birth. A pid recycled between the
// walk's re-read and the helper cannot answer. The chain is this test
// process -> a real node child -> a real sleep it spawns, and every
// identity is read from the kernel by the compiled shipped helper.
// The recycled-pid case cannot be forced against the real allocator
// (a pid-space wrap is not run on a shared rig), so it is composed
// from two real kernel readings: the intermediate's pid answered with
// another real process's start time, which is exactly what a recycled
// pid presents. The helper cases pass the leaf's real birth and a
// different one.

/** Compiling the shipped C helper takes seconds on a loaded rig. */
const BUILD_TIMEOUT_MS = 60_000
/** The intermediate prints its leaf's pid once both processes are up. */
const CHAIN_TIMEOUT_MS = 30_000
/** Reparenting after the intermediate dies is observed, never assumed. */
const REPARENT_TIMEOUT_MS = 30_000
const isPosix = process.platform === 'linux' || process.platform === 'darwin'

const state: {
  helper: string
  dispose?: () => Promise<void>
  intermediate?: ChildProcess
  stranger?: ChildProcess
  leafPid: number
  leaf?: VaultProcessIdentity
  strangerIdentity?: VaultProcessIdentity
} = { helper: '', leafPid: 0 }

const execFileAsync = promisify(execFile)

/**
One kernel identity from the compiled helper, run directly as the
broker fixtures also run it (the product probe in posixNative rides
the installed host's resource admission, which the delegated suite
configures and this walk test does not replace). Exit 2 proves the
process gone, exactly as the product probe reads it.
*/
async function identityViaHelper(
  mode: 'identity' | 'parent',
  pid: number,
  expectedStartedAt?: number,
): Promise<VaultProcessIdentity | null> {
  const args = [mode, String(pid)]
  if (mode === 'parent') {
    if (typeof expectedStartedAt !== 'number') throw new TypeError('No access')
    args.push(String(expectedStartedAt))
  }
  // The product probe's own shape: exit 2 proves absence, exit 1 gets one
  // fresh probe, and anything else is the fixed refusal.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { stdout } = await execFileAsync(state.helper, args, {
        encoding: 'utf8',
      })
      const found: unknown = JSON.parse(stdout)
      if (typeof found !== 'object' || found === null) throw new TypeError('malformed identity')
      const { processId, userId, startedAt, executable } = found as Record<string, unknown>
      if (
        typeof processId !== 'number' ||
        typeof userId !== 'string' ||
        typeof startedAt !== 'number' ||
        typeof executable !== 'string'
      )
        throw new TypeError('malformed identity')
      return { processId, userId, startedAt, executable }
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code === 2) return null
      if (attempt === 0 && code === 1) continue
      throw new Error('No access', { cause: error })
    }
  }
  throw new Error('No access')
}

/**
The broker reads a thrown probe and a false walk the same way: refused.
Ancestors above this test process (launchd and its kin) are not
readable by the helper, so a walk that passes the test process without
finding its requester ends in the probe's fixed refusal, not a false.
*/
async function isWalkRefused(walk: Promise<boolean>): Promise<boolean> {
  try {
    return !(await walk)
  } catch {
    // The fixed refusal from an unreadable ancestor above the requester.
    return true
  }
}

const processIdentity = async (pid: number): Promise<VaultProcessIdentity | null> =>
  await identityViaHelper('identity', pid)
const parentIdentity = async (
  pid: number,
  expectedStartedAt: number,
): Promise<VaultProcessIdentity | null> => await identityViaHelper('parent', pid, expectedStartedAt)

const port = (): VaultAncestryPort => ({ processIdentity, parentIdentity })

async function startChain(): Promise<void> {
  const script = [
    "const { spawn } = require('node:child_process')",
    "const leaf = spawn('/bin/sh', ['-c', 'sleep 60'], { stdio: 'ignore' })",
    String.raw`process.stdout.write(String(leaf.pid) + '\n')`,
    'setTimeout(() => {}, 60_000)',
  ].join('\n')
  const intermediate = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  state.intermediate = intermediate
  state.leafPid = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('the chain did not report its leaf pid'))
    }, CHAIN_TIMEOUT_MS)
    intermediate.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('the intermediate exited before reporting its leaf pid'))
    })
    intermediate.stdout.once('data', (bytes: Buffer) => {
      clearTimeout(timer)
      resolve(Number(bytes.toString('utf8').trim()))
    })
  })
  const leaf = await processIdentity(state.leafPid)
  if (!leaf) throw new Error('the leaf has no kernel identity')
  state.leaf = leaf
  state.stranger = spawn('/bin/sh', ['-c', 'sleep 60'], { stdio: 'ignore' })
  if (state.stranger.pid === undefined) throw new Error('the stranger did not start')
  const stranger = await processIdentity(state.stranger.pid)
  if (!stranger) throw new Error('the stranger has no kernel identity')
  state.strangerIdentity = stranger
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (child?.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve()
    })
  })
}

beforeAll(async () => {
  if (!isPosix) return
  const built = await compileVaultPeerHelper('vault-feeder-ancestry-')
  state.helper = built.helper
  state.dispose = built.dispose
  await startChain()
}, BUILD_TIMEOUT_MS + CHAIN_TIMEOUT_MS)

afterAll(async () => {
  await stop(state.intermediate)
  await stop(state.stranger)
  if (state.leafPid > 0) {
    try {
      process.kill(state.leafPid, 'SIGKILL')
    } catch {
      // The leaf is already gone (its sleep ended or the kill above raced it).
    }
  }
  await state.dispose?.()
})

describe.skipIf(!isPosix)('feeder ancestry walk (RLF-M109H)', () => {
  it('accepts a real leaf whose ancestry reaches this process', async () => {
    const leaf = state.leaf
    if (!leaf) throw new Error('the chain did not start')
    await expect(hasVaultFeederAncestry(leaf, process.pid, port())).resolves.toBe(true)
  })

  it('refuses the same leaf for a requester outside its ancestry', async () => {
    const leaf = state.leaf
    const stranger = state.strangerIdentity
    if (!leaf || !stranger) throw new Error('the chain did not start')
    await expect(
      isWalkRefused(hasVaultFeederAncestry(leaf, stranger.processId, port())),
    ).resolves.toBe(true)
  })

  it('refuses when an intermediate pid answers with another process start time', async () => {
    const leaf = state.leaf
    const stranger = state.strangerIdentity
    const intermediate = state.intermediate
    if (!leaf || !stranger || intermediate?.pid === undefined)
      throw new Error('the chain did not start')
    const intermediatePid = intermediate.pid
    const real = port()
    const recycled: VaultAncestryPort = {
      processIdentity: async (pid) => {
        const found = await real.processIdentity(pid)
        // A recycled pid presents the same pid with a different birth:
        // here the intermediate's pid answered with the stranger's real
        // kernel start time, as the reuse of its pid would present.
        return found && pid === intermediatePid
          ? { ...found, startedAt: stranger.startedAt }
          : found
      },
      parentIdentity: real.parentIdentity,
    }
    await expect(hasVaultFeederAncestry(leaf, process.pid, recycled)).resolves.toBe(false)
  })

  it('reports the parent when the recorded birth is the live one', async () => {
    const leaf = state.leaf
    const intermediate = state.intermediate
    if (!leaf || intermediate?.pid === undefined) throw new Error('the chain did not start')
    const parent = await parentIdentity(leaf.processId, leaf.startedAt)
    expect(parent?.processId).toBe(intermediate.pid)
  })

  it('refuses a parent read whose recorded birth is not the live one', async () => {
    const leaf = state.leaf
    if (!leaf) throw new Error('the chain did not start')
    await expect(parentIdentity(leaf.processId, leaf.startedAt + 1)).rejects.toThrow('No access')
  })

  it(
    'refuses after the intermediate really dies and the leaf reparents',
    async () => {
      const leaf = state.leaf
      const intermediate = state.intermediate
      if (!leaf || intermediate?.pid === undefined) throw new Error('the chain did not start')
      const intermediatePid = intermediate.pid
      await stop(intermediate)
      const deadline = Date.now() + REPARENT_TIMEOUT_MS
      // The reparented leaf's new parent (launchd on macOS) is not
      // readable by the helper, so "no longer the intermediate" can
      // present as the probe's fixed refusal; both prove the reparent.
      let parentPid: number | null = intermediatePid
      while (parentPid === intermediatePid && Date.now() < deadline) {
        try {
          const parent = await parentIdentity(leaf.processId, leaf.startedAt)
          parentPid = parent?.processId ?? null
        } catch {
          // The new parent is unreadable: the leaf no longer hangs off the intermediate.
          parentPid = null
        }
        if (parentPid === intermediatePid)
          await new Promise((resolve) => {
            setTimeout(resolve, 50)
          })
      }
      expect(parentPid).not.toBe(intermediatePid)
      await expect(isWalkRefused(hasVaultFeederAncestry(leaf, process.pid, port()))).resolves.toBe(
        true,
      )
    },
    REPARENT_TIMEOUT_MS + CHAIN_TIMEOUT_MS,
  )
})
