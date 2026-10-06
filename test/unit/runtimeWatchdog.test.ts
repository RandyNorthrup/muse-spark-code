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
import { withoutCredentials } from '../../src/runtime/credentialVariables'

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
  it('fails without signalling a group when its current identities cannot be read', async () => {
    const failing = path.join(folder, 'failing-watchdog.js')
    const source = await readFile('src/runtime/lsp/watchdogEntry.ts', 'utf8')
    const importSite = "import { execFile } from 'node:child_process'"
    expect(source.split(importSite)).toHaveLength(2)
    await build({
      stdin: {
        contents: source.replace(
          importSite,
          () =>
            `import { execFile } from ${JSON.stringify(path.resolve('test/unit/helpers/failingProcessTable.ts'))}`,
        ),
        resolveDir: path.resolve('src/runtime/lsp'),
        sourcefile: 'watchdogEntry.ts',
        loader: 'ts',
      },
      outfile: failing,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      logLevel: 'silent',
    })
    const root = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true,
      stdio: 'ignore',
      env: withoutCredentials(process.env),
    })
    const guard = spawn(process.execPath, [failing, String(process.pid)], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: withoutCredentials(process.env),
    })
    try {
      if (root.pid === undefined) throw new Error('no owned fixture PID')
      const ended = new Promise<number | null>((resolve) => {
        guard.once('close', resolve)
      })
      guard.stdin.end(`${JSON.stringify({ pid: root.pid })}\n`)
      expect(await ended).toBe(1)
      await pause(100)
      expect(isProcessAlive(root.pid)).toBe(true)
    } finally {
      guard.kill('SIGKILL')
      root.kill('SIGKILL')
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
