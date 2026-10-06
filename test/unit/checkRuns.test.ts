import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { CheckRunJournal } from '../../src/core/reporting/checkRuns'
import { ReportStorage } from '../../src/core/reporting/history'
import type { CheckRunRecord } from '../../src/core/reporting/sources/types'
import { reportOptions } from './helpers/reporting/snapshot'
import { removeFolder } from './helpers/temporaryFolders'

const TEMP = path.resolve(import.meta.dirname, '../../temp')
const COMMIT = 'a'.repeat(40)
const CANARY = 'check-output-canary'

function record(index = 0): CheckRunRecord {
  return {
    check: 'lint',
    outcome: 'passed',
    durationMs: index,
    commit: COMMIT,
    at: new Date(Date.UTC(2026, 9, 6, 12, 0, index)).toISOString(),
  }
}

async function fixture() {
  await mkdir(TEMP, { recursive: true })
  const directory = await mkdtemp(path.join(TEMP, 'check-runs-'))
  onTestFinished(() => removeFolder(directory))
  const storage = new ReportStorage(directory)
  const journal = new CheckRunJournal({
    storage,
    scrub: (text) => text.replaceAll(CANARY, '[redacted]'),
  })
  const context = {
    asOf: '2026-10-06T13:00:00+00:00',
    workspaceKey: 'workspace',
    options: reportOptions(),
    signal: new AbortController().signal,
  }
  return {
    directory,
    storage,
    journal,
    context,
    file: path.join(directory, 'reports/v1/checks/workspace.jsonl'),
  }
}

describe('check-run journal', () => {
  it('bounds malformed-line inspection and marks oversized history partial', async () => {
    const t = await fixture()
    await t.storage.transaction(['checks'], true, async (files) => {
      await files.write(
        'workspace.jsonl',
        Array.from({ length: 501 }, (_, index) => JSON.stringify(record(index))).join('\n') + '\n',
      )
    })
    const result = await t.journal.source().read(t.context)
    expect(result.record.status).toBe('partial')
    expect(result.data).toHaveLength(500)
    expect(result.data?.[0]).toEqual(record(1))
  })
  it('scrubs valid legacy names on read and again when retaining prior records', async () => {
    const t = await fixture()
    await t.storage.transaction(['checks'], true, async (files) => {
      await files.write('workspace.jsonl', JSON.stringify({ ...record(), check: CANARY }) + '\n')
    })
    const source = await t.journal.source().read(t.context)
    expect(source.data).toEqual([{ ...record(), check: '[redacted]' }])
    await t.journal.append('workspace', record(1))
    expect(await readFile(t.file, 'utf8')).not.toContain(CANARY)
  })
  it('persists only five approved fields and scrubs a check name before writing', async () => {
    const t = await fixture()
    const input = {
      ...record(),
      check: CANARY,
      command: CANARY,
      stdout: CANARY,
      stderr: CANARY,
      detail: CANARY,
    }
    await t.journal.append('workspace', input)
    const text = await readFile(t.file, 'utf8')
    expect(text).not.toContain(CANARY)
    expect(JSON.parse(text)).toEqual({ ...record(), check: '[redacted]' })
    const persisted: unknown = JSON.parse(text)
    if (typeof persisted !== 'object' || persisted === null) throw new Error('Expected record')
    expect(Object.keys(persisted)).toEqual(['check', 'outcome', 'durationMs', 'commit', 'at'])
    if (!text.endsWith('\n') || text.endsWith('\n\n')) throw new Error('Expected one trailing LF')
    const names = await readdir(path.dirname(t.file))
    expect(names.every((name) => name.endsWith('.jsonl'))).toBe(true)
  })

  it('retains the incoming check and append sequence after a backwards clock correction', async () => {
    const t = await fixture()
    const prior = Array.from({ length: 500 }, (_, index) => record(index))
    await t.storage.transaction(['checks'], true, (files) =>
      files.write('workspace.jsonl', prior.map((row) => JSON.stringify(row)).join('\n') + '\n'),
    )
    const incoming = { ...record(), check: 'after-clock-correction', at: '2026-10-05T00:00:00Z' }
    await t.journal.append('workspace', incoming)
    const expected = [...prior.slice(1), incoming]
    const text = await readFile(t.file, 'utf8')
    expect(
      text
        .trimEnd()
        .split('\n')
        .map((line): unknown => JSON.parse(line)),
    ).toEqual(expected)
    const source = await t.journal.source().read(t.context)
    expect(source.record.status).toBe('ok')
    expect(source.data).toEqual(expected)
    expect(source.record.observedAt).toBe(incoming.at)
  })

  it('drops the oldest on the 501st check and keeps other workspaces independent', async () => {
    const t = await fixture()
    await t.storage.transaction(['checks'], true, async (files) => {
      await files.write(
        'workspace.jsonl',
        Array.from({ length: 500 }, (_, index) => JSON.stringify(record(index))).join('\n') + '\n',
      )
    })
    await t.journal.append('workspace', record(500))
    await t.journal.append('other', record())
    const text = await readFile(t.file, 'utf8')
    const lines = text.trimEnd().split('\n')
    expect(lines).toHaveLength(500)
    expect(JSON.parse(lines[0]!)).toEqual(record(1))
    expect(JSON.parse(lines.at(-1)!)).toEqual(record(500))
    const source = await t.journal.source().read(t.context)
    expect(source.record.status).toBe('ok')
    expect(source.data).toHaveLength(500)
    expect(source.record.freshness).toEqual({
      state: 'stale',
      ageMs: Date.parse(t.context.asOf) - Date.parse(record(500).at),
    })
    const other = await t.journal.source().read({ ...t.context, workspaceKey: 'other' })
    expect(other.data).toEqual([record()])
  })

  it('feeds a normalized source with explicit missing and corrupt evidence instead of empty success', async () => {
    const t = await fixture()
    expect(await t.journal.source().read(t.context)).toMatchObject({
      record: { id: 'checkRuns', status: 'unavailable', reason: expect.any(String) },
      data: null,
    })
    await t.journal.append('workspace', record())
    await writeFile(
      t.file,
      JSON.stringify(record()) + '\n' + JSON.stringify({ ...record(), command: CANARY }) + '\n{',
    )
    const result = await t.journal.source().read(t.context)
    expect(result).toMatchObject({
      record: { status: 'partial', reason: expect.any(String) },
      data: [record()],
    })
    expect(JSON.stringify(result)).not.toContain(CANARY)
    await writeFile(t.file, '{')
    expect(await t.journal.source().read(t.context)).toMatchObject({
      record: { status: 'partial' },
      data: [],
    })
  })

  it('rejects invalid counts, outcomes, commits, timestamps and Windows traversal before writing', async () => {
    const t = await fixture()
    for (const input of [
      { ...record(), durationMs: -1 },
      { ...record(), durationMs: Infinity },
      { ...record(), check: '' },
      { ...record(), check: 'x'.repeat(41) },
      { ...record(), commit: 'not-a-commit' },
      { ...record(), at: 'yesterday' },
    ])
      await expect(t.journal.append('workspace', input)).rejects.toThrow()
    for (const workspaceKey of ['../escape', String.raw`..\escape`])
      await expect(t.journal.append(workspaceKey, record())).rejects.toThrow()
    expect(await readdir(t.directory)).toEqual([])
    await t.journal.append('workspace', record())
    await writeFile(t.file, JSON.stringify({ ...record(), outcome: 'notRun' }) + '\n')
    expect(await t.journal.source().read(t.context)).toMatchObject({
      record: { status: 'partial' },
      data: [],
    })
  })

  it('records all contract outcomes in append order and honors cancellation', async () => {
    const t = await fixture()
    for (const outcome of ['skipped', 'cancelled', 'failed', 'passed'] as const)
      await t.journal.append('workspace', { ...record(), outcome })
    const source = t.journal.source()
    expect(source.kind).toBe('checkRuns')
    const result = await source.read(t.context)
    expect(result.data?.map((run) => run.outcome)).toEqual([
      'skipped',
      'cancelled',
      'failed',
      'passed',
    ])
    const controller = new AbortController()
    controller.abort()
    expect(await source.read({ ...t.context, signal: controller.signal })).toMatchObject({
      record: { status: 'unavailable' },
      data: null,
    })
  })

  it('serializes two independent journal instances without losing either check', async () => {
    const t = await fixture()
    const second = new CheckRunJournal({
      storage: new ReportStorage(t.directory),
      scrub: (text) => text,
    })
    await Promise.all([
      t.journal.append('workspace', record(1)),
      second.append('workspace', record(2)),
    ])
    const result = await t.journal.source().read(t.context)
    expect(result.data).toHaveLength(2)
    expect(result.data).toEqual(expect.arrayContaining([record(1), record(2)]))
  })
})
