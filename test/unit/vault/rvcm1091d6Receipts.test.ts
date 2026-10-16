// RVAPP-CM1091D5 P2-2: a kept or orphaned receipt can always be finished.
// A sweep at every unlocked snapshot lists receipts whose source or secret
// still exists with the two real actions; a receipt whose source AND secret
// are both gone is forgotten by the sweep itself. Each case fails without
// its fix: the sweep, the listing, or the shape it travels in.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import { VaultError } from '../../../src/core/vault/crypto'
import { vaultPendingReceiptSchema } from '../../../src/shared/vaultProtocol'
import { vaultPanelStateSchema } from '../../../src/shared/vaultPanel'
import { vaultHostMessageSchema } from '../../../src/shared/hostApi/vaultMessages'
import { cleanupTempHomes, importedNetrc } from './managementFixture'
import type { managementFixture } from './managementFixture'

afterEach(cleanupTempHomes)

const NETRC = 'machine example.test login generated-user password generated-password\n'

async function imported() {
  const { f, report, file } = await importedNetrc()
  return { f, receipt: report.receipt, file }
}

/** A Delete refused after the source changed: the receipt stays to finish. */
async function refused(
  f: ReturnType<typeof managementFixture>,
  receipt: string,
  file: string,
): Promise<void> {
  await writeFile(file, NETRC.replace('generated-password', 'generated-replacement'))
  await expect(f.management.deleteImport(receipt, () => true)).rejects.toMatchObject({
    reason: 'deleteConflict',
  })
}

describe('RVAPP-CM1091D5 P2-2 the sweep lists finishable receipts', () => {
  it('a receipt a refused Delete kept is listed with its path and items', async () => {
    const { f, receipt, file } = await imported()
    await refused(f, receipt, file)
    const snapshot = await f.management.snapshot()
    expect(snapshot.pendingReceipts).toHaveLength(1)
    const [entry] = snapshot.pendingReceipts
    expect(entry?.receipt).toBe(receipt)
    expect(entry?.path).toBe(file)
    expect(entry?.items.length).toBeGreaterThan(0)
    // The broker shape travels the panel shape unchanged: drift fails here.
    const state = vaultPanelStateSchema.parse({
      status: snapshot.status,
      items: snapshot.items,
      grants: snapshot.grants,
      audit: [],
      pending: snapshot.pending,
      pendingReceipts: snapshot.pendingReceipts,
      ambientFiles: [],
    })
    expect(() => vaultHostMessageSchema.parse({ type: 'vaultState', state })).not.toThrow()
    expect(vaultPendingReceiptSchema.parse(entry)).toEqual(entry)
  })

  it('a receipt orphaned by a stuck forget stays listed while the secret does', async () => {
    const { f, receipt } = await imported()
    const store = f.repository.current()
    // The source unlinks, then the forget fails: the receipt is orphaned,
    // but the secret still exists, so finishing stays possible.
    vi.spyOn(store, 'forgetReceipt').mockRejectedValueOnce(new VaultError('busy'))
    await expect(f.management.deleteImport(receipt, () => true)).rejects.toMatchObject({
      reason: 'sourceGone',
    })
    expect(await store.readReceipt(receipt)).not.toBeNull()
    const snapshot = await f.management.snapshot()
    expect(snapshot.pendingReceipts.map((entry) => entry.receipt)).toEqual([receipt])
  })

  it('a receipt whose source and secret are both gone is forgotten by the sweep', async () => {
    const { f, receipt, file } = await imported()
    const before = await f.management.snapshot()
    for (const item of before.items) await f.management.remove(item.id)
    await rm(file)
    // No Delete ran: the sweep itself clears the leftover record.
    const snapshot = await f.management.snapshot()
    expect(snapshot.pendingReceipts).toEqual([])
    expect(await f.repository.current().readReceipt(receipt)).toBeNull()
  })

  it('a receipt whose source is gone but secret stays is still listed', async () => {
    const { f, receipt, file } = await imported()
    await rm(file)
    const snapshot = await f.management.snapshot()
    // The secret still exists: finishing the delete from the list clears it.
    expect(snapshot.pendingReceipts.map((entry) => entry.receipt)).toEqual([receipt])
  })

  it('locked snapshots list no receipts', async () => {
    const { f, receipt, file } = await imported()
    // A kept receipt exists before the lock: locking still strips the list.
    await refused(f, receipt, file)
    const listed = await f.management.snapshot()
    expect(listed.pendingReceipts).toHaveLength(1)
    f.broker.lock()
    const snapshot = await f.management.snapshot()
    expect(snapshot.pendingReceipts).toEqual([])
  })
})
