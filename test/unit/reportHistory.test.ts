import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import * as fsPromises from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
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
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ReportHistory,
  ReportStorage,
  type ReportHistoryCodec,
} from '../../src/core/reporting/history'
import { reportDocumentSchema, type ReportDocument } from '../../src/shared/reportSchema'
import { reportsMethods } from '../../src/shared/hostApi/reports'
import {
  REPORT_MAX_SOURCES,
  REPORT_MAX_TEXT_CHARS,
  REPORT_WRITER_LOCK_WAIT_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import { reportDocument } from './helpers/reporting/snapshot'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof fsPromises>('node:fs/promises')
  return { ...actual }
})

const TEMP = path.resolve(import.meta.dirname, '../../temp')
const CANARY = 'private-history-canary'
const writerFixture: { script?: string } = {}
beforeAll(async () => {
  const bundled = await build({
    stdin: {
      contents: `import { ReportStorage } from './src/core/reporting/history';
        await new ReportStorage(process.argv[2]).transaction(['checks'], true, async () => {
          process.stdout.write('locked');
          await new Promise(() => { setInterval(() => {}, 1000) });
        });`,
      resolveDir: path.resolve(import.meta.dirname, '../..'),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const output = bundled.outputFiles[0]
  if (output === undefined) throw new Error('Expected writer fixture bundle')
  writerFixture.script = output.text
})

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

// Seed old artifacts as fixture files: fsync belongs to the save being tested,
// not fifty artificial prior saves (which exhaust the CI deadline on busy disks).
async function seedReports(folder: string, count: number): Promise<void> {
  await mkdir(folder, { recursive: true })
  await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const text = codec.encode(at(index))
      await writeFile(
        path.join(folder, `${createHash('sha256').update(text).digest('hex')}.json`),
        text,
      )
    }),
  )
}

async function heldWriter(after?: Parameters<ReportStorage['transaction']>[2]) {
  const t = await fixture()
  const ready = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const held = t.storage.transaction(['checks'], true, async (files) => {
    ready.resolve(undefined)
    await release.promise
    await after?.(files)
  })
  await ready.promise
  const lock = path.join(t.directory, 'reports/v1/checks/writer.lock')
  const owner = await readFile(lock, 'utf8')
  return { ...t, release, held, lock, owner }
}

describe('report history', () => {
  it('recovers the writer lock after killing its owner process', async () => {
    const t = await fixture()
    if (writerFixture.script === undefined) throw new Error('Expected writer fixture')
    const script = path.join(t.directory, 'writer-fixture.mjs')
    await writeFile(script, writerFixture.script)
    const child = spawn(process.execPath, [script, t.directory], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: withoutCredentials(process.env),
    })
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    })
    await once(child.stdout, 'data')
    const lock = path.join(t.directory, 'reports/v1/checks/writer.lock')
    const owner: unknown = JSON.parse(await readFile(lock, 'utf8'))
    expect(owner).toMatchObject({ pid: child.pid, startedAt: expect.any(String) })
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    const restarted = new ReportStorage(t.directory)
    await restarted.transaction(['checks'], true, (files) => files.write('restarted.json', '{}'))
    expect(await readFile(path.join(path.dirname(lock), 'restarted.json'), 'utf8')).toBe('{}')
    expect(await readdir(path.dirname(lock))).toEqual(['restarted.json'])
  })

  it('recovers a reused PID with a mismatched process start time and an unfinished lock', async () => {
    const t = await fixture()
    const text = await t.storage.transaction(['checks'], true, (files) => files.read('writer.lock'))
    if (text === undefined) throw new Error('Expected owner record')
    const owner: unknown = JSON.parse(text)
    const lock = path.join(t.directory, 'reports/v1/checks/writer.lock')
    expect(owner).toMatchObject({ pid: process.pid, startedAt: expect.any(String) })
    await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: 'a-previous-process' }))
    await t.storage.transaction(['checks'], true, (files) => files.write('reused.json', '{}'))
    // A kill between exclusive creation and the owner-record write leaves no JSON.
    await writeFile(lock, '')
    await t.storage.transaction(['checks'], true, (files) => files.write('unfinished.json', '{}'))
    expect(await readdir(path.dirname(lock))).toEqual(['reused.json', 'unfinished.json'])
  })

  it('waits for a live writer held longer than the old 100 ms contention budget', async () => {
    const t = await fixture()
    const ready = Promise.withResolvers<undefined>()
    const first = t.storage.transaction(['checks'], true, async (files) => {
      ready.resolve(undefined)
      await delay(250)
      await files.write('first.json', '{}')
    })
    await ready.promise
    const second = new ReportStorage(t.directory).transaction(['checks'], true, (files) =>
      files.write('second.json', '{}'),
    )
    await Promise.all([first, second])
    expect(await readdir(path.join(t.directory, 'reports/v1/checks'))).toEqual([
      'first.json',
      'second.json',
    ])
  })

  it('fails a live-owner timeout honestly without running or deleting its lock', async () => {
    const t = await heldWriter()
    const work = vi.fn(() => Promise.resolve())
    const started = performance.now()
    try {
      await expect(
        new ReportStorage(t.directory).transaction(['checks'], true, work),
      ).rejects.toThrow()
      expect(performance.now() - started).toBeGreaterThanOrEqual(REPORT_WRITER_LOCK_WAIT_MS)
      expect(work).not.toHaveBeenCalled()
      expect(await readFile(t.lock, 'utf8')).toBe(t.owner)
    } finally {
      t.release.resolve(undefined)
      await t.held
    }
    expect(await readdir(path.dirname(t.lock))).toEqual([])
  })

  it('retries a lock record that changes while its creator is initializing it', async () => {
    const t = await heldWriter((files) => files.write('first.json', '{}'))
    const reading = vi.spyOn(fileIdentity, 'handleIdentity').mockImplementationOnce(() => {
      t.release.resolve(undefined)
      return Promise.reject(new Error(UI_TEXT.reportUi.generationFailed))
    })
    try {
      await new ReportStorage(t.directory).transaction(['checks'], true, (files) =>
        files.write('second.json', '{}'),
      )
    } finally {
      reading.mockRestore()
      t.release.resolve(undefined)
      await t.held
    }
    expect(await readdir(path.join(t.directory, 'reports/v1/checks'))).toEqual([
      'first.json',
      'second.json',
    ])
  })

  it('keeps lock-read races inside the total contention deadline', async () => {
    const t = await heldWriter()
    let tick = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => {
      tick += REPORT_WRITER_LOCK_WAIT_MS
      return tick
    })
    const original = fsPromises.open
    let reads = 0
    const racingRead = vi
      .spyOn(fsPromises, 'open')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.open>) => {
        if (
          typeof args[1] === 'number' &&
          String(args[0]).replaceAll('\\', '/').endsWith('/writer.lock')
        ) {
          reads += 1
          if (reads === 1)
            throw Object.assign(new Error('Lock vanished during open'), { code: 'ENOENT' })
        }
        return await original(...args)
      })
    const work = vi.fn(() => Promise.resolve())
    try {
      await expect(
        new ReportStorage(t.directory).transaction(['checks'], true, work),
      ).rejects.toThrow()
      expect(reads).toBe(1)
      expect(work).not.toHaveBeenCalled()
      expect(await readFile(t.lock, 'utf8')).toBe(t.owner)
    } finally {
      clock.mockRestore()
      racingRead.mockRestore()
      t.release.resolve(undefined)
      await t.held
    }
  })

  it('refuses work by a creator paused before its recovered lock was initialized', async () => {
    const t = await fixture()
    const ready = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const original = fsPromises.open
    let isFirst = true
    const paused = vi
      .spyOn(fsPromises, 'open')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.open>) => {
        const handle = await original(...args)
        if (
          isFirst &&
          args[1] === 'wx' &&
          String(args[0]).replaceAll('\\', '/').endsWith('/writer.lock')
        ) {
          isFirst = false
          ready.resolve(undefined)
          await resume.promise
        }
        return handle
      })
    const work = vi.fn(() => Promise.resolve())
    const first = t.storage.transaction(['checks'], true, work)
    await ready.promise
    try {
      await new ReportStorage(t.directory).transaction(['checks'], true, (files) =>
        files.write('recovered.json', '{}'),
      )
    } finally {
      paused.mockRestore()
      resume.resolve(undefined)
    }
    await expect(first).rejects.toThrow()
    expect(work).not.toHaveBeenCalled()
    expect(await readdir(path.join(t.directory, 'reports/v1/checks'))).toEqual(['recovered.json'])
  })

  it.each([50, 51])(
    'reports failed pruning without growing %i artifacts and retries next write',
    async (count) => {
      const t = await fixture()
      await seedReports(t.folder, count)
      const original = fsPromises.unlink
      const denied = vi.spyOn(fsPromises, 'unlink').mockImplementation((file) => {
        return String(file).replaceAll('\\', '/').endsWith('.json')
          ? Promise.reject(Object.assign(new Error('Prune denied'), { code: 'EPERM' }))
          : original(file)
      })
      try {
        for (const index of [51, 52, 53]) {
          await expect(t.history.save('workspace', at(index))).rejects.toThrow()
          const names = await readdir(t.folder)
          expect(names.filter((name) => name.endsWith('.json'))).toHaveLength(count)
        }
        const listed = await t.history.history({ workspaceKey: 'workspace', kind: 'project' })
        expect(listed.status).toBe(count > 50 ? 'failed' : 'listed')
        if (count > 50) {
          const text = codec.encode(at(0))
          const id = createHash('sha256').update(text).digest('hex')
          expect(
            await t.history.get({ workspaceKey: 'workspace', kind: 'project', id }),
          ).toMatchObject({ status: 'failed' })
        }
      } finally {
        denied.mockRestore()
      }
      const saved = await t.history.save('workspace', at(54))
      expect(saved.status).toBe('saved')
      const names = await readdir(t.folder)
      expect(names.filter((name) => name.endsWith('.json'))).toHaveLength(50)
      const listed = await t.history.history({ workspaceKey: 'workspace', kind: 'project' })
      if (listed.status !== 'listed') throw new Error('Expected repaired history')
      expect(listed.entries).toHaveLength(50)
      expect(listed.entries[0]?.header.asOf).toBe(at(54).header.asOf)
    },
  )

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
    await seedReports(t.folder, 50)
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

  it('serializes simultaneous writers and leaves no partial files', async () => {
    const t = await fixture()
    await Promise.all([t.history.save('workspace', at(1)), t.history.save('workspace', at(2))])
    expect(await t.history.history({ workspaceKey: 'workspace', kind: 'project' })).toMatchObject({
      status: 'listed',
      entries: [{ header: { asOf: at(2).header.asOf } }, { header: { asOf: at(1).header.asOf } }],
    })
    const names = await readdir(t.folder)
    expect(names.every((name) => name.endsWith('.json'))).toBe(true)
  })
})
