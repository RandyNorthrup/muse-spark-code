import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as fileSystem from 'node:fs/promises'
import { changelogSource } from '../../src/core/reporting/sources/changelog'
import { certificationSource } from '../../src/core/reporting/sources/certification'
import { packageSource } from '../../src/core/reporting/sources/package'
import { LocalSourceError, type LocalFileIo } from '../../src/core/reporting/sources/local'
import { reportFileIo } from '../../src/runtime/reporting/sources'
import { reportOptions, REPORT_FIXTURE_AS_OF } from './helpers/reporting/snapshot'
import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS, UI_TEXT } from '../../src/shared/constants'

const context = () => ({
  asOf: REPORT_FIXTURE_AS_OF,
  workspaceKey: 'fixture',
  options: reportOptions(),
  signal: new AbortController().signal,
})
vi.mock(import('node:fs/promises'), { spy: true })
const files = (text: string): LocalFileIo => ({
  read: () => Promise.resolve(text),
  list: () => Promise.resolve([]),
})
describe('local report files', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'm113-files-'))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })
  it('reads Keep a Changelog sections and scrubs notes while retaining their order', async () => {
    const text =
      '# Changelog\r\n## [Unreleased]\r\n### Fixed\r\n- private-note\r\n## [0.14.2] - 2026-10-05\r\n- Released.\r\n[Unreleased]: https://example.invalid\r\n'
    const result = await changelogSource(files(text), (value) =>
      value.replace('private-note', '[redacted]'),
    ).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.sections).toEqual([
      { version: '0.14.2', date: '2026-10-05', lines: ['- Released.'] },
      { version: 'Unreleased', date: null, lines: ['### Fixed', '- [redacted]'] },
    ])
  })
  it('reports missing and malformed changelogs with reasons and null data', async () => {
    const io: LocalFileIo = {
      ...files(''),
      read: () => Promise.reject(new LocalSourceError('missing')),
    }
    expect(await changelogSource(io, (value) => value).read(context())).toMatchObject({
      record: { status: 'unavailable', reason: expect.any(String) },
      data: null,
    })
    const observed1 = await changelogSource(files('## Not a release'), (value) => value).read(
      context(),
    )
    expect(observed1.record.status).toBe('unavailable')
    const observed2 = await changelogSource(
      files('## [Unreleased]\n## [Unreleased]'),
      (value) => value,
    ).read(context())
    expect(observed2.data).toBeNull()
  })
  it('collects nested certification checklists with normalized paths and milestone ids', async () => {
    await mkdir(path.join(root, 'docs/certification/nested'), { recursive: true })
    await writeFile(
      path.join(root, 'docs/certification/m12-s.md'),
      '- [x] Passed\n- [ ] private-note\n',
    )
    await writeFile(path.join(root, 'docs/certification/nested/m110a0.md'), '- [x] Nested\n')
    const result = await certificationSource(reportFileIo(root, process.platform), (value) =>
      value.replace('private-note', '[redacted]'),
    ).read(context())
    expect(result.record.status).toBe('ok')
    expect(result.data?.records).toEqual([
      {
        path: 'docs/certification/m12-s.md',
        milestoneId: 'M12',
        checklist: [
          { text: 'Passed', done: true },
          { text: '[redacted]', done: false },
        ],
      },
      {
        path: 'docs/certification/nested/m110a0.md',
        milestoneId: 'M110a0',
        checklist: [{ text: 'Nested', done: true }],
      },
    ])
  })
  it('retains a partial source when one certification record cannot be read', async () => {
    const io: LocalFileIo = {
      list: () =>
        Promise.resolve([
          { name: 'm12.md', directory: false },
          { name: 'm13.md', directory: false },
        ]),
      read: (file) =>
        file.endsWith('m13.md')
          ? Promise.reject(new LocalSourceError('failed'))
          : Promise.resolve('- [x] Passed'),
    }
    const result = await certificationSource(io, (value) => value).read(context())
    expect(result.record.status).toBe('partial')
    expect(result.data?.records).toHaveLength(1)
  })
  it('bounds certification traversal even when entries are not matching records', async () => {
    const entries = Array.from({ length: REPORT_MAX_ROWS + 1 }, (_, index) => ({
      name: `${String(index)}.txt`,
      directory: false,
    }))
    const io: LocalFileIo = { ...files(''), list: () => Promise.resolve(entries) }
    const result = await certificationSource(io, (text) => text).read(context())
    expect(result).toMatchObject({
      record: { status: 'unavailable', reason: UI_TEXT.reportSourceReasons.limit },
      data: null,
    })
  })
  it('refuses changelog notes beyond the report text bound', async () => {
    const result = await changelogSource(
      files(`## [Unreleased]\n- ${'a'.repeat(REPORT_MAX_TEXT_CHARS + 1)}`),
      (text) => text,
    ).read(context())
    expect(result).toMatchObject({
      record: { status: 'unavailable', reason: UI_TEXT.reportSourceReasons.limit },
      data: null,
    })
  })
  it('reads required quality script declarations transitively without executing them', async () => {
    const result = await packageSource(
      files(
        JSON.stringify({
          scripts: {
            quality: 'run-s quality:gates test:a11y',
            'quality:gates': 'npm run typecheck',
            typecheck: 'run-s typecheck:*',
            'typecheck:host': 'tsc -p tsconfig.json',
            'test:a11y': 'node a11y.mjs',
            unrelated: 'private-note',
          },
        }),
      ),
      (value) => value,
    ).read(context())
    expect(result.data?.qualityScripts.map((row) => row.name)).toEqual([
      'quality',
      'quality:gates',
      'test:a11y',
      'typecheck',
      'typecheck:host',
    ])
    expect(JSON.stringify(result)).not.toContain('private-note')
  })
  it('refuses private names, traversal and Windows separators before reading', async () => {
    const io = reportFileIo(root, process.platform)
    for (const file of [
      'auth.json',
      '.credentials.json',
      '.env',
      '.env.production',
      'id_rsa',
      'test.pem',
      String.raw`..\foreign.md`,
    ]) {
      await expect(io.read(file, context().signal)).rejects.toMatchObject({ code: 'refused' })
    }
    expect(await io.read(String.raw`docs\certification\m12-s.md`, context().signal)).toContain(
      'Passed',
    )
  })
  it('refuses oversized files before loading and rejects invalid UTF-8', async () => {
    await writeFile(path.join(root, 'large.md'), 'oversized')
    const openFile = vi.mocked(fileSystem.open)
    openFile.mockClear()
    await expect(
      reportFileIo(root, process.platform, 2).read('large.md', context().signal),
    ).rejects.toMatchObject({ code: 'limit' })
    expect(openFile).not.toHaveBeenCalled()
    await writeFile(path.join(root, 'invalid.md'), Buffer.from([0xff]))
    await expect(
      reportFileIo(root, process.platform).read('invalid.md', context().signal),
    ).rejects.toMatchObject({ code: 'invalid' })
  })
  it('refuses NUL text as a binary source', async () => {
    await writeFile(path.join(root, 'binary.md'), '\0')
    await expect(
      reportFileIo(root, process.platform).read('binary.md', context().signal),
    ).rejects.toMatchObject({ code: 'invalid' })
  })
  it('does not read files after cancellation', async () => {
    const read = vi.fn<LocalFileIo['read']>()
    const result = await changelogSource({ ...files(''), read }, (text) => text).read({
      ...context(),
      signal: AbortSignal.abort(),
    })
    expect(result.record.status).toBe('unavailable')
    expect(read).not.toHaveBeenCalled()
  })
  it('refuses directory links outside the allowed root and credential hard-link aliases', async () => {
    const allowed = path.join(root, 'allowed')
    const outside = path.join(root, 'outside')
    await mkdir(allowed)
    await mkdir(outside)
    await writeFile(path.join(outside, 'notes.md'), 'Synthetic outside marker')
    await symlink(
      outside,
      path.join(allowed, 'foreign'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const io = reportFileIo(allowed, process.platform)
    await expect(io.read('foreign/notes.md', context().signal)).rejects.toMatchObject({
      code: 'refused',
    })
    await writeFile(path.join(allowed, 'auth.json'), 'Synthetic fixture marker')
    await link(path.join(allowed, 'auth.json'), path.join(allowed, 'alias.md'))
    await expect(io.read('alias.md', context().signal)).rejects.toMatchObject({ code: 'refused' })
  })
})
