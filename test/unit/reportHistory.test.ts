import { createHash } from 'node:crypto'
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ReportHistory,
  ReportStorage,
  type ReportHistoryCodec,
} from '../../src/core/reporting/history'
import { reportDocumentSchema, type ReportDocument } from '../../src/shared/reportSchema'
import { reportsMethods } from '../../src/shared/hostApi/reports'
import { REPORT_MAX_SOURCES, REPORT_MAX_TEXT_CHARS } from '../../src/shared/constants'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import { reportDocument } from './helpers/reporting/snapshot'
import { removeFolder } from './helpers/temporaryFolders'

const TEMP = path.resolve(import.meta.dirname, '../../temp')
const CANARY = 'private-history-canary'

function hash(document: ReportDocument): string {
  const { asOf: _asOf, contentHash: _contentHash, ...header } = document.header
  return createHash('sha256')
    .update(JSON.stringify({ ...document, header }))
    .digest('hex')
}

// Only the absent R dependency is faked. The real history and filesystem run below.
const codec: ReportHistoryCodec = {
  encode(input) {
    const document = reportDocumentSchema.parse(
      JSON.parse(JSON.stringify(input).replaceAll(CANARY, '[redacted]')),
    )
    document.header.contentHash = hash(document)
    return JSON.stringify(document, null, 2) + '\n'
  },
  decode(text) {
    const document = reportDocumentSchema.parse(JSON.parse(text))
    if (document.header.contentHash !== hash(document)) throw new Error('Invalid saved hash')
    return document
  },
}

async function fixture(keepHistory = () => true) {
  await mkdir(TEMP, { recursive: true })
  const directory = await mkdtemp(path.join(TEMP, 'report-history-'))
  onTestFinished(() => removeFolder(directory))
  const authorize = vi.fn((scope: { workspaceKey: string }) => {
    return scope.workspaceKey === 'workspace'
      ? Promise.resolve()
      : Promise.reject(new Error('Denied scope'))
  })
  const storage = new ReportStorage(directory)
  const history = new ReportHistory({ storage, codec, keepHistory, authorize })
  return {
    directory,
    storage,
    history,
    authorize,
    folder: path.join(directory, 'reports/v1/history/workspace/project'),
  }
}

function at(index: number): ReportDocument {
  const document = reportDocument()
  document.header.asOf = new Date(Date.UTC(2026, 9, 6, 12, 0, index)).toISOString()
  return document
}

describe('report history', () => {
  it('refuses a file whose held native identity differs from the checked leaf', async () => {
    const t = await fixture()
    await t.storage.transaction(['checks'], true, (files) => files.write('identity.json', '{}'))
    const original = fileIdentity.handleIdentity
    const spy = vi.spyOn(fileIdentity, 'handleIdentity').mockImplementation(async (handle) => {
      const info = await original(handle)
      return new Proxy(info, {
        get: (target, key, receiver) => {
          if (key === 'ino') return info.ino + 1n
          const value: unknown = Reflect.get(target, key, receiver)
          return value
        },
      })
    })
    try {
      await expect(
        t.storage.transaction(['checks'], false, (files) => files.read('identity.json')),
      ).rejects.toThrow()
    } finally {
      spy.mockRestore()
    }
    expect(await readFile(path.join(t.directory, 'reports/v1/checks/identity.json'), 'utf8')).toBe(
      '{}',
    )
  })
  it('refuses oversized files and read-only mutations through the shared storage boundary', async () => {
    const t = await fixture()
    await t.storage.transaction(['checks'], true, async (files) => {
      await files.write('large.json', '{}')
    })
    await truncate(
      path.join(t.directory, 'reports/v1/checks/large.json'),
      REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES + 1,
    )
    await expect(
      t.storage.transaction(['checks'], false, async (files) => {
        await files.read('large.json')
        return 'read'
      }),
    ).rejects.toThrow()
    await expect(
      t.storage.transaction(['checks'], false, (files) => files.write('new.json', '{}')),
    ).rejects.toThrow()
    await expect(
      t.storage.transaction(['checks'], false, (files) => files.remove('large.json')),
    ).rejects.toThrow()
    await expect(
      t.storage.transaction(['checks'], true, (files) =>
        files.write('large.json', 'x'.repeat(REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES + 1)),
      ),
    ).rejects.toThrow()
  })

  it('rejects POSIX and Windows path traversal in storage buckets and filenames', async () => {
    const t = await fixture()
    for (const name of ['../escape', String.raw`..\escape`]) {
      await expect(t.storage.transaction([name], true, () => Promise.resolve())).rejects.toThrow()
      await expect(
        t.storage.transaction(['checks'], true, (files) => files.write(name, '{}')),
      ).rejects.toThrow()
    }
  })

  it('refuses a renamed saved id even when the document hash is valid', async () => {
    const t = await fixture()
    const saved = await t.history.save('workspace', at(1))
    if (saved.status !== 'saved') throw new Error('Expected saved report')
    const wrong = 'b'.repeat(64)
    await rename(
      path.join(t.folder, `${saved.entry.id}.json`),
      path.join(t.folder, `${wrong}.json`),
    )
    expect(
      await t.history.get({ workspaceKey: 'workspace', kind: 'project', id: wrong }),
    ).toMatchObject({ status: 'failed' })
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'project' })).toMatchObject({
      status: 'failed',
    })
  })

  it('refuses a valid document of another kind planted inside this kind bucket', async () => {
    const t = await fixture()
    const text = codec.encode(reportDocument('usage'))
    const id = createHash('sha256').update(text).digest('hex')
    await t.storage.transaction(['history', 'workspace', 'project'], true, (files) =>
      files.write(`${id}.json`, text),
    )
    expect(await t.history.get({ workspaceKey: 'workspace', kind: 'project', id })).toMatchObject({
      status: 'failed',
    })
  })

  it('orders equal stamps by saved id and different offsets by their actual instant', async () => {
    const t = await fixture()
    const first = at(1)
    const second = at(2)
    first.header.asOf = '2026-10-06T23:00:00+12:00'
    second.header.asOf = '2026-10-06T01:00:00-12:00'
    const third = structuredClone(second)
    third.sections[0]!.rows[0]!.cells['state'] = { type: 'label', value: 'built' }
    const a = await t.history.save('workspace', first)
    const b = await t.history.save('workspace', second)
    const c = await t.history.save('workspace', third)
    if (a.status !== 'saved' || b.status !== 'saved' || c.status !== 'saved')
      throw new Error('Expected saved reports')
    const result = await t.history.history({ workspaceKey: 'workspace', kind: 'project' })
    if (result.status !== 'listed') throw new Error('Expected history')
    const firstSaved = b.entry.id < c.entry.id ? b : c
    const secondSaved = firstSaved === b ? c : b
    expect(result.entries.map((entry) => entry.id)).toEqual([
      firstSaved.entry.id,
      secondSaved.entry.id,
      a.entry.id,
    ])
  })
  it('drops the oldest on the 51st report, retains each kind separately and lists newest first', async () => {
    const t = await fixture()
    await t.storage.transaction(['history', 'workspace', 'project'], true, async (files) => {
      for (let index = 0; index < 50; index += 1) {
        const text = codec.encode(at(index))
        await files.write(`${createHash('sha256').update(text).digest('hex')}.json`, text)
      }
    })
    await t.history.save('workspace', at(50))
    await t.history.save('workspace', reportDocument('quality'))
    const result = reportsMethods['reports/history'].result.parse(
      await t.history.history({ workspaceKey: 'workspace', kind: 'project' }),
    )
    expect(result.status).toBe('listed')
    if (result.status !== 'listed') throw new Error('Expected history')
    expect(result.entries).toHaveLength(50)
    expect(result.entries[0]!.header.asOf).toBe(at(50).header.asOf)
    expect(result.entries.at(-1)!.header.asOf).toBe(at(1).header.asOf)
    const retained = await readdir(t.folder)
    expect(retained.filter((name) => name.endsWith('.json'))).toHaveLength(50)
    await expect(t.history.save('workspace', at(0))).rejects.toThrow()
    const afterBackdated = await readdir(t.folder)
    expect(afterBackdated.filter((name) => name.endsWith('.json'))).toHaveLength(50)
    await t.history.save('workspace', at(1))
    const afterRepeat = await readdir(t.folder)
    expect(afterRepeat.filter((name) => name.endsWith('.json'))).toHaveLength(50)
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'quality' })).toMatchObject({
      status: 'listed',
      entries: [{ header: { kind: 'quality' } }],
    })
  })

  it('keeps identical bytes idempotently and retrieves saved scrubbed JSON across reconnects', async () => {
    const t = await fixture()
    const document = at(1)
    document.needsYou.rows.push({
      key: 'owner',
      cells: { detail: { type: 'text', value: CANARY } },
      sourceIds: [],
    })
    const saved = await t.history.save('workspace', document)
    expect(await t.history.save('workspace', document)).toEqual(saved)
    if (saved.status !== 'saved') throw new Error('Expected saved report')
    const text = await readFile(path.join(t.folder, `${saved.entry.id}.json`), 'utf8')
    expect(text).not.toContain(CANARY)
    const reconnect = new ReportHistory({
      storage: new ReportStorage(t.directory),
      codec,
      keepHistory: () => true,
      authorize: t.authorize,
    })
    expect(
      await reconnect.get({ workspaceKey: 'workspace', kind: 'project', id: saved.entry.id }),
    ).toEqual({ status: 'retrieved', document: codec.decode(text) })
    if (process.platform === 'win32') {
      return
    }

    const folderInfo = await lstat(t.folder)
    expect(folderInfo.mode & 0o777).toBe(0o700)
    const fileInfo = await lstat(path.join(t.folder, `${saved.entry.id}.json`))
    expect(fileInfo.mode & 0o777).toBe(0o600)
  })

  it('does no storage or codec work when history is off', async () => {
    const t = await fixture(() => false)
    const transaction = vi.spyOn(t.storage, 'transaction')
    expect(await t.history.save('workspace', at(1))).toEqual({ status: 'disabled' })
    expect(transaction).not.toHaveBeenCalled()
    expect(t.authorize).not.toHaveBeenCalled()
    expect(await readdir(t.directory)).toEqual([])
  })

  it('authorizes before storage and refuses foreign, missing and unsafe ids on every method', async () => {
    const t = await fixture()
    const saved = await t.history.save('workspace', at(1))
    if (saved.status !== 'saved') throw new Error('Expected saved report')
    const transaction = vi.spyOn(t.storage, 'transaction')
    transaction.mockClear()
    expect(await t.history.history({ workspaceKey: 'foreign', kind: 'project' })).toMatchObject({
      status: 'failed',
    })
    expect(
      await t.history.get({ workspaceKey: 'foreign', kind: 'project', id: saved.entry.id }),
    ).toMatchObject({ status: 'failed' })
    expect(
      await t.history.compare({
        workspaceKey: 'foreign',
        kind: 'project',
        fromId: saved.entry.id,
        toId: saved.entry.id,
      }),
    ).toMatchObject({ status: 'failed' })
    expect(transaction).not.toHaveBeenCalled()
    for (const id of ['../escape', String.raw`..\escape`, 'missing'])
      expect(await t.history.get({ workspaceKey: 'workspace', kind: 'project', id })).toMatchObject(
        { status: 'failed' },
      )
    expect(
      await t.history.get({ workspaceKey: 'workspace', kind: 'usage', id: saved.entry.id }),
    ).toMatchObject({ status: 'failed' })
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'usage' })).toEqual({
      status: 'listed',
      entries: [],
    })
  })

  it('compares two saved ids and reports a missing comparison input explicitly', async () => {
    const t = await fixture()
    const old = await t.history.save('workspace', at(1))
    const document = at(2)
    document.sections[0]!.rows[0]!.cells['state'] = { type: 'label', value: 'merged' }
    const next = await t.history.save('workspace', document)
    if (old.status !== 'saved' || next.status !== 'saved') throw new Error('Expected saved reports')
    const result = reportsMethods['reports/compare'].result.parse(
      await t.history.compare({
        workspaceKey: 'workspace',
        kind: 'project',
        fromId: old.entry.id,
        toId: next.entry.id,
      }),
    )
    expect(result).toMatchObject({
      status: 'compared',
      diff: {
        sections: [
          { id: 'needsYou' },
          {
            id: 'status',
            changed: [
              {
                key: 'M12',
                before: { cells: { state: { value: 'planned' } } },
                after: { cells: { state: { value: 'merged' } } },
              },
            ],
          },
        ],
      },
    })
    expect(
      await t.history.compare({
        workspaceKey: 'workspace',
        kind: 'project',
        fromId: old.entry.id,
        toId: 'missing',
      }),
    ).toMatchObject({ status: 'failed' })
  })

  it('fails corrupt or hash-tampered history instead of returning an empty success', async () => {
    const t = await fixture()
    const saved = await t.history.save('workspace', at(1))
    if (saved.status !== 'saved') throw new Error('Expected saved report')
    let file = path.join(t.folder, `${saved.entry.id}.json`)
    const original = await readFile(file, 'utf8')
    const text = original.replace('planned', 'merged')
    await writeFile(file, text)
    const tamperedId = createHash('sha256').update(text).digest('hex')
    const tamperedFile = path.join(t.folder, `${tamperedId}.json`)
    await rename(file, tamperedFile)
    file = tamperedFile
    expect(
      await t.history.get({ workspaceKey: 'workspace', kind: 'project', id: tamperedId }),
    ).toMatchObject({ status: 'failed' })
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'project' })).toMatchObject({
      status: 'failed',
    })
    await writeFile(file, '{')
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'project' })).toMatchObject({
      status: 'failed',
    })
  })

  it('refuses to grow a corrupt history bucket on a failed save', async () => {
    const t = await fixture()
    await t.history.save('workspace', at(1))
    const names = await readdir(t.folder)
    const name = names.find((candidate) => candidate.endsWith('.json'))
    if (name === undefined) throw new Error('Expected saved report')
    await writeFile(path.join(t.folder, name), '{')
    await expect(t.history.save('workspace', at(2))).rejects.toThrow()
    const afterFailedSave = await readdir(t.folder)
    expect(afterFailedSave.filter((candidate) => candidate.endsWith('.json'))).toEqual([name])
  })

  it('rejects directory redirects and hard-linked saved files without touching their targets', async () => {
    const t = await fixture()
    const outside = path.join(t.directory, 'outside')
    await mkdir(outside)
    await symlink(outside, path.join(t.directory, 'reports'), 'junction')
    await expect(t.history.save('workspace', at(1))).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
    const clean = await fixture()
    const text = codec.encode(at(1))
    const id = createHash('sha256').update(text).digest('hex')
    await mkdir(clean.folder, { recursive: true })
    const target = path.join(clean.directory, 'original.json')
    await writeFile(target, text)
    await link(target, path.join(clean.folder, `${id}.json`))
    expect(
      await clean.history.get({ workspaceKey: 'workspace', kind: 'project', id }),
    ).toMatchObject({ status: 'failed' })
    expect(await readFile(target, 'utf8')).toBe(text)
  })

  it('serializes simultaneous writers, leaves no partial files and fails a held lock honestly', async () => {
    const t = await fixture()
    await Promise.all([t.history.save('workspace', at(1)), t.history.save('workspace', at(2))])
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'project' })).toMatchObject({
      status: 'listed',
      entries: [{ header: { asOf: at(2).header.asOf } }, { header: { asOf: at(1).header.asOf } }],
    })
    const names = await readdir(t.folder)
    expect(names.every((name) => name.endsWith('.json'))).toBe(true)
    await writeFile(path.join(t.folder, 'writer.lock'), '')
    await expect(t.history.save('workspace', at(3))).rejects.toThrow()
    const retained = await readdir(t.folder)
    expect(retained.filter((name) => name.endsWith('.json'))).toHaveLength(2)
  })
})
