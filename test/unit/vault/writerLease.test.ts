import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, realpath, unlink, writeFile } from 'node:fs/promises'
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
import { VaultWriterError } from '../../../src/core/vault/crypto'
import { createEncryptedBackup, restoreEncryptedBackup } from '../../../src/core/vault/backup'
import { exactCurrentProcessOwner } from '../../../src/core/locks/processOwner'
import { VaultManagementError } from '../../../src/core/vault/broker/ports'
import { vaultRefusalMessage } from '../../../src/core/vault/broker/manageClient'
import {
  VAULT_WRITER_LEASE_MS,
  VAULT_WRITER_RENEW_MS,
  UI_TEXT,
} from '../../../src/shared/constants'
import { removeFolder } from '../helpers/temporaryFolders'
import { exitedProcessId } from '../helpers/leaseFs'
import { item } from '../helpers/vault/fixtures'
import { MemoryVaultAnchor } from './storeFixtures'

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
  } else if (operation === 'restore' || operation === 'restore-recovery') {
    const store = await VaultStore.restore(options,
      JSON.parse(await readFile(path.join(root, 'backup.json'), 'utf8')), undefined, true,
      operation === 'restore-recovery' ? (await files.writerRecovery())?.token : undefined);
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

function stageNote(owner: unknown, id: string) {
  return JSON.stringify({ owner, id, renewal: 0, acquiredAt: Date.now(), leaseMs: 1000 })
}

/** A lock note as the lease reads it: owner facts, never paths or values. */
async function writeLockNote(folder: string, owner: Record<string, unknown>, id: string) {
  await writeFile(
    path.join(folder, 'writer.lock'),
    JSON.stringify({ owner, id, renewal: 0, acquiredAt: 1000, leaseMs: 1000 }),
  )
}

/** Runs with every platform identity folder under a file, so self readings fail. */
async function withBlockedIdentity<T>(blocking: string, run: () => Promise<T>): Promise<T> {
  const saved = {
    xdg: process.env['XDG_DATA_HOME'],
    local: process.env['LOCALAPPDATA'],
    home: process.env['HOME'],
  }
  process.env['XDG_DATA_HOME'] = blocking
  process.env['LOCALAPPDATA'] = blocking
  process.env['HOME'] = blocking
  try {
    return await run()
  } finally {
    if (saved.xdg === undefined) delete process.env['XDG_DATA_HOME']
    else process.env['XDG_DATA_HOME'] = saved.xdg
    if (saved.local === undefined) delete process.env['LOCALAPPDATA']
    else process.env['LOCALAPPDATA'] = saved.local
    if (saved.home === undefined) delete process.env['HOME']
    else process.env['HOME'] = saved.home
  }
}

describe('production vault writer across process death', () => {
  let root: string
  let entry: string
  const children: ChildProcess[] = []
  beforeAll(async () => {
    root = await mkdtemp(path.join(await realpath(tmpdir()), 'm109-writer-'))
    // The writer's installation identity must never touch the developer's
    // real data folder: every platform's folder resolves under this test's
    // own directory (Linux XDG_DATA_HOME, Windows LOCALAPPDATA, macOS HOME).
    const machineScope = await mkdtemp(path.join(root, 'machine-scope-'))
    process.env['XDG_DATA_HOME'] = machineScope
    process.env['LOCALAPPDATA'] = machineScope
    process.env['HOME'] = machineScope
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
  /** A vault folder with a production writer, created but never opened. */
  async function writerFolder(prefix: string) {
    const folder = await mkdtemp(path.join(root, prefix))
    const files = new NodeVaultFiles(folder, 1024 * 1024, {
      protect: () => Promise.resolve(),
      verify: () => Promise.resolve(),
    })
    return { folder, files }
  }
  /** An openable generated vault: created and locked, never written after. */
  async function openableVault(prefix: string, id: string) {
    const { folder, files } = await writerFolder(prefix)
    const anchor = new MemoryVaultAnchor()
    const key = Buffer.alloc(32, 7)
    const vaultId = id.repeat(32)
    const options = { files, anchor, key }
    const { slot } = createRecoverySlot(key, vaultId, { now: () => 0 })
    const created = await VaultStore.create(options, vaultId, [slot])
    return { folder, files, anchor, key, options, vaultId, created, slot }
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
  it.each(['', '{', 'foreign'])('confirmed Restore recovers a %j writer note', async (kind) => {
    const folder = await prepare()
    await writeFile(
      path.join(folder, 'writer.lock'),
      kind === 'foreign'
        ? JSON.stringify({
            owner: {
              host: 'foreign-host',
              machineId: 'foreign',
              bootId: 'boot',
              pidNamespace: 'native',
              pid: 123,
              processStart: 0,
              exactBirth: 'birth',
            },
            id: 'foreign',
            acquiredAt: 1000,
            leaseMs: 0,
          })
        : kind,
    )
    expect(await finish(folder, 'restore')).toEqual({ error: 'busy' })
    expect(await finish(folder, 'restore-recovery')).toEqual({ done: true })
    expect(await finish(folder, 'open')).toEqual({ done: true })
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
  it(
    'a suspended real writer excludes every successor beyond three leases',
    async () => {
      const folder = await prepare()
      const holder = await run(folder, 'restore', 'before-anchor')
      expect(holder.result).toEqual({ stage: 'before-anchor' })
      const pid = holder.child.pid
      const systemRoot = process.env['SystemRoot']
      if (pid === undefined || (systemRoot === undefined && process.platform === 'win32'))
        throw new Error('fixture process unavailable')
      const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class M109Suspend { [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle); }'; $held = Get-Process -Id ${String(pid)}; try { if ([M109Suspend]::NtSuspendProcess($held.Handle) -ne 0) { throw 'suspension failed' } } finally { $held.Dispose() }`
      try {
        if (process.platform === 'win32') {
          await new Promise<void>((resolve, reject) => {
            execFile(
              path.join(
                systemRoot ?? '',
                'System32',
                'WindowsPowerShell',
                'v1.0',
                'powershell.exe',
              ),
              ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
              { windowsHide: true, timeout: 10_000 },
              (error) => {
                if (error instanceof Error) reject(error)
                else resolve()
              },
            )
          })
        } else {
          holder.child.kill('SIGSTOP')
        }
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
  it('checks ownership without rewriting its complete note during a running transaction', async () => {
    const { folder, files } = await nativeWriterFixture()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      await files.withWriter(async (held) => {
        const before = await readFile(path.join(folder, 'writer.lock'))
        await vi.advanceTimersByTimeAsync(VAULT_WRITER_RENEW_MS)
        held()
        expect(await readFile(path.join(folder, 'writer.lock'))).toEqual(before)
        const note: unknown = JSON.parse(before.toString('utf8'))
        expect(note).toMatchObject({ renewal: 0, owner: { pid: process.pid } })
      })
    } finally {
      vi.useRealTimers()
    }
  })
  it('refuses an unreadable writer with its own Reset sentence, not the busy window', () => {
    const refusal = new VaultWriterError({ kind: 'unreadable' })
    expect(refusal.code).toBe('busy')
    expect(refusal.message).toBe(UI_TEXT.vault.unreadable)
    expect(refusal.message).toContain('Reset')
    expect(refusal.message).not.toBe(UI_TEXT.vault.busy)
  })
  it('confirmed encrypted-backup restore replaces an unreadable writer through the real entry point', async () => {
    const { folder, files, key, options, vaultId, created, slot } = await openableVault(
      'backup-',
      'b',
    )
    try {
      const secret = item()
      await created.write(secret)
      const backup = await createEncryptedBackup(created, key, slot)
      created.lock()
      await writeFile(path.join(folder, 'writer.lock'), 'truncated')
      await expect(restoreEncryptedBackup(options, backup, 1024 * 1024, true)).rejects.toThrow(
        UI_TEXT.vault.unreadable,
      )
      const recovery = await files.writerRecovery()
      if (!recovery) throw new Error('unreadable writer offered no recovery')
      const restored = await restoreEncryptedBackup(
        options,
        backup,
        1024 * 1024,
        true,
        recovery.token,
      )
      expect(await restored.read(secret.metadata.id)).toEqual(secret)
      restored.lock()
      const reopened = await VaultStore.open(options, vaultId)
      expect(await reopened.read(secret.metadata.id)).toEqual(secret)
      reopened.lock()
    } finally {
      key.fill(0)
    }
  })
  it('sweeps abandoned writer stages of gone owners while keeping a live one', async () => {
    const { folder, files } = await writerFolder('stages-')
    const self = await exactCurrentProcessOwner()
    if (!self?.machineId || !self.bootId || !self.pidNamespace || !self.exactBirth)
      throw new Error('exact owner evidence unavailable')
    const deadPid = await exitedProcessId()
    await writeFile(
      path.join(folder, 'writer.lock.dead-note.stage'),
      stageNote({ ...self, pid: deadPid, exactBirth: 'dead', processStart: 0 }, 'dead-note'),
    )
    await writeFile(path.join(folder, 'writer.lock.live-note.stage'), stageNote(self, 'live-note'))
    await writeFile(path.join(folder, 'writer.lock.torn.stage'), '{')
    await writeFile(path.join(folder, 'vault.v1.decoy.stage'), '{}')
    await files.withWriter(() => Promise.resolve())
    const names = await readdir(folder)
    expect(names).not.toContain('writer.lock.dead-note.stage')
    expect(names).toContain('writer.lock.live-note.stage')
    expect(names).toContain('writer.lock.torn.stage')
    expect(names).toContain('vault.v1.decoy.stage')
  })
  it('a Lock during confirmed recovery refuses locked, never a generic error', async () => {
    const { folder, files } = await writerFolder('locked-')
    await writeFile(path.join(folder, 'writer.lock'), 'truncated')
    const recovery = await files.writerRecovery()
    if (!recovery) throw new Error('unreadable writer offered no recovery')
    await expect(
      VaultStore.resetLost(
        files,
        null,
        'generated reset',
        () => {
          throw new VaultManagementError('locked')
        },
        () => Promise.resolve(),
        new MemoryVaultAnchor(),
        null,
        recovery.token,
      ),
    ).rejects.toMatchObject({ name: 'VaultManagementError', reason: 'locked' })
  })
  it('strips directional controls from a lock note host label before display', async () => {
    const { folder, files } = await writerFolder('label-')
    await writeLockNote(
      folder,
      {
        host: 'evil\u{202E}machine\u{200F}a',
        pid: 12_345,
        processStart: 0,
        machineId: 'some-installation',
        bootId: 'some-boot',
        pidNamespace: 'pid:[7]',
        exactBirth: 'some-birth',
      },
      'some-note',
    )
    const recovery = await files.writerRecovery()
    expect(recovery?.writer).toMatchObject({ kind: 'held', machineLabel: 'evilmachinea' })
  })
  it('reports unknown ownership, never a holder, when its own evidence is unavailable', async () => {
    const { folder, files } = await writerFolder('evidence-')
    await writeLockNote(
      folder,
      {
        host: 'some-host',
        pid: 12_345,
        processStart: 0,
        machineId: 'some-installation',
        bootId: 'some-boot',
        pidNamespace: 'pid:[7]',
        exactBirth: 'some-birth',
      },
      'some-note',
    )
    const blocking = path.join(folder, 'not-a-directory')
    await writeFile(blocking, 'evidence')
    await withBlockedIdentity(blocking, async () => {
      const recovery = await files.writerRecovery()
      expect(recovery?.writer).toEqual({ kind: 'ownerUnknown' })
    })
  })
  it('a live foreign writer beside an openable vault is stuck, never lost', async () => {
    // RVAPP-LEASE2 P1-2 scenario C: another machine legitimately using the
    // vault must not read as lost, and confirmed Reset must not erase it.
    const { folder, files, anchor, key, vaultId, created } = await openableVault('foreign-', 'c')
    try {
      created.lock()
      await writeLockNote(
        folder,
        {
          host: 'foreign-host',
          pid: 12_345,
          processStart: 0,
          machineId: 'foreign-installation',
          bootId: 'foreign-boot',
          pidNamespace: 'pid:[7]',
          exactBirth: 'foreign-birth',
        },
        'foreign-note',
      )
      const recovery = await files.writerRecovery()
      expect(recovery?.writer).toMatchObject({ kind: 'held', otherMachine: true })
      expect(await VaultStore.isLost(files, vaultId, anchor)).toBe(false)
      await expect(
        VaultStore.resetLost(
          files,
          vaultId,
          'generated reset',
          () => {
            // Authorize: nothing to check outside the writer in this fixture.
          },
          () => Promise.resolve(),
          anchor,
          await anchor.minimum(vaultId),
          recovery?.token,
        ),
      ).rejects.toMatchObject({ code: 'invalid' })
      expect(await files.read('vault.v1')).not.toBeNull()
    } finally {
      key.fill(0)
    }
  })
  it('failed self evidence beside an openable vault is stuck, never lost', async () => {
    // RVAPP-LEASE2 P1-2 scenario A: when this process cannot read its own
    // identity, the vault it cannot judge is not lost.
    const { folder, files, anchor, key, vaultId, created } = await openableVault(
      'self-evidence-',
      'd',
    )
    try {
      created.lock()
      const blocking = path.join(folder, 'not-a-directory')
      await writeFile(blocking, 'evidence')
      await withBlockedIdentity(blocking, async () => {
        const recovery = await files.writerRecovery()
        expect(recovery).toEqual({ token: 'absent', writer: { kind: 'ownerUnknown' } })
        expect(await VaultStore.isLost(files, vaultId, anchor)).toBe(false)
      })
    } finally {
      key.fill(0)
    }
  })
  it('an unsupported filesystem refuses with its cause, never a generic error', async () => {
    // RVAPP-LEASE2 P2-5: the link refusal keeps its name through the real
    // writer entry point, and the managed refusal tells the person why.
    const { files } = await writerFolder('filesystem-')
    const link = vi
      .spyOn(nodeLeasePort, 'link')
      .mockRejectedValueOnce(
        Object.assign(new Error('EPERM: hard links unsupported'), { code: 'EPERM' }),
      )
    try {
      await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
        name: 'VaultError',
        code: 'filesystemUnsupported',
      })
    } finally {
      link.mockRestore()
    }
    expect(vaultRefusalMessage('filesystemUnsupported')).toBe(UI_TEXT.vault.filesystemUnsupported)
  })
  it('two module copies in one process share one serialized writer queue', async () => {
    // RVAPP-LEASE2 P2-1: the queue is process-wide, not per bundle copy, so
    // a second copy never adopts the first copy's live hold. The registry is
    // cleared between the imports so the copies are really two evaluations.
    vi.resetModules()
    const first = await import('../../../src/core/vault/store')
    vi.resetModules()
    const second = await import('../../../src/core/vault/store')
    try {
      const folder = await mkdtemp(path.join(root, 'queue-'))
      const security = {
        protect: () => Promise.resolve(),
        verify: () => Promise.resolve(),
      }
      const filesA = new first.NodeVaultFiles(folder, 1024 * 1024, security)
      const filesB = new second.NodeVaultFiles(folder, 1024 * 1024, security)
      const gate = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      const aDone = filesA.withWriter(async (held) => {
        entered.resolve(undefined)
        await gate.promise
        held()
      })
      // The second copy starts only after the first holds the writer: any
      // completion before the release is an adoption, not serialization.
      await entered.promise
      const bDone = filesB.withWriter((held) => {
        held()
        return Promise.resolve()
      })
      const bFinished = (async () => {
        await bDone
        return true
      })()
      const timedOut = (async () => {
        await delay(100)
        return false
      })()
      const didFinishEarly = await Promise.race([bFinished, timedOut])
      expect(didFinishEarly).toBe(false)
      gate.resolve(undefined)
      await aDone
      await bDone
    } finally {
      vi.resetModules()
    }
  })
})
