// C-M109-1 lead decisions (2026-10-10): the encrypted batch import (all or
// none, per-item report, cancellable, authority at commit) and Reset Vault
// (only for a lost vault, two steps, typed word, audit line, new anchor).
// Generated material and a generated temporary home only.

import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT, VAULT_RESET_WORD } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import { fill, setUiText } from '../../../src/shared/l10n/text'
import type { VaultItem } from '../../../src/shared/vault'
import { VaultStore } from '../../../src/core/vault/store'
import { runVaultCommand } from '../../../src/runtime/vault/vaultCommand'
import { metadata, panel } from '../helpers/vault/fixtures'
import { commandHarness } from '../helpers/vault/runtime'
import { freshVault } from './storeFixtures'
import {
  lockedVault,
  managementFixture,
  cleanupTempHomes,
  stateOf,
  tempHome,
} from './managementFixture'

afterEach(cleanupTempHomes)
afterEach(() => {
  setUiText(EN, 'en')
})

/** A generated home holding one `.git-credentials` with a generated secret. */
async function homeWithGitCredentials(): Promise<{ home: string; file: string; secret: string }> {
  const home = await tempHome()
  const secret = randomBytes(12).toString('hex')
  const file = path.join(home, '.git-credentials')
  await writeFile(file, `https://generated-user:${secret}@example.test\n`, { mode: 0o600 })
  return { home, file, secret }
}
const item = (name: string): VaultItem => ({
  metadata: {
    ...metadata(),
    id: randomBytes(16).toString('hex'),
    name,
    handle: `secret://${name}`,
  },
  material: { kind: 'secret', value: randomBytes(16) },
})
const receipt = (): { id: string; record: string } => ({
  id: randomUUID(),
  record: '{"generated":true}',
})

describe('C-M109-1 batch writer', () => {
  it('publishes every item and its receipt together, or nothing when verification fails', async () => {
    const { store } = await freshVault()
    const first = receipt()
    await expect(
      store.writeBatch(
        [item('batch-a'), item('batch-b')],
        first,
        () => Promise.reject(new Error('generated mismatch')),
        () => undefined,
      ),
    ).rejects.toThrow()
    expect(await store.list()).toEqual([])
    expect(await store.readReceipt(first.id)).toBeNull()
    const verified = receipt()
    const items = [item('batch-c'), item('batch-d')]
    await store.writeBatch(
      items,
      verified,
      async (read) => {
        for (const entry of items) {
          const staged = await read(entry.metadata.id)
          expect(staged.metadata.name).toBe(entry.metadata.name)
        }
      },
      () => undefined,
    )
    const written = await store.list()
    expect(written.map((entry) => entry.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'batch-c',
      'batch-d',
    ])
    expect(await store.readReceipt(verified.id)).toBe(verified.record)
    await store.forgetReceipt(verified.id, () => undefined)
    expect(await store.readReceipt(verified.id)).toBeNull()
  })

  it('checks authority at the commit and refuses a duplicate name, writing nothing', async () => {
    const { store } = await freshVault()
    await expect(
      store.writeBatch(
        [item('dup'), item('dup')],
        receipt(),
        () => Promise.resolve(),
        () => undefined,
      ),
    ).rejects.toThrow()
    await expect(
      store.writeBatch(
        [item('retired')],
        receipt(),
        () => Promise.resolve(),
        () => {
          throw new Error('generated retirement')
        },
      ),
    ).rejects.toThrow('generated retirement')
    expect(await store.list()).toEqual([])
  })
})

describe('C-M109-1 import end to end', () => {
  it('imports a discovered file as hidden items with a value-free report, then deletes the source on request', async () => {
    const { home, file, secret } = await homeWithGitCredentials()
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    await f.broker.unlock(null)
    setUiText(EN, 'ar-u-nu-arab')
    const report = await f.management.importFile(file, () => true)
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({ kind: 'password', hidden: true })
    expect(report.items[0]?.label).toBe(
      fill(UI_TEXT.vault.importedLabel, { source: 'git', number: 1 }),
    )
    expect(JSON.stringify(report)).not.toContain(secret)
    const listed = await f.repository.current().list()
    expect(listed.map((entry) => entry.id)).toEqual(report.items.map((entry) => entry.id))
    await f.management.deleteImport(report.receipt, () => true)
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    code.fill(0)
  })

  it('a cancelled or undiscovered import writes nothing', async () => {
    const { home, file } = await homeWithGitCredentials()
    const f = managementFixture(undefined, home)
    const code = await lockedVault(f)
    await f.broker.unlock(null)
    await expect(f.management.importFile(file, () => false)).rejects.toMatchObject({
      reason: expect.any(String),
    })
    // A readable credential file the discovery did not list is never imported.
    const elsewhere = path.join(home, 'elsewhere-credentials')
    await writeFile(elsewhere, 'https://generated-user:generated@example.test\n', { mode: 0o600 })
    await expect(f.management.importFile(elsewhere, () => true)).rejects.toMatchObject({
      reason: 'invalid',
    })
    expect(await f.repository.current().list()).toEqual([])
    const report = await f.management.importFile(file, () => true)
    await f.management.keepImport(report.receipt)
    const kept = await stat(file)
    expect(kept.isFile()).toBe(true)
    code.fill(0)
  })

  it('the CLI prints names and kinds only and deletes the source only when asked', async () => {
    const h = commandHarness()
    h.deps.choose.mockResolvedValueOnce('delete')
    expect(await runVaultCommand({ command: 'import', path: '/generated/.netrc' }, h.deps)).toBe(0)
    expect(h.deps.print.mock.calls[0]?.[0]).toContain(metadata().name)
    expect(h.port.deleteImport).toHaveBeenCalledOnce()
    expect(h.port.keepImport).not.toHaveBeenCalled()
  })
})

/** A created vault whose files then disappear: the only state Reset Vault serves. */
async function lost() {
  const f = managementFixture()
  const code = await lockedVault(f)
  const kept = new Map(f.files.data)
  f.files.data.delete('slots.v1')
  f.files.data.delete('vault.v1')
  return { f, code, kept }
}
describe('C-M109-1 Reset Vault', () => {
  it('is refused in every other state', async () => {
    const f = managementFixture()
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    const shown = await f.management.setup()
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    await f.management.confirmSetup(shown.setupId)
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    f.broker.lock()
    await expect(f.management.resetBegin()).rejects.toMatchObject({ reason: 'invalid' })
    shown.code.fill(0)
  })

  it('resets a lost vault after the exact word, writes the audit line and starts a new anchor', async () => {
    const { f, code, kept } = await lost()
    const before = await f.management.snapshot()
    expect(before.status.reason).toBe('vaultLost')
    const wrong = await f.management.resetBegin()
    await expect(f.management.resetConfirm(wrong.resetId, 'reset')).rejects.toMatchObject({
      reason: 'invalid',
    })
    // A refused word spends the challenge: the reset starts over.
    await expect(f.management.resetConfirm(wrong.resetId, VAULT_RESET_WORD)).rejects.toMatchObject({
      reason: 'invalid',
    })
    const challenge = await f.management.resetBegin()
    expect(challenge.word).toBe(VAULT_RESET_WORD)
    await f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD)
    expect(await stateOf(f.management)).toBe('uncreated')
    const audit = f.files.data.get('reset.v1')?.toString('utf8') ?? ''
    expect(audit.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(audit)).toMatchObject({ v: 1, kind: 'vaultReset' })
    // A fresh setup gets a new anchor; the old vault's files never open again.
    const again = await f.management.setup()
    await f.management.confirmSetup(again.setupId)
    f.broker.lock()
    for (const [name, bytes] of kept) f.files.data.set(name, bytes)
    await expect(f.management.recover(code)).rejects.toThrow()
    expect(await VaultStore.isLost(f.files, (await f.anchor.vaultId()) ?? '')).toBe(true)
    code.fill(0)
    again.code.fill(0)
  })

  it('is refused at the commit when the vault reappeared between the two steps', async () => {
    const { f, code, kept } = await lost()
    const challenge = await f.management.resetBegin()
    for (const [name, bytes] of kept) f.files.data.set(name, bytes)
    await expect(
      f.management.resetConfirm(challenge.resetId, VAULT_RESET_WORD),
    ).rejects.toMatchObject({ reason: 'invalid' })
    expect(f.files.data.has('slots.v1')).toBe(true)
    expect(f.files.data.has('reset.v1')).toBe(false)
    code.fill(0)
  })

  it('the CLI asks twice and refuses without a terminal', async () => {
    const h = commandHarness()
    h.deps.choose.mockResolvedValueOnce('continue')
    h.deps.readLine.mockResolvedValueOnce(Buffer.from(VAULT_RESET_WORD))
    expect(await runVaultCommand({ command: 'reset' }, h.deps)).toBe(0)
    expect(h.port.resetConfirm).toHaveBeenCalledWith(expect.any(String), VAULT_RESET_WORD)
    const headless = commandHarness()
    expect(
      await runVaultCommand({ command: 'reset' }, { ...headless.deps, isInteractive: false }),
    ).toBe(1)
    expect(headless.port.resetBegin).not.toHaveBeenCalled()
    expect(panel().status.reason).not.toBe('vaultLost')
  })
})
