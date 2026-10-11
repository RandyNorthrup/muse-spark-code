import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import * as z from 'zod/mini'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  NodeVaultFiles,
  VaultStore,
  type VaultGenerationState,
} from '../../../src/core/vault/store'
import { KeyringVaultAnchor } from '../../../src/runtime/vault/keyringAnchor'
import { nodeLeasePort } from '../../../src/core/locks/nodeLeasePort'
import { createRecoverySlot } from '../../../src/core/vault/keyslots'
import { VAULT_WRITER_LEASE_MS, VAULT_WRITER_RENEW_MS } from '../../../src/shared/constants'
import { removeFolder } from '../helpers/temporaryFolders'

// Only generated vault material and a file-backed fake anchor. The writer,
// copy, intent, recovery and fence are production code; native DACL/OS-store
// qualification remains with windowsVaultChannel and the native owners.
const childSource = `
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/mini';
import { NodeVaultFiles, VaultStore } from './src/core/vault/store';
import { createRecoverySlot } from './src/core/vault/keyslots';
async function main() {
const [root, operation, stop] = process.argv.slice(2);
const hit = async (stage) => {
  if (stage === stop) { process.send({stage: stage}); await new Promise(() => {}); }
};
const anchorPath = path.join(root, 'anchor.json');
const loseFence = () => writeFile(path.join(root, 'writer.lock.fences', '0000000000000100'), '');
const anchor = {
  minimum: async () => { try { return JSON.parse(await readFile(anchorPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
  advance: async (_id, next, prior, assertHeld) => {
    if (JSON.stringify(await anchor.minimum()) !== JSON.stringify(prior)) throw Error('prior');
    await hit('before-anchor'); assertHeld();
    await writeFile(anchorPath, JSON.stringify(next));
  },
};
const security = {
  protect: async (file) => { if (file.endsWith('.quarantine.stage')) {
    if (operation === 'quarantine-publish') await loseFence(); await hit('after-copy'); } },
  verify: async (file) => { if (file.endsWith('.quarantine')) await hit('after-publish'); },
};
const files = new NodeVaultFiles(root, 1024 * 1024, security, 'win32');
const quarantine = files.quarantine.bind(files);
files.quarantine = async (...args) => { await hit('before-copy'); return await quarantine(...args); };
const vaultId = 'a'.repeat(32), key = Buffer.alloc(32, 1), options = {files, anchor, key};
if (operation === 'probe') {
  const attempt = async (operation) => {
    try {
      if (operation === 'open') { const store = await VaultStore.open(options, vaultId); store.lock(); }
      else if (operation === 'restore') { const store = await VaultStore.restore(options,
        JSON.parse(await readFile(path.join(root, 'backup.json'), 'utf8')), undefined, true); store.lock(); }
      else await VaultStore.resetLost(files, vaultId, 'generated reset', () => {}, async (held) => {
        held(); await writeFile(anchorPath, 'null'); }, anchor, await anchor.minimum());
      process.send({done: true});
    } catch (error) { process.send({error: error.code ?? error.message}); }
  };
  process.on('message', async (input) => {
    const request = z.enum(['open', 'reset', 'restore']).parse(input); await attempt(request);
  });
  await attempt('open'); return;
}
try {
  if (operation === 'prepare') {
    const {slot} = createRecoverySlot(key, vaultId, {now: () => 0});
    const store = await VaultStore.create(options, vaultId, [slot]);
    await writeFile(path.join(root, 'backup.json'), JSON.stringify(await store.exportSnapshot()));
    store.lock();
    await writeFile(path.join(root, 'vault.v1'), 'generated damaged document');
  } else if (operation === 'reset') {
    await VaultStore.resetLost(files, vaultId, 'generated reset', () => {}, async (assertHeld) => {
      await hit('before-anchor'); assertHeld(); await writeFile(anchorPath, 'null');
    }, anchor, await anchor.minimum());
  } else if (operation === 'restore') {
    const store = await VaultStore.restore(options,
      JSON.parse(await readFile(path.join(root, 'backup.json'), 'utf8')), undefined, true);
    store.lock();
  } else if (operation === 'open') {
    const store = await VaultStore.open(options, vaultId); store.lock();
  } else if (operation === 'hold') {
    await files.withWriter(async () => { await hit('holding'); });
  } else {
    await files.withWriter(async () => {
      if (operation !== 'quarantine-publish') await loseFence();
      if (operation === 'fence') await files.writeAtomic('vault.v1', Buffer.from('forbidden'));
      else if (operation === 'remove') await files.remove('vault.v1');
      else await files.quarantine('vault.v1');
    });
  }
  process.send({done: true});
} catch (error) { process.send({error: error.code ?? error.message}); }
finally { key.fill(0); process.disconnect(); }
}
void main();
`

const resultSchema = z.union([
  z.strictObject({ done: z.literal(true) }),
  z.strictObject({ stage: z.string() }),
  z.strictObject({ error: z.string() }),
])
const stateSchema = z.strictObject({
  generation: z.number(),
  auditGeneration: z.number(),
  auditHead: z.string(),
  stateDigest: z.string(),
})

describe('production vault writer across process death', () => {
  let root: string
  let entry: string
  const children: ChildProcess[] = []
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'm109-writer-'))
    entry = path.join(root, 'writer.cjs')
    await build({
      stdin: { contents: childSource, resolveDir: process.cwd(), loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile: entry,
    })
  })
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    // Node uses TerminateProcess on Windows; SIGKILL on POSIX, without finally.
    child.kill('SIGKILL')
    await exited
  }
  afterAll(async () => {
    vi.useRealTimers()
    for (const child of children) await stop(child)
    await removeFolder(root)
  })
  async function run(folder: string, operation: string, stage = '') {
    const child = spawn(process.execPath, [entry, folder, operation, stage], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    children.push(child)
    child.stderr?.resume()
    const message = once(child, 'message')
    const exited = once(child, 'exit')
    const unexpectedExit = async () => {
      await exited
      throw new Error('writer exited before its result')
    }
    const messages: unknown[] = await Promise.race([message, unexpectedExit()])
    if (!stage) await exited
    return { child, result: resultSchema.parse(messages[0]) }
  }
  async function finish(folder: string, operation: string) {
    const { result } = await run(folder, operation)
    return result
  }
  async function prepare() {
    const folder = await mkdtemp(path.join(root, 'vault-'))
    expect(await finish(folder, 'prepare')).toEqual({ done: true })
    return folder
  }
  it.each(
    ['reset', 'restore'].flatMap((operation) =>
      ['before-copy', 'after-copy', 'after-publish', 'before-anchor'].map((stage) => ({
        operation,
        stage,
      })),
    ),
  )('$operation recovers after TerminateProcess at $stage', async ({ operation, stage }) => {
    const folder = await prepare()
    const { child, result } = await run(folder, operation, stage)
    expect(result).toEqual({ stage })
    await stop(child)
    const names = await readdir(folder)
    const survivors = names.filter((name) => name === 'vault.v1' || name.endsWith('.quarantine'))
    expect(survivors.length).toBeGreaterThan(0)
    for (const name of survivors)
      expect(await readFile(path.join(folder, name), 'utf8')).toBe('generated damaged document')
    expect(names).toContain('writer.lock')
    const recovery = operation === 'restore' && stage === 'before-anchor' ? 'open' : operation
    expect(await finish(folder, recovery)).toEqual({ done: true })
    const recoveredNames = await readdir(folder)
    expect(recoveredNames.some((name) => name.endsWith('.quarantine.stage'))).toBe(false)
    expect(recoveredNames).not.toContain('writer.lock')
    if (operation === 'reset')
      expect(await readFile(path.join(folder, 'anchor.json'), 'utf8')).toBe('null')
    else expect(await finish(folder, 'open')).toEqual({ done: true })
  })
  it('never takes a live holder in a two-process writer race', async () => {
    const folder = await prepare()
    const holder = await run(folder, 'hold', 'holding')
    try {
      expect(await finish(folder, 'restore')).toEqual({ error: 'busy' })
      expect(await readFile(path.join(folder, 'vault.v1'), 'utf8')).toBe(
        'generated damaged document',
      )
    } finally {
      await stop(holder.child)
    }
  })
  // Real suspension must exceed three production leases; a named per-test bound covers that wait.
  const SUSPENSION_TEST_TIMEOUT_MS = VAULT_WRITER_LEASE_MS * 5
  it.runIf(process.platform === 'win32')(
    'a suspended real writer excludes every successor beyond three leases',
    async () => {
      const folder = await prepare()
      const holder = await run(folder, 'restore', 'before-anchor')
      expect(holder.result).toEqual({ stage: 'before-anchor' })
      const pid = holder.child.pid
      const systemRoot = process.env['SystemRoot']
      if (pid === undefined || systemRoot === undefined)
        throw new Error('fixture process unavailable')
      const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class M109Suspend { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle); }'; $held = Get-Process -Id ${String(pid)}; try { if ([M109Suspend]::NtSuspendProcess($held.Handle) -ne 0) { throw 'suspension failed' } } finally { $held.Dispose() }`
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(
            path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
            { windowsHide: true },
            (error) => {
              if (error instanceof Error) reject(error)
              else resolve()
            },
          )
        })
        const contender = await run(folder, 'probe', 'first-probe')
        try {
          expect(contender.result).toEqual({ error: 'busy' })
          for (const operation of ['open', 'reset', 'restore']) {
            await delay(VAULT_WRITER_LEASE_MS + 1)
            const message = once(contender.child, 'message')
            contender.child.send(operation)
            const reply: unknown[] = await message
            expect(resultSchema.parse(reply[0])).toEqual({ error: 'busy' })
            expect(holder.child.exitCode).toBeNull()
            expect(await readdir(folder)).toContain('pending.v1')
          }
        } finally {
          await stop(contender.child)
        }
      } finally {
        await stop(holder.child)
      }
      expect(await finish(folder, 'open')).toEqual({ done: true })
      expect(await readdir(folder)).not.toContain('pending.v1')
      expect(await readdir(folder)).not.toContain('writer.lock')
    },
    SUSPENSION_TEST_TIMEOUT_MS,
  )
  it('retains an interrupted quarantine stage when its original is missing', async () => {
    const folder = await prepare()
    const interrupted = await run(folder, 'restore', 'after-copy')
    expect(interrupted.result).toEqual({ stage: 'after-copy' })
    await stop(interrupted.child)
    const stageNames = await readdir(folder)
    const stage = stageNames.find((name) => name.endsWith('.quarantine.stage'))
    if (!stage) throw new Error('interrupted copy missing')
    await unlink(path.join(folder, 'vault.v1'))
    expect(await finish(folder, 'restore')).toHaveProperty('error')
    expect(await readFile(path.join(folder, stage), 'utf8')).toBe('generated damaged document')
  })
  it.each(['fence', 'remove', 'quarantine', 'quarantine-publish'])(
    'refuses a lost fence at %s',
    async (operation) => {
      const folder = await prepare()
      expect(await finish(folder, operation)).toEqual({ error: 'busy' })
      expect(await readFile(path.join(folder, 'vault.v1'), 'utf8')).toBe(
        'generated damaged document',
      )
      const names = await readdir(folder)
      expect(names.some((name) => name.endsWith('.quarantine'))).toBe(false)
      expect(names.some((name) => name.endsWith('.quarantine.stage'))).toBe(
        operation === 'quarantine-publish',
      )
    },
  )
  it.each(['advance', 'reset'] as const)(
    'fences the protected anchor %s after its awaited read',
    async (operation) => {
      const folder =
        operation === 'reset' ? await prepare() : await mkdtemp(path.join(root, 'anchor-'))
      const files = new NodeVaultFiles(folder, 1024 * 1024, {
        protect: () => Promise.resolve(),
        verify: () => Promise.resolve(),
      })
      const value: unknown =
        operation === 'reset'
          ? JSON.parse(await readFile(path.join(folder, 'anchor.json'), 'utf8'))
          : null
      const expected: VaultGenerationState | null = value === null ? null : stateSchema.parse(value)
      const vaultId = 'a'.repeat(32)
      let raw = expected ? JSON.stringify({ v: 1, vaultId, ...expected }) : undefined
      let writes = 0
      const anchor = new KeyringVaultAnchor(() => ({
        getPassword: async () => {
          const names = await readdir(folder)
          if (
            (operation === 'advance' && names.includes('pending.v1')) ||
            (operation === 'reset' && !names.includes('vault.v1'))
          ) {
            await writeFile(path.join(folder, 'writer.lock.fences', '0000000000000100'), '')
          }
          return raw
        },
        setPassword: (next) => {
          writes += 1
          raw = next
          return Promise.resolve()
        },
        deletePassword: () => {
          writes += 1
          raw = undefined
          return Promise.resolve(true)
        },
      }))
      const key = Buffer.alloc(32, 1)
      try {
        const work =
          operation === 'reset'
            ? VaultStore.resetLost(
                files,
                vaultId,
                'generated reset',
                () => undefined,
                (assertHeld) => anchor.reset(vaultId, expected, assertHeld),
                anchor,
                expected,
              )
            : VaultStore.create({ files, anchor, key }, vaultId, [
                createRecoverySlot(key, vaultId, { now: () => 0 }).slot,
              ])
        await expect(work).rejects.toMatchObject({ code: 'busy' })
        expect(writes).toBe(0)
      } finally {
        key.fill(0)
      }
    },
  )
  async function nativeWriterFixture() {
    const folder = await prepare()
    return {
      folder,
      files: new NodeVaultFiles(folder, 1024, {
        protect: () => Promise.resolve(),
        verify: () => Promise.resolve(),
      }),
    }
  }
  it('preserves the successor fence while the prior writer release settles', async () => {
    const { folder, files } = await nativeWriterFixture()
    const paused = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const unlink = nodeLeasePort.unlink
    let isPaused = false
    const spy = vi.spyOn(nodeLeasePort, 'unlink').mockImplementation(async (file) => {
      await unlink(file)
      if (isPaused || !file.endsWith('.retired')) return
      isPaused = true
      paused.resolve(undefined)
      await resume.promise
    })
    const first = files.withWriter(() => Promise.resolve())
    try {
      await paused.promise
      let isEntered = false
      const next = files.withWriter(async () => {
        isEntered = true
        await writeFile(path.join(folder, 'writer.lock.fences', '0000000000000100'), '')
        await expect(files.writeAtomic('vault.v1', Buffer.from('forbidden'))).rejects.toMatchObject(
          { code: 'busy' },
        )
      })
      const settled = Promise.allSettled([next])
      await new Promise(setImmediate)
      expect(isEntered).toBe(false)
      resume.resolve(undefined)
      await first
      await expect(next).rejects.toMatchObject({ code: 'busy' })
      await settled
      expect(isEntered).toBe(true)
      expect(await readFile(path.join(folder, 'vault.v1'), 'utf8')).toBe(
        'generated damaged document',
      )
    } finally {
      resume.resolve(undefined)
      await first
      spy.mockRestore()
    }
  })
  it('serializes overlapping scopes after a displaced lease until the old operation settles', async () => {
    const { folder, files } = await nativeWriterFixture()
    const paused = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const first = files.withWriter(async () => {
      paused.resolve(undefined)
      await resume.promise
      await expect(files.writeAtomic('vault.v1', Buffer.from('forbidden'))).rejects.toMatchObject({
        code: 'busy',
      })
    })
    const settled = Promise.allSettled([first])
    try {
      await paused.promise
      await unlink(path.join(folder, 'writer.lock'))
      let isEntered = false
      const next = files.withWriter(() => {
        isEntered = true
        return Promise.resolve()
      })
      await new Promise(setImmediate)
      expect(isEntered).toBe(false)
      resume.resolve(undefined)
      await expect(first).rejects.toMatchObject({ code: 'busy' })
      await next
      expect(isEntered).toBe(true)
      expect(await readFile(path.join(folder, 'vault.v1'), 'utf8')).toBe(
        'generated damaged document',
      )
    } finally {
      resume.resolve(undefined)
      await settled
    }
  })
  it('renews its owner-bound note while the production transaction is running', async () => {
    const { folder, files } = await nativeWriterFixture()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      await files.withWriter(async () => {
        await vi.advanceTimersByTimeAsync(VAULT_WRITER_RENEW_MS)
        await vi.waitFor(async () => {
          const note: unknown = JSON.parse(await readFile(path.join(folder, 'writer.lock'), 'utf8'))
          expect(note).toMatchObject({ renewal: 1, owner: { pid: process.pid } })
        })
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
