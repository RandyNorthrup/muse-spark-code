import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { stopWorkspace } from '../../src/runtime/lsp/supervisor'
import { isProcessAlive } from '../../src/host/checkpoints/windowPresence'
import { removeFolder } from './helpers/temporaryFolders'

const folder = await mkdtemp(path.join(tmpdir(), 'muse-watchdog-'))
const parentFile = path.join(folder, 'parent.js')
const watchdogFile = path.join(folder, 'watchdog.js')
await build({
  entryPoints: ['test/unit/helpers/supervisorParent.ts'],
  outfile: parentFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
await build({
  entryPoints: ['src/runtime/lsp/watchdogEntry.ts'],
  outfile: watchdogFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'silent',
})
afterAll(() => removeFolder(folder))
const receiptSchema = z.strictObject({ root: z.int(), detached: z.int() })
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
async function receipt(file: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
        // A dead supervisor's stale record must not block the next independent Stop.
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
