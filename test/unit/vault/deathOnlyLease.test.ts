import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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
import { vaultRefusalMessage } from '../../../src/core/vault/broker/manageClient'
import { removeFolder } from '../helpers/temporaryFolders'
import * as owners from '../../../src/core/locks/processOwner'
import { managementFixture, lockedVault } from './managementFixture'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await removeFolder(root)
})
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'm109-death-'))
  roots.push(root)
  let clock = 0
  const owner = { host: 'test-machine', pid: 123, processStart: 1000, exactBirth: '10000001' }
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
        { ...f.owner, host: 'another-machine' },
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
