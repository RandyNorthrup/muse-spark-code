import './helpers/lspPrivateDirectoryMock'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { treeReceiptSchema, isReceiptMatching } from '../../src/runtime/lsp/stopReceipt'
import { LSP_LIMITS } from '../../src/shared/constants'
import { stopWorkspace, UnverifiedStopError } from '../../src/runtime/lsp/supervisor'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
import { runProgram } from '../../src/host/processTree'
import { removeFolder } from './helpers/temporaryFolders'

const folder = await mkdtemp(path.join(tmpdir(), 'muse-watchdog-'))
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
async function isRunning(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return false
  try {
    const output = await runProgram('/bin/ps', ['-o', 'stat=', '-p', String(pid)], {})
    const state = z.string().check(z.minLength(1)).parse(output.trim())
    // M107 counts zombies as exited; kill(pid, 0) alone still sees their PID slot.
    return !state.startsWith('Z')
  } catch (error: unknown) {
    if (!isProcessAlive(pid)) return false
    throw error
  }
}
async function waitExited(pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await isRunning(pid))) return
    await pause(50)
  }
  throw new Error(`owned fixture still alive: ${String(pid)}`)
}

function runGuardian(label: string) {
  const registry = path.join(folder, label)
  const file = path.join(folder, `${label}.json`)
  const parent = spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
    stdio: 'ignore',
  })
  return { registry, file, parent }
}

// Windows uses the kill-on-close job instead, exercised by runtimeSupervisor.test.ts.
describe.skipIf(process.platform === 'win32')('M104L independent POSIX guardian', () => {
  it('retains ownership and names observed PIDs when the owner dies before guardian completion', async () => {
    const registry = path.join(folder, 'suspended-guardian')
    const file = path.join(folder, 'suspended.json')
    const parent = spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
      stdio: 'ignore',
    })
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
    'reaps a busy root and detached descendant after %s',
    async (ending) => {
      const registry = path.join(folder, ending)
      const file = path.join(folder, `${ending}.json`)
      const parent = spawn(process.execPath, [parentFile, registry, folder, watchdogFile, file], {
        stdio: 'ignore',
      })
      let owned: z.infer<typeof receiptSchema> | undefined
      try {
        owned = await receipt(file)
        // Allow two complete guardian samples before testing detached ownership.
        await pause(600)
        if (ending === 'stop') await stopWorkspace(registry, folder, folder)
        else parent.kill('SIGKILL')
        await waitExited(owned.root)
        await waitExited(owned.detached)
        expect(await isRunning(owned.root)).toBe(false)
        expect(await isRunning(owned.detached)).toBe(false)
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
