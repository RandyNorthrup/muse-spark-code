import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as atomic from '../../src/host/fsAtomic'
import * as fileSystem from 'node:fs/promises'
import { canonicalPath } from '../../src/host/canonicalPath'
import { saveReport, reportSaveName } from '../../src/core/reporting/destinations/save'
import { reportDestinationSchema } from '../../src/core/reporting/destinations/types'
import { deliveryPayload } from './helpers/reporting/destinations'

vi.mock('node:fs/promises', { spy: true })

const folders: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm113-q-save-'))
  folders.push(root)
  return root
}
const destination = (root: string, template = '{kind}-{date}.{ext}', retention = 30) => ({
  type: 'save' as const,
  id: 'save',
  root,
  storage: 'local' as const,
  template,
  retention,
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of folders.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('report save confinement and ownership', () => {
  it('uses the default template and exact report bytes', async () => {
    const root = await fixture()
    const payload = deliveryPayload()
    const saved = await saveReport('schedule-one', destination(root), payload, [
      await canonicalPath(root),
    ])
    expect(path.basename(saved)).toBe('project-2026-10-06.md')
    expect(await readFile(saved, 'utf8')).toBe(payload.attachment)
    expect(await readdir(root)).toEqual(
      expect.arrayContaining(['.schedule-one.report-manifest.json', 'project-2026-10-06.md']),
    )
  })
  it('renders every template token and portable scope names', () => {
    const payload = deliveryPayload()
    const name = reportSaveName(
      destination('C:/reports', '{kind}-{scope}-{date}-{time}-{hash8}.{ext}'),
      payload,
    )
    expect(name).toBe(
      `project-Fixture-workspace-2026-10-06-12-00-00Z-${payload.document.header.contentHash.slice(0, 8)}.md`,
    )
  })
  it.each([
    '../outside.md',
    String.raw`..\outside.md`,
    '/outside.md',
    '{unknown}.md',
    'CON.md',
    'aux',
    'report.md ',
    'C:report.md',
    '{kind}/{date}.md',
    String.raw`{kind}\{date}.md`,
  ])('refuses unsafe template %s', async (template) => {
    const root = await fixture()
    expect(() => reportSaveName(destination(root, template), deliveryPayload())).toThrow()
    await expect(
      saveReport('schedule-one', destination(root, template), deliveryPayload(), [root]),
    ).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
  it('refuses an ungranted root and invalid schedule identity', async () => {
    const root = await fixture()
    const other = await fixture()
    await expect(
      saveReport('schedule-one', destination(root), deliveryPayload(), [other]),
    ).rejects.toThrow()
    await expect(
      saveReport('../owner', destination(root), deliveryPayload(), [root]),
    ).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })
  it('refuses a planted directory junction and file link', async () => {
    const root = await fixture()
    const outside = await fixture()
    await symlink(outside, path.join(root, 'escape'), 'junction')
    await expect(
      saveReport('schedule-one', destination(path.join(root, 'escape')), deliveryPayload(), [
        await canonicalPath(root),
      ]),
    ).rejects.toThrow()
    // A file-link fake is injected only where Windows needs symlink privilege;
    // the real directory junction above exercises the operating system resolver.
    const original = canonicalPath
    const canonical = vi.spyOn(await import('../../src/host/canonicalPath'), 'canonicalPath')
    canonical.mockImplementation((target, options) =>
      path.basename(target) === 'project-2026-10-06.md'
        ? Promise.resolve(path.join(outside, 'foreign.md'))
        : original(target, options),
    )
    await expect(
      saveReport('schedule-one', destination(root), deliveryPayload(), [root]),
    ).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
  })
  it('never overwrites a foreign file or another schedule output', async () => {
    const root = await fixture()
    const target = path.join(root, 'project-2026-10-06.md')
    await writeFile(target, 'user file')
    const read = vi.mocked(fileSystem.readFile)
    read.mockClear()
    await expect(
      saveReport('schedule-one', destination(root), deliveryPayload(), [root]),
    ).rejects.toThrow()
    expect(read.mock.calls.map(([file]) => file)).not.toContain(target)
    expect(await readFile(target, 'utf8')).toBe('user file')
    await rm(target)
    await saveReport('schedule-one', destination(root), deliveryPayload(), [root])
    await expect(
      saveReport('schedule-two', destination(root), deliveryPayload(), [root]),
    ).rejects.toThrow()
  })
  it('refuses hard-linked manifest data before reading it', async () => {
    const root = await fixture()
    const privateFile = path.join(root, 'foreign.json')
    await writeFile(privateFile, 'private fixture data')
    await fileSystem.link(privateFile, path.join(root, '.one.report-manifest.json'))
    const read = vi.mocked(fileSystem.readFile)
    read.mockClear()
    await expect(saveReport('one', destination(root), deliveryPayload(), [root])).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
  it('retains newest N, only removes owned unchanged files, and preserves a manual replacement', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'user.md'), 'keep me')
    const item = destination(root, '{kind}-{date}.{ext}', 1)
    const first = await saveReport('one', item, deliveryPayload('2026-10-04T12:00:00+00:00'), [
      root,
    ])
    await saveReport('two', item, deliveryPayload('2026-10-03T12:00:00+00:00'), [root])
    await writeFile(first, 'manual replacement')
    await saveReport('one', item, deliveryPayload('2026-10-05T12:00:00+00:00'), [root])
    await saveReport('one', item, deliveryPayload(), [root])
    expect(await readFile(first, 'utf8')).toBe('manual replacement')
    expect(await readdir(root)).toContain('project-2026-10-03.md')
    expect(await readdir(root)).not.toContain('project-2026-10-05.md')
    expect(await readFile(path.join(root, 'user.md'), 'utf8')).toBe('keep me')
  })
  it('uses atomic staging: a failed publication leaves the old report complete', async () => {
    const root = await fixture()
    const payload = deliveryPayload()
    const target = await saveReport('one', destination(root), payload, [root])
    const original = atomic.writeFileIfUnchanged
    vi.spyOn(atomic, 'writeFileIfUnchanged').mockImplementation(
      (file, expected, content, options) =>
        original(file, expected, content, {
          ...options,
          sleep: () => Promise.resolve(),
          rename: () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })),
        }),
    )
    await expect(
      saveReport('one', destination(root), { ...payload, attachment: 'new complete bytes' }, [
        root,
      ]),
    ).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe(payload.attachment)
    const deliveryResult1 = await readdir(root)
    expect(deliveryResult1.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
  it('retains the newest instant across offset changes, not the largest clock string', async () => {
    const root = await fixture()
    const item = destination(root, '{kind}-{hash8}-{time}.{ext}', 1)
    const newer = await saveReport('one', item, deliveryPayload('2026-10-06T11:00:00-07:00'), [
      root,
    ])
    const older = await saveReport('one', item, deliveryPayload('2026-10-06T17:00:00+00:00'), [
      root,
    ])
    expect(await readFile(newer, 'utf8')).toBe(
      deliveryPayload('2026-10-06T11:00:00-07:00').attachment,
    )
    expect(await readdir(root)).not.toContain(path.basename(older))
  })
  it('refuses tampered manifests and retention bounds', async () => {
    const root = await fixture()
    await mkdir(path.join(root, 'sub'))
    await writeFile(
      path.join(root, '.one.report-manifest.json'),
      JSON.stringify({
        scheduleId: 'one',
        entries: [
          {
            name: '../foreign.md',
            occurrence: '2026-10-05T00:00:00Z',
            fingerprint: 'a'.repeat(64),
          },
        ],
      }),
    )
    await expect(saveReport('one', destination(root), deliveryPayload(), [root])).rejects.toThrow()
    expect(reportDestinationSchema.safeParse(destination(root, '{kind}.{ext}', 0)).success).toBe(
      false,
    )
    expect(reportDestinationSchema.safeParse(destination(root, '{kind}.{ext}', 1001)).success).toBe(
      false,
    )
  })
})
