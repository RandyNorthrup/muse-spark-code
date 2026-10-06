import './helpers/lspPrivateDirectoryMock'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { LSP_LIMITS } from '../../src/shared/constants'
import { stopWorkspace, UnverifiedStopError } from '../../src/runtime/lsp/supervisor'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
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
async function waitExited(pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) return
    await pause(50)
  }
  throw new Error(`owned fixture still alive: ${String(pid)}`)
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
      const schema = z.strictObject({
        isComplete: z.boolean(),
        guardian: z.int(),
        pids: z.array(z.int()),
      })
      const deadline = Date.now() + LSP_LIMITS.startupMs
      while (Date.now() < deadline) {
        const tree = schema.parse(JSON.parse(await readFile(treeFile, 'utf8')))
        if (tree.pids.includes(owned.detached)) {
          guardian = tree.guardian
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
        await stopWorkspace(registry, folder)
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
      while (!schema.parse(JSON.parse(await readFile(treeFile, 'utf8'))).isComplete) {
        if (Date.now() >= deadline + LSP_LIMITS.startupMs) throw new Error('no guardian completion')
        await pause(25)
      }
      await expect(stopWorkspace(registry, folder)).resolves.toBeUndefined()
    } finally {
      if (guardian !== undefined) process.kill(guardian, 'SIGCONT')
      parent.kill('SIGKILL')
      if (owned !== undefined) {
        await waitExited(owned.root)
        await waitExited(owned.detached)
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
        if (ending === 'stop') await stopWorkspace(registry, folder)
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
            if (
              tree !== undefined &&
              z
                .object({ isComplete: z.boolean() })
                .parse(JSON.parse(await readFile(path.join(registry, tree), 'utf8'))).isComplete
            )
              break
            if (Date.now() >= deadline) throw new Error('no completed tree receipt')
            await pause(25)
          }
        }
        await expect(stopWorkspace(registry, folder)).resolves.toBeUndefined()
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
