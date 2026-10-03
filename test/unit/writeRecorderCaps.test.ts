// A unit's recording budgets (M86 N, spec section 9), with the two budgets
// made small: past the kept bytes a write is recorded by its oids only (not
// kept), and past the intents an `incomplete` entry is durable before the
// first write that goes unrecorded, which still happens.

import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { WriteJournal } from '../../src/host/checkpoints/writeJournal'
import { createOwnerIo, WriteLanes } from '../../src/host/checkpoints/writeRecorder'
import type * as constants from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { nativeToolIo } from './helpers/fakeToolIo'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('../../src/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof constants>()),
  // Three intents a unit; twenty kept bytes.
  CHECKPOINT_UNIT_INTENTS_MAX: 3,
  CHECKPOINT_UNIT_BLOB_BYTES_MAX: 20,
}))

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-write-caps-')))

afterAll(async () => {
  await removeFolder(base)
})

// Real file system work, flushed to the disk: slower on a busy Windows host.
const REAL_FS_TIMEOUT_MS = 60_000

async function ownerIo() {
  const folder = await mkdtemp(path.join(base, 'case-'))
  const root = path.join(folder, 'ws')
  const storageDir = path.join(folder, 'storage')
  await mkdir(root)
  await mkdir(storageDir)
  let ids = 0
  const io = createOwnerIo(nativeToolIo(), {
    journal: new WriteJournal({ storageDir, instance: 'caps' }),
    lanes: new WriteLanes(process.platform),
    owner: { instance: 'caps', sessionId: 's1', unitKind: 'turn', unitId: 't1' },
    workspaceRoot: root,
    platform: process.platform,
    canonicalPath,
    newId: () => {
      ids += 1
      return `w${String(ids)}`
    },
    log: new FakeLogOutputChannel(),
  })
  const file = (name: string) => path.join(root, name)
  const write = async (name: string, content: string) => {
    await io.writeFile(file(name), content, file(name))
  }
  const entries = async () => {
    const journals = await WriteJournal.readAll(storageDir)
    return journals.get('caps')?.entries ?? []
  }
  return { io, file, write, entries }
}

describe('a unit past its budgets (M86 N)', { timeout: REAL_FS_TIMEOUT_MS }, () => {
  it('records the writes past the kept bytes by their oids only, and keeps the rest', async () => {
    const t = await ownerIo()
    // Ten bytes kept, then twelve more would pass twenty: not kept, though recorded.
    await t.write('small.txt', '0123456789')
    await t.write('large.txt', '0123456789ab')
    await t.write('tiny.txt', 'x')
    const entries = await t.entries()
    const writes = entries.flatMap((entry) =>
      entry.kind === 'intent' ? [[entry.write.path, entry.write.isKept]] : [],
    )
    expect(writes).toEqual([
      ['small.txt', true],
      ['large.txt', false],
      ['tiny.txt', true],
    ])
    expect(await readFile(t.file('large.txt'), 'utf8')).toBe('0123456789ab')
  })

  it('journals the unit incomplete before its first unrecorded write, which still happens', async () => {
    const t = await ownerIo()
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await t.write(`${name}.txt`, name)
    }
    const entries = await t.entries()
    const kinds = entries.map((entry) =>
      entry.kind === 'intent' ? `intent ${entry.write.path}` : entry.kind,
    )
    expect(kinds).toEqual([
      'intent a.txt',
      'done',
      'intent b.txt',
      'done',
      'intent c.txt',
      'done',
      'incomplete',
    ])
    expect(await readFile(t.file('e.txt'), 'utf8')).toBe('e')
    // A reservation past the budget is made, unrecorded, as well.
    const reservation = await t.io.reserveFile(t.file('out.png'), t.file('out.png'))
    expect(await reservation.release()).toBe('done')
    const after = await t.entries()
    expect(after.at(-1)?.kind).toBe('incomplete')
  })
})
