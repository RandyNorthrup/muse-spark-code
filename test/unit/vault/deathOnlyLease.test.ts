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
import { exactCurrentProcessOwner, isProcessOwnerGone } from '../../../src/core/locks/processOwner'
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

const roots: string[] = []
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
describe('vault takeover requires proven death', () => {
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
  it('retries a failed acquisition birth probe twice, without an estimate', async () => {
    const probe = vi.fn().mockResolvedValue(undefined)
    expect(await exactCurrentProcessOwner(probe)).toBeUndefined()
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('creates no writer lock when its acquisition birth cannot be proved', async () => {
    const f = await fixture()
    vi.spyOn(owners, 'exactCurrentProcessOwner').mockResolvedValue(undefined)
    const files = new NodeVaultFiles(f.root, 1024, {
      protect: () => Promise.resolve(),
      verify: () => Promise.resolve(),
    })
    await expect(files.withWriter(() => Promise.resolve())).rejects.toMatchObject({
      code: 'busy',
      writer: { kind: 'ownerUnknown' },
    })
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
    const files = new NodeVaultFiles(f.root, 1024, {
      protect: () => Promise.resolve(),
      verify: () => Promise.resolve(),
    })
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
