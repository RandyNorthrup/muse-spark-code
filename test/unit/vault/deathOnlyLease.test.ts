import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireFileLease,
  LeaseBusyError,
  type FileLeaseEnv,
} from '../../../src/core/locks/fileLease'
import { nodeLeasePort } from '../../../src/core/locks/nodeLeasePort'
import { isProcessOwnerGone } from '../../../src/core/locks/processOwner'
import { NodeVaultFiles } from '../../../src/core/vault/store'
import { VaultWriterError } from '../../../src/core/vault/crypto'
import {
  vaultRefusalMessage,
  VaultManageSession,
} from '../../../src/core/vault/broker/manageClient'
import { vaultBrokerResponseSchema } from '../../../src/shared/vaultProtocol'
import { VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import { removeFolder } from '../helpers/temporaryFolders'
import * as owners from '../../../src/core/locks/processOwner'
import { managementFixture, lockedVault } from './managementFixture'
import { inspectFileLease } from '../../../src/core/locks/fileLease'

const roots: string[] = []
// The adoption, recovery and Reset cases go through the real installation
// identity: every platform's folder resolves under a test-owned directory,
// never the developer's real data folder.
const machineScope = await mkdtemp(path.join(await realpath(tmpdir()), 'm109-machine-'))
roots.push(machineScope)
process.env['XDG_DATA_HOME'] = machineScope
process.env['LOCALAPPDATA'] = machineScope
process.env['HOME'] = machineScope
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await removeFolder(root)
})
async function fixture() {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'm109-death-'))
  roots.push(root)
  let clock = 0
  const owner = {
    host: 'test-machine',
    pid: 123,
    processStart: 1000,
    exactBirth: '10000001',
    machineId: 'installation',
    bootId: 'boot',
    pidNamespace: 'pid:[42]',
  }
  const env: FileLeaseEnv = {
    port: nodeLeasePort,
    now: () => clock,
    monotonic: () => clock,
    sleep: () => Promise.resolve(),
    owner,
    isOwnerGone: () => Promise.resolve(false),
    leaseMs: 30_000,
    honoredLeaseMs: 30_000,
    unreadableMs: 2000,
    timeoutMs: 0,
    pollMs: 0,
    takeover: 'ownerDeathOnly',
    watches: new Map(),
  }
  return {
    root,
    owner,
    env,
    file: path.join(root, 'writer.lock'),
    step: (ms: number) => {
      clock += ms
    },
  }
}
function vaultFiles(root: string, maxBytes = 1024) {
  return new NodeVaultFiles(root, maxBytes, {
    protect: () => Promise.resolve(),
    verify: () => Promise.resolve(),
  })
}
describe('vault takeover requires proven death', () => {
  it('legacy boot timestamps are unknown and UUID spelling never proves a reboot', async () => {
    const f = await fixture()
    const self = { ...f.owner, bootId: 'abcdefab-1111-2222-3333-444444444444' }
    const probe = { self, exactOnly: true, isAlive: () => false }
    expect(await isProcessOwnerGone({ ...self, bootId: '134045712000000000' }, probe)).toBe(false)
    expect(
      await isProcessOwnerGone(
        { ...self, bootId: self.bootId.toUpperCase() },
        {
          ...probe,
          isAlive: () => true,
          exactBirthOf: () => Promise.resolve(self.exactBirth),
        },
      ),
    ).toBe(false)
  })
  const evidenceMatrix = ['installation', 'foreign', undefined].flatMap((machineId) =>
    ['boot', 'old-boot', undefined].flatMap((bootId) =>
      ['pid:[42]', 'pid:[43]', undefined].flatMap((pidNamespace) =>
        [true, false, undefined].flatMap((alive) =>
          ['birth', 'other-birth', undefined].map((birth) => ({
            machineId,
            bootId,
            pidNamespace,
            alive,
            birth,
          })),
        ),
      ),
    ),
  )
  it.each(evidenceMatrix)(
    'death truth table %#',
    async ({ machineId, bootId, pidNamespace, alive, birth }) => {
      const self = {
        host: 'same-name',
        pid: 1,
        processStart: 0,
        machineId: 'installation',
        bootId: 'boot',
        pidNamespace: 'pid:[42]',
        exactBirth: 'birth',
      }
      const owner = { ...self, pid: 2, machineId, bootId, pidNamespace }
      const isExpected =
        machineId === 'installation' &&
        bootId !== undefined &&
        (bootId === 'old-boot' ||
          (pidNamespace === 'pid:[42]' &&
            (alive === false || (alive === true && birth === 'other-birth'))))
      expect(
        await isProcessOwnerGone(owner, {
          self,
          exactOnly: true,
          isAlive: () => alive,
          exactBirthOf: () => Promise.resolve(birth),
        }),
      ).toBe(isExpected)
    },
  )
  it('a different boot on another host sharing the installation file never proves death', async () => {
    const self = {
      host: 'same-name',
      pid: 1,
      processStart: 0,
      machineId: 'installation',
      bootId: 'boot',
      pidNamespace: 'pid:[42]',
      exactBirth: 'birth',
    }
    const owner = { ...self, pid: 2, host: 'another-host', bootId: 'old-boot' }
    expect(
      await isProcessOwnerGone(owner, {
        self,
        exactOnly: true,
        isAlive: () => false,
        exactBirthOf: () => Promise.resolve('other-birth'),
      }),
    ).toBe(false)
    expect(
      await isProcessOwnerGone(
        { ...owner, host: 'same-name' },
        { self, exactOnly: true, isAlive: () => false },
      ),
    ).toBe(true)
  })
  it('failed liveness and birth queries are unknown evidence', async () => {
    const f = await fixture()
    expect(
      await isProcessOwnerGone(f.owner, {
        self: f.owner,
        exactOnly: true,
        isAlive: () => {
          throw new Error('probe failed')
        },
      }),
    ).toBe(false)
    expect(
      await isProcessOwnerGone(f.owner, {
        self: f.owner,
        exactOnly: true,
        isAlive: () => true,
        exactBirthOf: () => Promise.reject(new Error('probe failed')),
      }),
    ).toBe(false)
  })
  it.each(['create', 'write', 'flush', 'publish', 'cleanup'])(
    'interrupting atomic note %s leaves no lock or a complete note',
    async (step) => {
      const f = await fixture()
      const port = {
        ...nodeLeasePort,
        createExclusive: async (
          file: string,
          content: string,
          durability: 'visible' | 'flushed',
        ) => {
          if (step === 'create' && file.endsWith('.stage')) throw new Error('interrupted create')
          if (file.endsWith('.stage')) expect(durability).toBe('flushed')
          if (step === 'write' && file.endsWith('.stage')) {
            await nodeLeasePort.createExclusive(file, '{', 'visible')
            throw new Error('interrupted write')
          }
          await nodeLeasePort.createExclusive(file, content, durability)
          if (step === 'flush' && file.endsWith('.stage')) throw new Error('interrupted flush')
        },
        link: async (from: string, to: string) => {
          if (step === 'publish') throw new Error('interrupted publish')
          await nodeLeasePort.link(from, to)
        },
        unlink: async (file: string) => {
          if (step === 'cleanup' && file.endsWith('.stage')) throw new Error('interrupted cleanup')
          await nodeLeasePort.unlink(file)
        },
      }
      let lease
      try {
        lease = await acquireFileLease(f.file, { ...f.env, port })
      } catch {
        /* interrupted */
      }
      try {
        if (step === 'cleanup')
          expect(await inspectFileLease(nodeLeasePort, f.file)).toMatchObject({
            holder: { owner: f.owner },
          })
        else await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await lease?.release()
      }
    },
  )
  it('renewal preserves the complete published death-only note', async () => {
    const f = await fixture()
    const lease = await acquireFileLease(f.file, f.env)
    try {
      const before = await readFile(f.file)
      expect(await lease.renew()).toBe(true)
      expect(await readFile(f.file)).toEqual(before)
    } finally {
      await lease.release()
    }
  })
  it('retries transient release and adopts its own hold after bounded release failures', async () => {
    const f = await fixture()
    const files = vaultFiles(f.root)
    const rename = vi.spyOn(nodeLeasePort, 'rename')
    rename.mockRejectedValueOnce(new Error('scanner'))
    await files.withWriter(() => Promise.resolve())
    expect(rename).toHaveBeenCalledTimes(2)
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
    rename.mockRejectedValue(new Error('scanner'))
    await files.withWriter(() => Promise.resolve())
    const note = await readFile(f.file, 'utf8')
    rename.mockRestore()
    await files.withWriter((held) => {
      held()
      return Promise.resolve()
    })
    expect(note).toContain('exactBirth')
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['', '{', 'foreign'])(
    'confirmed recovery replaces a %j note while normal operations refuse',
    async (kind) => {
      const f = await fixture()
      const files = vaultFiles(f.root)
      await writeFile(
        f.file,
        kind === 'foreign'
          ? JSON.stringify({
              owner: { ...f.owner, machineId: 'foreign', host: 'foreign-host' },
              id: 'foreign',
              acquiredAt: 1000,
              leaseMs: 0,
            })
          : kind,
      )
      await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
        code: 'busy',
      })
      const recovery = await files.writerRecovery()
      expect(recovery).toBeDefined()
      await files.withWriter((held) => {
        held()
        return Promise.resolve()
      }, recovery?.token)
      await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it.each(['pid', 'time'])(
    'malformed %s facts remain recoverable through a valid private challenge',
    async (field) => {
      const f = await fixture()
      const files = vaultFiles(f.root)
      await writeFile(
        f.file,
        JSON.stringify({
          owner: { ...f.owner, machineId: 'foreign', pid: field === 'pid' ? -1 : 123 },
          id: 'foreign',
          acquiredAt: field === 'time' ? -1 : 1000,
          leaseMs: 0,
        }),
      )
      const recovery = await files.writerRecovery()
      expect(recovery?.writer).toEqual({ kind: 'unreadable' })
      expect(
        vaultBrokerResponseSchema.safeParse({
          v: VAULT_PROTOCOL_VERSION,
          sequence: 1,
          response: {
            kind: 'resetChallenge',
            resetId: 'a'.repeat(32),
            word: 'RESET',
            writer: recovery?.writer,
          },
        }).success,
      ).toBe(true)
      await files.withWriter(() => Promise.resolve(), recovery?.token)
    },
  )
  it('confirmation refuses a different note and never offers to break a known live writer', async () => {
    const f = await fixture()
    const files = vaultFiles(f.root)
    await writeFile(f.file, '')
    const recovery = await files.writerRecovery()
    await writeFile(f.file, '{')
    await expect(files.withWriter(() => Promise.resolve(), recovery?.token)).rejects.toMatchObject({
      code: 'busy',
    })
    await nodeLeasePort.unlink(f.file)
    await files.withWriter(async () => {
      expect(await files.writerRecovery()).toBeUndefined()
    })
  })
  it('rechecks the confirmed bytes after retirement and authorization before dispatch', async () => {
    const f = await fixture()
    const files = vaultFiles(f.root)
    await writeFile(f.file, '')
    const recovery = await files.writerRecovery()
    await expect(
      files.withWriter(
        () => Promise.resolve(),
        recovery?.token,
        () => {
          throw new Error('Lock')
        },
      ),
    ).rejects.toThrow()
    expect(await readFile(f.file, 'utf8')).toBe('')
    const rename = nodeLeasePort.rename
    vi.spyOn(nodeLeasePort, 'rename').mockImplementationOnce(async (from, to) => {
      await writeFile(from, '{changed')
      await rename(from, to)
    })
    await expect(files.withWriter(() => Promise.resolve(), recovery?.token)).rejects.toMatchObject({
      code: 'busy',
    })
    expect(await readFile(f.file, 'utf8')).toBe('{changed')
  })
  it.each([false, true])(
    'the real Reset confirmation clears an unreadable hold; anchored=%s',
    async (anchored) => {
      const f = await fixture(),
        management = managementFixture()
      if (anchored) {
        const code = await lockedVault(management)
        code.fill(0)
      }
      const files = vaultFiles(f.root, 1024 * 1024)
      for (const [name, data] of management.files.data) await files.writeAtomic(name, data)
      Object.assign(management.files, { writerRecovery: files.writerRecovery.bind(files) })
      vi.spyOn(management.files, 'withWriter').mockImplementation(files.withWriter.bind(files))
      vi.spyOn(management.files, 'read').mockImplementation(files.read.bind(files))
      vi.spyOn(management.files, 'writeAtomic').mockImplementation(files.writeAtomic.bind(files))
      vi.spyOn(management.files, 'remove').mockImplementation(files.remove.bind(files))
      vi.spyOn(management.files, 'quarantine').mockImplementation(files.quarantine.bind(files))
      await writeFile(f.file, '')
      if (anchored) {
        // RVAPP-LEASE2 P1-2: a stuck lock beside an openable vault is
        // stuck, never lost: Reset stays refused, token or not.
        const snapshot = await management.management.snapshot()
        expect(snapshot.status.reason).not.toBe('vaultLost')
        await expect(management.management.resetBegin()).rejects.toMatchObject({
          reason: 'invalid',
        })
        expect(await files.read('vault.v1')).not.toBeNull()
        return
      }
      const snapshot = await management.management.snapshot()
      expect(snapshot.status.reason).toBe('vaultLost')
      const challenge = await management.management.resetBegin()
      expect(challenge.writer).toEqual({ kind: 'unreadable' })
      await expect(management.management.resetConfirm(challenge.resetId, 'wrong')).rejects.toThrow()
      expect(await readFile(f.file, 'utf8')).toBe('')
      const confirmed = await management.management.resetBegin()
      await management.management.resetConfirm(confirmed.resetId, confirmed.word)
      expect(await management.anchor.vaultId()).toBeNull()
      await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await files.read('vault.v1')).toBeNull()
    },
  )
  it.each([
    {
      name: 'same complete live identity',
      owner: {},
      self: {},
      alive: true,
      birth: '10000001',
      gone: false,
    },
    {
      name: 'same hostname on another machine',
      owner: { machineId: 'foreign' },
      self: {},
      alive: false,
      birth: 'other',
      gone: false,
    },
    {
      name: 'different hostname on same machine',
      owner: { host: 'renamed' },
      self: {},
      alive: false,
      birth: undefined,
      gone: true,
    },
    {
      name: 'previous boot on same machine',
      owner: { bootId: 'old' },
      self: {},
      alive: true,
      birth: undefined,
      gone: true,
    },
    {
      name: 'other namespace with absent pid',
      owner: { pidNamespace: 'pid:[43]' },
      self: {},
      alive: false,
      birth: 'other',
      gone: false,
    },
    {
      name: 'absent pid in comparable namespace',
      owner: {},
      self: {},
      alive: false,
      birth: undefined,
      gone: true,
    },
    {
      name: 'reused pid with different birth',
      owner: {},
      self: {},
      alive: true,
      birth: '10000002',
      gone: true,
    },
    {
      name: 'failed liveness probe',
      owner: {},
      self: {},
      alive: undefined,
      birth: 'other',
      gone: false,
    },
    ...['machineId', 'bootId', 'pidNamespace', 'exactBirth'].flatMap((field) => [
      {
        name: 'unreadable owner ' + field,
        owner: { [field]: undefined },
        self: {},
        alive: true,
        birth: 'other',
        gone: false,
      },
      {
        name: 'unreadable self ' + field,
        owner: {},
        self: { [field]: undefined },
        alive: true,
        birth: undefined,
        gone: false,
      },
    ]),
    {
      name: 'unreadable pid',
      owner: { pid: NaN },
      self: {},
      alive: false,
      birth: 'other',
      gone: false,
    },
  ])('owner evidence: $name', async ({ owner, self, alive, birth, gone }) => {
    const f = await fixture()
    expect(
      await isProcessOwnerGone(
        { ...f.owner, ...owner },
        {
          self: { ...f.owner, ...self },
          exactOnly: true,
          isAlive: () => alive,
          exactBirthOf: () => Promise.resolve(birth),
        },
      ),
    ).toBe(gone)
  })

  it('validates value-free writer facts and displays them in the shared host client', async () => {
    const writer = { kind: 'held', pid: 123, acquiredAt: 1000, otherMachine: false }
    const input = {
      v: VAULT_PROTOCOL_VERSION,
      sequence: 1,
      response: { kind: 'refused', reason: 'busy', writer },
    }
    const frame = vaultBrokerResponseSchema.parse(input)
    expect(
      vaultBrokerResponseSchema.safeParse({
        ...input,
        response: { ...input.response, writer: { ...writer, otherMachine: 'unknown' } },
      }).success,
    ).toBe(false)
    expect(
      vaultBrokerResponseSchema.safeParse({
        ...input,
        response: { ...input.response, writer: { ...writer, path: 'not-a-writer-fact' } },
      }).success,
    ).toBe(false)
    const session = new VaultManageSession(() =>
      Promise.resolve({
        send: () => Promise.resolve(frame.response),
        close: () => undefined,
        watch: () => Promise.resolve(),
        closed: () => Promise.resolve(),
      }),
    )
    await expect(session.snapshot()).rejects.toThrow(
      vaultRefusalMessage('busy', {
        kind: 'held',
        pid: 123,
        acquiredAt: 1000,
        otherMachine: false,
      }),
    )
  })
  it('preserves the typed writer refusal through setup and reset management', async () => {
    const busy = new VaultWriterError({
      kind: 'held',
      pid: 123,
      acquiredAt: 1000,
      otherMachine: false,
    })
    const setup = managementFixture()
    vi.spyOn(setup.files, 'withWriter').mockRejectedValue(busy)
    await expect(setup.management.setup()).rejects.toBe(busy)
    const confirmation = managementFixture()
    const shown = await confirmation.management.setup()
    shown.code.fill(0)
    vi.spyOn(confirmation.files, 'withWriter').mockRejectedValue(busy)
    await expect(confirmation.management.confirmSetup(shown.setupId)).rejects.toBe(busy)
    const reset = managementFixture()
    const code = await lockedVault(reset)
    code.fill(0)
    reset.files.data.set('vault.v1', Buffer.from('generated damaged document'))
    const challenge = await reset.management.resetBegin()
    vi.spyOn(reset.files, 'withWriter').mockRejectedValue(busy)
    await expect(reset.management.resetConfirm(challenge.resetId, challenge.word)).rejects.toBe(
      busy,
    )
  })
  it('keeps a suspended live writer beyond three leases and a one-hour clock jump', async () => {
    const f = await fixture()
    const first = await acquireFileLease(f.file, f.env)
    try {
      f.step(3_600_000)
      await expect(acquireFileLease(f.file, f.env)).rejects.toBeInstanceOf(LeaseBusyError)
      f.step(100_000)
      await expect(acquireFileLease(f.file, f.env)).rejects.toMatchObject({
        holder: { owner: f.owner, acquiredAt: 0 },
      })
      expect(first.isHeldSync()).toBe(true)
      expect(await first.renew()).toBe(true)
    } finally {
      await first.release()
    }
  })
  it('takes over a proven-dead owner immediately', async () => {
    const f = await fixture()
    const first = await acquireFileLease(f.file, f.env)
    const next = await acquireFileLease(f.file, {
      ...f.env,
      isOwnerGone: () => Promise.resolve(true),
    })
    try {
      expect(next.fence).toBeGreaterThan(first.fence)
      expect(first.isHeldSync()).toBe(false)
    } finally {
      await first.release()
      await next.release()
    }
  })
  it('never takes an unreadable note on time alone', async () => {
    const f = await fixture()
    await writeFile(f.file, '{')
    await expect(acquireFileLease(f.file, f.env)).rejects.toBeInstanceOf(LeaseBusyError)
    f.step(3_600_000)
    await expect(acquireFileLease(f.file, f.env)).rejects.toBeInstanceOf(LeaseBusyError)
  })
  it('creates no writer lock when its acquisition birth cannot be proved', async () => {
    const f = await fixture()
    vi.spyOn(owners, 'exactCurrentProcessOwner').mockResolvedValue(undefined)
    const files = vaultFiles(f.root)
    await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
      code: 'busy',
      writer: { kind: 'ownerUnknown' },
    })
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
    const recovery = await files.writerRecovery()
    expect(recovery?.writer).toEqual({ kind: 'ownerUnknown' })
    await files.withWriter(() => Promise.resolve(), recovery?.token)
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('requires exact birth evidence for pid reuse; unavailable and legacy births prove nothing', async () => {
    const f = await fixture()
    const probe = {
      self: f.owner,
      exactOnly: true,
      isAlive: () => true,
      exactBirthOf: () => Promise.resolve('10000002'),
    }
    expect(await isProcessOwnerGone(f.owner, probe)).toBe(true)
    expect(
      await isProcessOwnerGone(
        { host: f.owner.host, pid: f.owner.pid, processStart: 3_601_000 },
        probe,
      ),
    ).toBe(false)
    expect(
      await isProcessOwnerGone(f.owner, {
        ...probe,
        exactBirthOf: () => Promise.resolve(undefined),
      }),
    ).toBe(false)
    expect(
      await isProcessOwnerGone(
        { ...f.owner, machineId: 'another-installation', host: 'another-machine' },
        { ...probe, isAlive: () => false },
      ),
    ).toBe(false)
    expect(await isProcessOwnerGone(f.owner, { ...probe, isAlive: () => false })).toBe(true)
  })
  it('refuses a foreign-machine writer and carries only process/time facts to translated text', async () => {
    const f = await fixture()
    const files = vaultFiles(f.root)
    await writeFile(
      f.file,
      JSON.stringify({
        owner: { ...f.owner, host: 'another-machine' },
        id: 'foreign',
        acquiredAt: 1000,
        leaseMs: 0,
        renewal: 0,
      }),
    )
    await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
      code: 'busy',
      writer: { kind: 'held', pid: 123, acquiredAt: 1000, otherMachine: true },
    })
    const error = new VaultWriterError({
      kind: 'held',
      pid: 123,
      acquiredAt: 1000,
      otherMachine: true,
    })
    expect(vaultRefusalMessage('busy', error.writer)).toBe(error.message)
    expect(error.message).toContain('another machine')
    expect(error.message).not.toContain(f.root)
    expect(await readFile(f.file, 'utf8')).toContain('foreign')
  })
})
