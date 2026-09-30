// Saved plans on the real file system (M79): the store over the host's plan
// I/O. A new file every time and never a replacement, the plan byte for
// byte, the plans folder confined to the workspace's own `.agents/plans`
// (a junction, which Windows makes without privilege, is refused), bounded
// reads, and the Plans… listing.

import { randomUUID } from 'node:crypto'
import { realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLAN_MARKDOWN } from '../../src/core/plans/planMarkdown'
import { PlanStore } from '../../src/core/plans/planStore'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { WorkspaceEdits, type WorkspaceEditRecorder } from '../../src/core/verify/workspaceEdits'
import { createPlanIo } from '../../src/host/planFeatures'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  PLAN_FILE_MAX_BYTES,
  PLAN_NAME_ATTEMPTS,
  PLAN_STAGE_STALE_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { fakePlanFiles } from './helpers/fakePlanFiles'
import { FakeLogOutputChannel } from './helpers/fakes'
import { CAPTURED_PLAN_BODY } from './helpers/m79Capture'
import { pdfFixture } from './helpers/pdfFixture'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '', outside: '' }
const NOON = new Date(2026, 8, 27, 12, 0, 0)
const log = new FakeLogOutputChannel()

beforeAll(async () => {
  paths.root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-plans-')))
  paths.outside = path.join(paths.root, 'outside')
  await mkdir(paths.outside, { recursive: true })
})

afterAll(async () => {
  await removeFolder(paths.root)
})

async function workspace(name: string): Promise<{ root: string; store: PlanStore }> {
  const root = path.join(paths.root, name)
  await mkdir(root, { recursive: true })
  return {
    root,
    store: new PlanStore({
      workspaceRoot: root,
      platform: process.platform,
      io: createPlanIo({ log, now: () => Date.now() }),
      markdown: () => PLAN_MARKDOWN,
    }),
  }
}

function plansFolder(root: string): string {
  return path.join(root, '.agents', 'plans')
}

describe('PlanStore on the file system (M79)', () => {
  it.each(['created', 'existing', 'failed'])(
    'brackets a held plan publication and counts only a new file: %s',
    async (outcome) => {
      const { root } = await workspace(`publication-${outcome}`)
      const io = createPlanIo({ log, now: () => Date.now() })
      const registry = new WorkspaceEdits()
      const other = new VerifyLedger()
      registry.add(other)
      const entered = Promise.withResolvers<undefined>()
      const held = Promise.withResolvers<undefined>()
      const finished: boolean[] = []
      const owners: (WorkspaceEditRecorder | undefined)[] = []
      const owner = vi.fn()
      const content = { title: 'Held', savedAt: NOON, text: '# Held' }
      if (outcome === 'existing') {
        await new PlanStore({
          workspaceRoot: root,
          platform: process.platform,
          io,
          markdown: () => PLAN_MARKDOWN,
        }).save(content)
      }
      const store = new PlanStore({
        workspaceRoot: root,
        platform: process.platform,
        markdown: () => PLAN_MARKDOWN,
        io: {
          ...io,
          createFile: async (absolutePath, text) => {
            entered.resolve(undefined)
            await held.promise
            if (outcome === 'failed') {
              throw new Error('publication failed')
            }
            return await io.createFile(absolutePath, text)
          },
        },
        beginEdit: (file, owner) => {
          owners.push(owner)
          const complete = registry.beginEdit(file, [file.relative])
          return (written) => {
            finished.push(written)
            complete()
          }
        },
      })
      const saved = store.save(content, owner)
      const settled = (async () => {
        try {
          return { value: await saved }
        } catch (error: unknown) {
          return { error }
        }
      })()
      await entered.promise
      other.resetForMessage()
      expect(other.changesWhatRuns('cat .agents/plans/2026-09-27-held.md')).toBe(true)
      held.resolve(undefined)
      const result = await settled
      if ('value' in result) {
        expect(result.value.isNew).toBe(outcome === 'created')
      } else {
        expect(result.error).toBeInstanceOf(Error)
        expect(outcome).toBe('failed')
      }
      expect(finished).toEqual([outcome === 'created'])
      expect(owners).toEqual([owner])
      other.resetForMessage()
      expect(other.changesWhatRuns('cat .agents/plans/2026-09-27-held.md')).toBe(false)
    },
  )

  it('saves the plan byte for byte to .agents/plans/<date>-<slug>.md', async () => {
    const { root, store } = await workspace('save')
    const saved = await store.save({
      title: 'Add a README',
      savedAt: NOON,
      text: CAPTURED_PLAN_BODY,
    })
    expect(saved).toEqual({
      fileName: '2026-09-27-add-a-readme.md',
      relativePath: '.agents/plans/2026-09-27-add-a-readme.md',
      isNew: true,
    })
    const written = await readFile(path.join(plansFolder(root), saved.fileName))
    expect(written.equals(Buffer.from(CAPTURED_PLAN_BODY, 'utf8'))).toBe(true)
    // No stage is left beside it.
    expect(await readdir(plansFolder(root))).toEqual([saved.fileName])
  })

  it('finds the same plan saved already instead of writing it twice', async () => {
    const { root, store } = await workspace('same')
    const content = { title: 'Same', savedAt: NOON, text: '1. Once.' }
    await expect(store.find(content)).resolves.toBeUndefined()
    await store.save(content)
    await expect(store.find(content)).resolves.toEqual({
      fileName: '2026-09-27-same.md',
      relativePath: '.agents/plans/2026-09-27-same.md',
    })
    // Another panel saving it again gets the same file, not a -2.
    await expect(store.save(content)).resolves.toMatchObject({
      fileName: '2026-09-27-same.md',
      isNew: false,
    })
    // Edited since: a different plan under that name, so a new file.
    await writeFile(path.join(plansFolder(root), '2026-09-27-same.md'), '1. Edited.')
    await expect(store.find(content)).resolves.toBeUndefined()
    await expect(store.save(content)).resolves.toMatchObject({
      fileName: '2026-09-27-same-2.md',
      isNew: true,
    })
  })

  it('says a file where the plans folder should be is not a folder, never that every name is taken', async () => {
    const { root, store } = await workspace('not-a-folder')
    await mkdir(path.join(root, '.agents'), { recursive: true })
    await writeFile(plansFolder(root), 'a file')
    await expect(store.save({ title: 'x', savedAt: NOON, text: 'x' })).rejects.toThrow(
      /not a folder|ENOTDIR/,
    )
    await expect(store.list()).rejects.toThrow(/ENOTDIR|not a directory/)
  })

  it('removes a stale hidden stage on the next save or listing, and leaves a fresh one', async () => {
    const { root, store } = await workspace('stages')
    await mkdir(plansFolder(root), { recursive: true })
    const stale = path.join(plansFolder(root), `.a.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`)
    const fresh = path.join(plansFolder(root), `.b.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`)
    // An old plan is not a stage: only the hidden stage names are swept.
    const oldPlan = path.join(plansFolder(root), '2026-09-01-old.md')
    await writeFile(stale, 'left by a crash')
    await writeFile(fresh, 'a save under way')
    await writeFile(oldPlan, '# Old')
    const old = new Date(Date.now() - PLAN_STAGE_STALE_MS - 1000)
    await utimes(stale, old, old)
    await utimes(oldPlan, old, old)
    await expect(store.list()).resolves.toEqual([
      {
        fileName: '2026-09-01-old.md',
        relativePath: '.agents/plans/2026-09-01-old.md',
        title: 'Old',
      },
    ])
    const left = await readdir(plansFolder(root))
    expect(new Set(left)).toEqual(new Set([path.basename(fresh), '2026-09-01-old.md']))
  })

  it.each(['file replacement', 'folder swap', 'in-place refresh'] as const)(
    'preserves a nonowned or refreshed stale-stage candidate after %s during cleanup',
    async (change) => {
      const { root } = await workspace(`cleanup-${change.replaceAll(' ', '-')}`)
      const folder = plansFolder(root)
      const elsewhere = path.join(paths.root, `cleanup-outside-${change.replaceAll(' ', '-')}`)
      await mkdir(folder, { recursive: true })
      await mkdir(elsewhere)
      const name = `.a.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
      const stage = path.join(folder, name)
      await writeFile(stage, 'owned old stage')
      const now = Date.now()
      const old = new Date(now - PLAN_STAGE_STALE_MS - 1000)
      await utimes(stage, old, old)
      const io = createPlanIo({
        log,
        now: () => {
          if (change === 'file replacement') {
            renameSync(stage, `${stage}-moved`)
            writeFileSync(stage, 'replacement bytes')
          } else if (change === 'folder swap') {
            renameSync(folder, `${folder}-moved`)
            writeFileSync(path.join(elsewhere, name), 'foreign bytes')
            symlinkSync(elsewhere, folder, 'junction')
          } else {
            writeFileSync(stage, 'refreshed bytes')
          }
          return now
        },
      })
      await io.removeStaleStages(folder)
      const survivor = change === 'folder swap' ? path.join(elsewhere, name) : stage
      const contents = {
        'in-place refresh': 'refreshed bytes',
        'file replacement': 'replacement bytes',
        'folder swap': 'foreign bytes',
      }[change]
      await expect(readFile(survivor, 'utf8')).resolves.toBe(contents)
      if (change === 'in-place refresh') {
        return
      }
      const original =
        change === 'file replacement' ? `${stage}-moved` : path.join(`${folder}-moved`, name)
      await expect(readFile(original, 'utf8')).resolves.toBe('owned old stage')
    },
  )

  it('refuses a plans folder swapped for a junction after it was checked, writing nothing there', async () => {
    const { root } = await workspace('swapped')
    const folder = plansFolder(root)
    const elsewhere = path.join(paths.root, 'swapped-elsewhere')
    await mkdir(folder, { recursive: true })
    await mkdir(elsewhere, { recursive: true })
    const io = createPlanIo({ log, now: () => Date.now() })
    const store = new PlanStore({
      workspaceRoot: root,
      platform: process.platform,
      markdown: () => PLAN_MARKDOWN,
      io: {
        ...io,
        // The name was checked; the folder is swapped before the file is made.
        createFile: async (absolutePath, content) => {
          await rename(folder, `${folder}-moved`)
          await symlink(elsewhere, folder, 'junction')
          return await io.createFile(absolutePath, content)
        },
      },
    })
    try {
      await expect(store.save({ title: 'x', savedAt: NOON, text: 'x' })).rejects.toThrow(
        /now leads elsewhere/,
      )
      expect(await readdir(elsewhere)).toEqual([])
    } finally {
      await rm(folder, { force: true })
    }
  })

  it('holds a file that looks like a PDF to the plan limit, never the document one', async () => {
    const { root, store } = await workspace('pdf-like')
    await mkdir(plansFolder(root), { recursive: true })
    const big = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(PLAN_FILE_MAX_BYTES * 2, 0x20),
    ])
    await writeFile(path.join(plansFolder(root), 'looks.md'), big)
    await expect(store.read('looks.md')).rejects.toThrow(UI_TEXT.textFileInvalid)
    const io = createPlanIo({ log, now: () => Date.now() })
    const target = path.join(plansFolder(root), 'looks.md')
    const read = await io.readFile(target, PLAN_FILE_MAX_BYTES, target)
    // The size, not the bytes: a failure names a number, not half a megabyte.
    expect({ size: read.bytes?.byteLength, isPdf: read.isPdf }).toEqual({
      size: undefined,
      isPdf: true,
    })
  })

  it('refuses names with control or format characters', async () => {
    const { store } = await workspace('names')
    await expect(store.read('a\nb.md')).rejects.toThrow(/not a plan file name/)
    await expect(store.read('evil\u{202E}dm.exe.md')).rejects.toThrow(/not a plan file name/)
  })

  it('never replaces a file: a taken name gets the next numeric suffix', async () => {
    const { root, store } = await workspace('taken')
    await mkdir(plansFolder(root), { recursive: true })
    const first = path.join(plansFolder(root), '2026-09-27-x.md')
    await writeFile(first, 'the user’s own plan')
    const second = await store.save({ title: 'x', savedAt: NOON, text: 'new' })
    const third = await store.save({ title: 'x', savedAt: NOON, text: 'newer' })
    expect([second.fileName, third.fileName]).toEqual(['2026-09-27-x-2.md', '2026-09-27-x-3.md'])
    expect(await readFile(first, 'utf8')).toBe('the user’s own plan')
    expect(await readFile(path.join(plansFolder(root), second.fileName), 'utf8')).toBe('new')
  })

  it('refuses a plans folder that leads elsewhere through a junction', async () => {
    const { root, store } = await workspace('linked')
    await mkdir(path.join(root, '.agents'), { recursive: true })
    const link = plansFolder(root)
    await symlink(paths.outside, link, 'junction')
    try {
      await expect(store.save({ title: 'x', savedAt: NOON, text: 'x' })).rejects.toThrow(
        /outside the workspace|through a link/,
      )
      await expect(store.list()).rejects.toThrow(/outside the workspace|through a link/)
      expect(await readdir(paths.outside)).toEqual([])
    } finally {
      await rm(link, { force: true })
    }
  })

  it('refuses a plans folder that leads to another folder of the workspace', async () => {
    const { root, store } = await workspace('linked-inside')
    const elsewhere = path.join(root, 'docs')
    await mkdir(elsewhere, { recursive: true })
    await mkdir(path.join(root, '.agents'), { recursive: true })
    const link = plansFolder(root)
    await symlink(elsewhere, link, 'junction')
    try {
      await expect(store.save({ title: 'x', savedAt: NOON, text: 'x' })).rejects.toThrow(
        /through a link/,
      )
      expect(await readdir(elsewhere)).toEqual([])
    } finally {
      await rm(link, { force: true })
    }
  })

  it('reads a plan back whole and bounded, and says why one cannot be', async () => {
    const { root, store } = await workspace('read')
    const saved = await store.save({
      title: 'Read me',
      savedAt: NOON,
      text: '# Read me\n\n1. One.',
    })
    const plan = await store.read(saved.fileName)
    expect(plan.relativePath).toBe('.agents/plans/2026-09-27-read-me.md')
    expect(plan.document).toEqual({ title: 'Read me', body: '# Read me\n\n1. One.' })
    expect(Buffer.from(plan.bytes).toString('utf8')).toBe('# Read me\n\n1. One.')
    await expect(store.read('2026-09-27-gone.md')).rejects.toThrow(UI_TEXT.planFileMissing)
    await writeFile(path.join(plansFolder(root), 'big.md'), 'x'.repeat(PLAN_FILE_MAX_BYTES + 1))
    const tooLarge = fill(UI_TEXT.planTooLarge, { size: PLAN_FILE_MAX_BYTES / 1024 })
    await expect(store.read('big.md')).rejects.toThrow(tooLarge)
    // A plan it could not read back is not saved either.
    await expect(
      store.save({ title: 'big', savedAt: NOON, text: 'x'.repeat(PLAN_FILE_MAX_BYTES + 1) }),
    ).rejects.toThrow(tooLarge)
    expect(await readdir(plansFolder(root))).not.toContain('2026-09-27-big.md')
    await writeFile(path.join(plansFolder(root), 'fake.md'), Buffer.from(pdfFixture(1)))
    await expect(store.read('fake.md')).rejects.toThrow(UI_TEXT.textFileInvalid)
    await expect(store.read('../escape.md')).rejects.toThrow(/not a plan file name/)
  })

  it('lists and reads nothing when the plan reader cannot load, and says why', async () => {
    const { root } = await workspace('no-reader')
    await mkdir(plansFolder(root), { recursive: true })
    await writeFile(path.join(plansFolder(root), '2026-09-27-a.md'), '# A')
    const store = new PlanStore({
      workspaceRoot: root,
      platform: process.platform,
      io: createPlanIo({ log, now: () => Date.now() }),
      markdown: () => {
        throw new Error(UI_TEXT.planMarkdownUnavailable)
      },
    })
    await expect(store.list()).rejects.toThrow(UI_TEXT.planMarkdownUnavailable)
    await expect(store.read('2026-09-27-a.md')).rejects.toThrow(UI_TEXT.planMarkdownUnavailable)
  })

  it('lists the plans newest first, by heading or name, and knows which it holds', async () => {
    const { root, store } = await workspace('list')
    expect(await store.list()).toEqual([])
    await store.save({ title: 'old', savedAt: new Date(2026, 8, 1, 12), text: '# Old one' })
    await store.save({ title: 'new', savedAt: NOON, text: '## Steps\n1. x' })
    await mkdir(path.join(plansFolder(root), 'folder.md'), { recursive: true })
    await writeFile(path.join(plansFolder(root), 'notes.txt'), 'not a plan')
    expect(await store.list()).toEqual([
      {
        fileName: '2026-09-27-new.md',
        relativePath: '.agents/plans/2026-09-27-new.md',
        title: '2026-09-27-new',
      },
      {
        fileName: '2026-09-01-old.md',
        relativePath: '.agents/plans/2026-09-01-old.md',
        title: 'Old one',
      },
    ])
    expect(await store.has('2026-09-27-new.md')).toBe(true)
    expect(await store.has('folder.md')).toBe(false)
    expect(await store.has('2026-09-27-none.md')).toBe(false)
  })
})

// The complete suffix range is a store contract. Repeating the real
// stage/write/fsync/link/cleanup cycle 100 times exceeds the unchanged
// 5-second test timeout on hosted Windows; the cases above keep the real
// no-clobber publication, confinement and cleanup checks.
describe('PlanStore numeric suffix boundary (M79)', () => {
  const names = Array.from({ length: PLAN_NAME_ATTEMPTS }, (_, index) => {
    const attempt = index + 1
    const suffix = attempt === 1 ? '' : `-${String(attempt)}`
    return `/ws/.agents/plans/2026-09-27-x${suffix}.md`
  })
  const lastName = `/ws/.agents/plans/2026-09-27-x-${String(PLAN_NAME_ATTEMPTS)}.md`
  const content = { title: 'x', savedAt: NOON, text: 'new' }
  const lastSaved = {
    fileName: path.posix.basename(lastName),
    relativePath: lastName.slice('/ws/'.length),
  }

  it('gives up after the last numeric suffix rather than replace a file', async () => {
    const { files, plans } = fakePlanFiles()
    for (const name of names) {
      files.set(name, 'taken')
    }
    const before = new Map(files)
    const attempted = vi.spyOn(files, 'has')
    await expect(plans.save(content)).rejects.toThrow(UI_TEXT.planNamesTaken)
    expect(attempted.mock.calls.map(([name]) => name)).toEqual(names)
    expect(files).toEqual(before)
  })

  it('uses the last numeric suffix when it is the only free name', async () => {
    const { files, plans } = fakePlanFiles()
    const occupied = names.slice(0, -1)
    for (const name of occupied) {
      files.set(name, 'taken')
    }
    const before = new Map(files)
    const attempted = vi.spyOn(files, 'has')
    await expect(plans.save(content)).resolves.toEqual({
      ...lastSaved,
      isNew: true,
    })
    expect(attempted.mock.calls.map(([name]) => name)).toEqual(names)
    expect(files).toEqual(new Map([...before, [lastName, content.text]]))
  })

  it('reuses the same plan saved under the last numeric suffix', async () => {
    const { files, plans } = fakePlanFiles()
    for (const name of names) {
      files.set(name, name === lastName ? content.text : 'taken')
    }
    const before = new Map(files)
    await expect(plans.find(content)).resolves.toEqual(lastSaved)
    const attempted = vi.spyOn(files, 'has')
    await expect(plans.save(content)).resolves.toEqual({
      ...lastSaved,
      isNew: false,
    })
    expect(attempted.mock.calls.map(([name]) => name)).toEqual(names)
    expect(files).toEqual(before)
  })
})
