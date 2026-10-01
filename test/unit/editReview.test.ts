import path from 'node:path'
import os from 'node:os'
import { readFileSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { executeTool } from '../../src/core/backends/modelapi/tools'
import { memoryToolIo } from './helpers/fakeToolIo'
import { describe, expect, it, vi } from 'vitest'
import {
  EditReview,
  type EditReviewDeps,
  originalUriPath,
  stripExtendedLengthPrefix,
} from '../../src/host/editor/editReview'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { createCheckpointPort, withCheckpointEdit } from '../../src/host/checkpoints/checkpointHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { WorkspaceEdits } from '../../src/core/verify/workspaceEdits'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { removeFolder } from './helpers/temporaryFolders'

const PATCH =
  '{"files":[{"path":"notes.md","hunks":[{"oldStart":1,"oldLines":3,"newStart":1,"newLines":4,"lines":[" # Notes"," ","-first line","+second line","+third line"]}]}]}'
const CREATED =
  '{"files":[{"path":"new.txt","hunks":[{"oldStart":0,"oldLines":0,"newStart":1,"newLines":1,"lines":["+hi"]}]}]}'
const ESCAPING = '{"files":[{"path":"../outside.txt","hunks":[]}]}'

type ReviewWrites = Pick<EditReviewDeps, 'writeFile' | 'deleteFile'>

/** Function signatures belong to this tree's activation adapters, not external input. */
function isReviewWrites(value: unknown): value is ReviewWrites {
  return (
    typeof value === 'object' &&
    value !== null &&
    'writeFile' in value &&
    typeof value.writeFile === 'function' &&
    'deleteFile' in value &&
    typeof value.deleteFile === 'function'
  )
}

/** Execute the actual activation callbacks, over fake VS Code I/O and the real lease. */
function activationReviewWrites(bindings: Readonly<Record<string, unknown>>): ReviewWrites {
  const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
  const review = source.indexOf('const review = lazyReview(')
  const start = source.indexOf('writeFile: async', review)
  const end = source.indexOf('openDiff: async', start)
  if (review === -1 || start < review || end <= start) {
    throw new Error('activation review adapters were not found')
  }
  const value: unknown = runInNewContext(`({${source.slice(start, end)}})`, bindings)
  if (!isReviewWrites(value)) {
    throw new Error('activation review adapters are not callable')
  }
  return value
}

describe('activation review checkpoint admission (RV70 finding 3)', () => {
  it.each([
    { action: 'write', isAlias: false },
    { action: 'delete', isAlias: false },
    { action: 'write', isAlias: true },
    { action: 'delete', isAlias: true },
  ] as const)(
    'refuses a dirty buffer acquired during $action admission, alias=$isAlias',
    async ({ action, isAlias }) => {
      let isDirty = false
      const entered = Promise.withResolvers<undefined>()
      const released = Promise.withResolvers<undefined>()
      const checkpoints = createCheckpointPort({
        isNamespaceKnown: () => true,
        store: undefined,
        isWorkspaceTrusted: () => true,
        isEnabled: () => false,
        hasGit: () => false,
      })
      const marks: boolean[] = []
      vi.spyOn(checkpoints, 'markTurn').mockImplementation(async (_key, isRunning) => {
        marks.push(isRunning)
        if (!isRunning) {
          return
        }

        entered.resolve(undefined)
        await released.promise
      })
      const write = vi.fn(() => Promise.resolve())
      const remove = vi.fn(() => Promise.resolve())
      const complete = vi.fn()
      const check = vi.fn<() => void>()
      const name = isAlias ? 'link.md' : 'notes.md'
      const hasUnsavedChanges = (file: string) => isDirty && file === `/ws/${name}`
      const adapters = activationReviewWrites({
        checkpoints,
        withCheckpointEdit,
        UI_TEXT,
        fill,
        TextEncoder,
        backend: { workspaceActionGuard: () => check },
        nativeStarts: { signal: new AbortController().signal },
        toolIo: { hasUnsavedChanges },
        vscode: {
          Uri: { file: (file: string) => file },
          workspace: { fs: { writeFile: write, delete: remove } },
        },
      })
      const review = new EditReview({
        platform: 'linux',
        workspaceRoot: '/ws',
        readFile: () => Promise.resolve('after\n'),
        realPath: (file) => Promise.resolve(file === `/ws/${name}` ? '/ws/notes.md' : file),
        hasUnsavedChanges,
        ...adapters,
        beginEdit: () => complete,
        openDiff: () => Promise.resolve(),
        log: new FakeLogOutputChannel(),
      })
      const patch = JSON.stringify({
        files: [
          {
            path: name,
            hunks: [
              {
                oldStart: action === 'write' ? 1 : 0,
                oldLines: action === 'write' ? 1 : 0,
                newStart: 1,
                newLines: 1,
                lines: action === 'write' ? ['-before', '+after'] : ['+after'],
              },
            ],
          },
        ],
      })
      const reverting = Promise.allSettled([review.revertHunk('edit', patch, 0, 0)])
      await entered.promise
      isDirty = true
      released.resolve(undefined)
      expect(await reverting).toEqual([
        {
          status: 'rejected',
          reason: expect.objectContaining({
            message: fill(UI_TEXT.editUnsavedChanges, { path: name }),
          }),
        },
      ])
      expect(write).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledWith(false)
      expect(marks).toEqual([true, false])
      expect(check).toHaveBeenCalledTimes(2)
    },
  )
})

function setup(
  files: Record<string, string>,
  options: {
    platform?: NodeJS.Platform
    /** Given as undefined: no folder is open (D27). */
    workspaceRoot?: string | undefined
    /** Canonical forms by path, as the file system would resolve links. */
    realPaths?: Record<string, string>
    hasUnsavedChanges?: (fsPath: string) => boolean
    beforeRead?: (fsPath: string) => Promise<void>
    beforeWrite?: (fsPath: string) => Promise<void>
    beforeDelete?: (fsPath: string) => Promise<void>
    beginEdit?: EditReviewDeps['beginEdit']
  } = {},
) {
  const disk = new Map(Object.entries(files))
  const writes: [string, string][] = []
  const deleted: string[] = []
  const diffs: [string, string, string][] = []
  const log = new FakeLogOutputChannel()
  const review = new EditReview({
    platform: options.platform ?? 'linux',
    workspaceRoot: 'workspaceRoot' in options ? options.workspaceRoot : '/ws',
    readFile: async (fsPath) => {
      await options.beforeRead?.(fsPath)
      return disk.get(fsPath)
    },
    realPath: (fsPath) => Promise.resolve(options.realPaths?.[fsPath] ?? fsPath),
    hasUnsavedChanges: options.hasUnsavedChanges ?? (() => false),
    ...(options.beginEdit !== undefined && { beginEdit: options.beginEdit }),
    writeFile: async (fsPath, content, assertCanWrite) => {
      await options.beforeWrite?.(fsPath)
      assertCanWrite()
      writes.push([fsPath, content])
      disk.set(fsPath, content)
    },
    deleteFile: async (fsPath, assertCanWrite) => {
      await options.beforeDelete?.(fsPath)
      assertCanWrite()
      deleted.push(fsPath)
      disk.delete(fsPath)
    },
    openDiff: vi.fn((beforeUri: string, fsPath: string, title: string) => {
      diffs.push([beforeUri, fsPath, title])
      return Promise.resolve()
    }),
    log,
  })
  return { review, writes, deleted, diffs, log, disk }
}

describe('manual revert verification notices', () => {
  it.each(['file', 'hunk'] as const)(
    'keeps peer checks stale through a held %s revert and releases the notice after writing',
    async (action) => {
      const registry = new WorkspaceEdits()
      const peer = new VerifyLedger()
      registry.add(peer)
      peer.record('passed', peer.snapshot('lint', 'project'))
      expect(peer.hasCurrentRun('lint', 'project')).toBe(true)
      const entered = Promise.withResolvers<undefined>()
      const writing = Promise.withResolvers<undefined>()
      const t = setup(pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n'), {
        beginEdit: (file) => registry.beginEdit(file, [file.relative]),
        beforeWrite: () => {
          entered.resolve(undefined)
          return writing.promise
        },
      })
      const reverting =
        action === 'file' ? t.review.revert('i', PATCH) : t.review.revertHunk('i', PATCH, 0, 0)
      await entered.promise
      expect(peer.hasCurrentRun('lint', 'project')).toBe(false)
      const replacement = new VerifyLedger()
      registry.add(replacement)
      replacement.resetForMessage()
      const pending = replacement.snapshot('lint', 'project')
      replacement.record('passed', pending)
      expect(replacement.hasCurrentRun('lint', 'project')).toBe(false)
      expect(replacement.changesWhatRuns('cat notes.md')).toBe(true)
      writing.resolve(undefined)
      await reverting
      expect(t.writes).toHaveLength(1)
      expect(replacement.hasCurrentRun('lint', 'project')).toBe(false)
      expect(peer.takeRoundEdits()).toEqual([])
      expect(replacement.takeRoundEdits()).toEqual([])
      replacement.resetForMessage()
      expect(replacement.changesWhatRuns('cat notes.md')).toBe(false)
      replacement.record('passed', replacement.snapshot('lint', 'project'))
      expect(replacement.hasCurrentRun('lint', 'project')).toBe(true)
    },
  )

  it.each(['write', 'delete'] as const)(
    'releases the notice after a failed %s while retaining conservative stale checks',
    async (action) => {
      const registry = new WorkspaceEdits()
      const peer = new VerifyLedger()
      registry.add(peer)
      const entered = Promise.withResolvers<undefined>()
      const failing = Promise.withResolvers<undefined>()
      const completion = vi.fn<(wasWritten: boolean) => void>()
      const held = () => {
        entered.resolve(undefined)
        return failing.promise
      }
      const t = setup(
        action === 'write'
          ? pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n')
          : pathMap('new.txt', 'hi\n'),
        {
          beforeWrite: held,
          beforeDelete: held,
          beginEdit: (file) => {
            const release = registry.beginEdit(file, [file.relative])
            return (wasWritten) => {
              completion(wasWritten)
              release()
            }
          },
        },
      )
      const reverting = t.review.revert('i', action === 'write' ? PATCH : CREATED)
      const rejected = expect(reverting).rejects.toThrow('denied')
      await entered.promise
      peer.record('passed', peer.snapshot('lint', 'project'))
      expect(peer.hasCurrentRun('lint', 'project')).toBe(false)
      failing.reject(new Error('denied'))
      await rejected
      expect(completion).toHaveBeenCalledExactlyOnceWith(false)
      expect(peer.hasCurrentRun('lint', 'project')).toBe(false)
      peer.resetForMessage()
      expect(peer.changesWhatRuns('cat notes.md')).toBe(false)
      expect(peer.changesWhatRuns('cat new.txt')).toBe(false)
      expect(t.writes).toEqual([])
      expect(t.deleted).toEqual([])
    },
  )

  it.each([
    { action: 'write', willRetarget: false },
    { action: 'write', willRetarget: true },
    { action: 'delete', willRetarget: false },
    { action: 'delete', willRetarget: true },
  ] as const)(
    'publishes $action to the canonical target after final admission, alias retarget=$willRetarget',
    async ({ action, willRetarget }) => {
      const folder = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), 'm70-alias-')))
      try {
        const a = path.join(folder, 'a')
        const b = path.join(folder, 'b')
        const alias = path.join(folder, 'alias')
        await mkdir(a)
        await mkdir(b)
        const fileName = action === 'write' ? 'notes.md' : 'new.txt'
        const current = action === 'write' ? '# Notes\n\nsecond line\nthird line\n' : 'hi\n'
        await writeFile(path.join(a, fileName), current)
        await writeFile(path.join(b, fileName), current)
        const link = process.platform === 'win32' ? 'junction' : 'dir'
        symlinkSync(a, alias, link)
        const complete = vi.fn<(wasWritten: boolean) => void>()
        const admitted = vi.fn<NonNullable<EditReviewDeps['beginEdit']>>(() => {
          if (willRetarget) {
            unlinkSync(alias)
            symlinkSync(b, alias, link)
          }
          return complete
        })
        const review = new EditReview({
          platform: process.platform,
          workspaceRoot: folder,
          realPath: realpath,
          readFile: (file) => readFile(file, 'utf8'),
          hasUnsavedChanges: () => false,
          beginEdit: admitted,
          writeFile,
          deleteFile: unlink,
          openDiff: vi.fn(),
          log: new FakeLogOutputChannel(),
        })
        await review.revert(
          'i',
          (action === 'write' ? PATCH : CREATED).replace(fileName, () => `alias/${fileName}`),
        )
        expect(admitted).toHaveBeenCalledExactlyOnceWith({
          absolute: path.join(a, fileName),
          relative: `a/${fileName}`,
        })
        expect(complete).toHaveBeenCalledExactlyOnceWith(true)
        if (action === 'delete') {
          await expect(readFile(path.join(a, fileName), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          })
        } else {
          expect(await readFile(path.join(a, fileName), 'utf8')).toBe('# Notes\n\nfirst line\n')
        }
        expect(await readFile(path.join(b, fileName), 'utf8')).toBe(current)
      } finally {
        await removeFolder(folder)
      }
    },
  )
})

const NOTES_PATH = /[/\\]ws[/\\]notes\.md$/

describe('EditReview.openDiff', () => {
  it('stages the pre-edit text under a muse-edit URI and opens the diff against the file', async () => {
    const t = setup({ ...pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n') })
    const notices = await t.review.openDiff('item-1', PATCH)
    expect(notices).toEqual([])
    expect(t.diffs).toHaveLength(1)
    const [beforeUri, fsPath, title] = t.diffs[0]!
    expect(beforeUri).toBe('muse-edit:/item-1/notes.md')
    expect(fsPath).toMatch(NOTES_PATH)
    expect(title).toBe('notes.md (Muse edit)')
    expect(t.review.provide(originalUriPath('item-1', 'notes.md'))).toBe('# Notes\n\nfirst line\n')
    expect(t.review.provide('/other')).toBeUndefined()
  })

  it('reports a changed file, an escaping path and a missing patch instead of guessing', async () => {
    const t = setup({ ...pathMap('notes.md', '# Notes\n\nchanged\n') })
    expect(await t.review.openDiff('i', PATCH)).toEqual([
      { level: 'warning', text: 'notes.md cannot be rebuilt: the file changed since this edit.' },
    ])
    expect(await t.review.openDiff('i', ESCAPING)).toEqual([
      {
        level: 'warning',
        text: '../outside.txt refused: the edited path is outside the workspace.',
      },
    ])
    expect(await t.review.openDiff('i', 'nope')).toEqual([
      { level: 'warning', text: 'This edit left no patch document.' },
    ])
    expect(await t.review.openDiff('i', '{"files":[]}')).toEqual([
      { level: 'warning', text: 'This edit left no patch document.' },
    ])
    expect(t.diffs).toHaveLength(0)
    expect(t.log.warn).toHaveBeenCalledWith(expect.stringContaining('no longer matches'))
  })
})

describe('EditReview.revert', () => {
  it('writes the pre-edit text back and forgets the staged original', async () => {
    const t = setup({ ...pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n') })
    await t.review.openDiff('item-1', PATCH)
    const notices = await t.review.revert('item-1', PATCH)
    expect(notices).toEqual([{ level: 'info', text: 'Reverted notes.md.' }])
    expect(t.writes).toHaveLength(1)
    expect(t.writes[0]?.[0]).toMatch(NOTES_PATH)
    expect(t.writes[0]?.[1]).toBe('# Notes\n\nfirst line\n')
    expect(t.review.provide(originalUriPath('item-1', 'notes.md'))).toBeUndefined()
    expect(t.log.info).toHaveBeenCalledWith('Reverted Muse edit item-1 on notes.md')
  })

  it('moves a file the edit created to the trash', async () => {
    const t = setup({ ...pathMap('new.txt', 'hi\n') })
    expect(await t.review.revert('i', CREATED)).toEqual([
      { level: 'info', text: 'new.txt: Moved to the trash (Muse created it).' },
    ])
    expect(t.deleted).toHaveLength(1)
    expect(t.writes).toHaveLength(0)
  })

  it('refuses when the file changed, and treats a missing file as empty', async () => {
    const t = setup({})
    expect(await t.review.revert('i', PATCH)).toEqual([
      { level: 'warning', text: 'notes.md cannot be rebuilt: the file changed since this edit.' },
    ])
    expect(t.writes).toHaveLength(0)
  })

  it('keeps lines the user added to a created file instead of trashing them (D27)', async () => {
    const t = setup({ ...pathMap('new.txt', 'hi\nmine too\n') })
    expect(await t.review.revert('i', CREATED)).toEqual([
      { level: 'info', text: 'Reverted new.txt.' },
    ])
    expect(t.deleted).toHaveLength(0)
    expect(t.writes[0]?.[1]).toBe('mine too\n')
  })

  it('never trashes a file the patch says existed, even when it ends up empty (D27)', async () => {
    const existed = CREATED.replace('"path":"new.txt",', '"path":"new.txt","created":false,')
    const t = setup({ ...pathMap('new.txt', 'hi\n') })
    await t.review.revert('i', existed)
    expect(t.deleted).toHaveLength(0)
    expect(t.writes[0]?.[1]).toBe('')
  })

  it('writes a UTF-8 BOM back with the reverted text (D27)', async () => {
    const t = setup({ ...pathMap('notes.md', '\u{FEFF}# Notes\n\nsecond line\nthird line\n') })
    await t.review.revert('i', PATCH)
    expect(t.writes[0]?.[1]).toBe('\u{FEFF}# Notes\n\nfirst line\n')
  })

  it('reviews nothing without a folder, instead of resolving against the process (D27)', async () => {
    const t = setup(
      { ...pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n') },
      {
        workspaceRoot: undefined,
      },
    )
    const needsFolder = [{ level: 'warning', text: UI_TEXT.editReviewNeedsFolder }]
    expect(await t.review.revert('i', PATCH)).toEqual(needsFolder)
    expect(await t.review.openDiff('i', PATCH)).toEqual(needsFolder)
    expect(t.writes).toHaveLength(0)
    expect(t.diffs).toHaveLength(0)
  })
})

describe('EditReview on Windows paths', () => {
  // The CLI's patch document names files with the extended-length prefix
  // (live 2026-09-22: `\\?\C:\muse-live-ws\notes.md`); the workspace root
  // comes from VS Code without it.
  const WIN_PATCH = PATCH.replace('"path":"notes.md"', String.raw`"path":"\\\\?\\C:\\ws\\notes.md"`)

  it('strips the extended-length prefix and resolves inside the workspace', async () => {
    const t = setup(
      { [String.raw`C:\ws\notes.md`]: '# Notes\n\nsecond line\nthird line\n' },
      { platform: 'win32', workspaceRoot: String.raw`C:\ws` },
    )
    expect(await t.review.openDiff('i', WIN_PATCH)).toEqual([])
    expect(t.diffs[0]).toEqual([
      'muse-edit:/i/notes.md',
      String.raw`C:\ws\notes.md`,
      'notes.md (Muse edit)',
    ])
    expect(await t.review.revert('i', WIN_PATCH)).toEqual([
      { level: 'info', text: 'Reverted notes.md.' },
    ])
    expect(t.writes[0]).toEqual([String.raw`C:\ws\notes.md`, '# Notes\n\nfirst line\n'])
  })

  it('refuses a path that leaves the workspace through a junction (D24)', async () => {
    const t = setup(
      { [String.raw`C:\ws\linked\notes.md`]: '# Notes\n\nsecond line\nthird line\n' },
      {
        platform: 'win32',
        workspaceRoot: String.raw`C:\ws`,
        realPaths: { [String.raw`C:\ws\linked\notes.md`]: String.raw`D:\elsewhere\notes.md` },
      },
    )
    const linked = PATCH.replace('"path":"notes.md"', '"path":"linked/notes.md"')
    expect(await t.review.revert('i', linked)).toEqual([
      {
        level: 'warning',
        text: 'linked/notes.md refused: the edited path is outside the workspace.',
      },
    ])
    expect(t.writes).toHaveLength(0)
  })

  it('still refuses a file outside the workspace, prefix or not', async () => {
    const t = setup({}, { platform: 'win32', workspaceRoot: String.raw`C:\ws` })
    const outside = PATCH.replace(
      '"path":"notes.md"',
      String.raw`"path":"\\\\?\\C:\\other\\notes.md"`,
    )
    expect(await t.review.openDiff('i', outside)).toEqual([
      {
        level: 'warning',
        text: String.raw`\\?\C:\other\notes.md refused: the edited path is outside the workspace.`,
      },
    ])
  })

  it('maps UNC extended-length paths back to their share form', () => {
    expect(stripExtendedLengthPrefix(String.raw`\\?\UNC\server\share\a.txt`)).toBe(
      String.raw`\\server\share\a.txt`,
    )
    expect(stripExtendedLengthPrefix(String.raw`\\?\C:\a.txt`)).toBe(String.raw`C:\a.txt`)
    expect(stripExtendedLengthPrefix('/home/x/a.txt')).toBe('/home/x/a.txt')
  })
})

/** The file under the POSIX fake workspace root, as the module resolves it. */
function pathMap(relative: string, content: string): Record<string, string> {
  return { [path.posix.resolve('/ws', relative)]: content }
}

// M70: the review pane's files and its per-hunk Revert, over hunks the Model
// API's own edit tool made, so they are the ones a real edit leaves.
describe('EditReview for the review pane (M70)', () => {
  const ORIGINAL = `${Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`).join('\n')}\n`
  const EDITS = [
    { find: 'line 2\n', replace: 'line two\n' },
    { find: 'line 25\n', replace: 'line twenty-five\n' },
  ]

  /** Two edits the edit tool made, one hunk each, joined as Muse Code stores a two-hunk patch. */
  async function twoHunkEdit() {
    const io = memoryToolIo({ 'notes.md': ORIGINAL }, '/ws')
    const context = {
      workspaceRoot: '/ws',
      platform: 'linux' as const,
      io,
      seen: new Map<string, string>(),
    }
    await executeTool('read_file', '{"path":"notes.md"}', context)
    const hunks: unknown[] = []
    for (const edit of EDITS) {
      const outcome = await executeTool(
        'edit_file',
        JSON.stringify({ path: 'notes.md', ...edit }),
        context,
      )
      const document = JSON.parse(outcome.patch?.document ?? '{}') as {
        files: { hunks: unknown[] }[]
      }
      hunks.push(...(document.files[0]?.hunks ?? []))
    }
    expect(hunks).toHaveLength(2)
    return {
      patch: JSON.stringify({ files: [{ path: 'notes.md', hunks }] }),
      edited: io.files.get('/ws/notes.md') ?? '',
    }
  }

  it('lists each file by its workspace path, and one outside the workspace with the reason', async () => {
    const t = setup({})
    expect(await t.review.describe(PATCH)).toMatchObject([
      { fileIndex: 0, path: 'notes.md', refusal: undefined },
    ])
    expect(await t.review.describe(ESCAPING)).toMatchObject([
      {
        fileIndex: 0,
        path: '../outside.txt',
        refusal: '../outside.txt refused: the edited path is outside the workspace.',
      },
    ])
    expect(await setup({}, { workspaceRoot: undefined }).review.describe(PATCH)).toMatchObject([
      { refusal: UI_TEXT.editReviewNeedsFolder },
    ])
    await expect(t.review.describe('nope')).rejects.toThrow(UI_TEXT.editNoPatch)
  })

  it('reverts one hunk and leaves the other; both reverted, the file is as it was', async () => {
    const { patch, edited } = await twoHunkEdit()
    const t = setup({ ...pathMap('notes.md', edited) })
    const first = await t.review.revertHunk('ed1', patch, 0, 1)
    expect(first.isReverted).toBe(true)
    expect(first.notices).toEqual([{ level: 'info', text: 'Reverted notes.md.' }])
    const afterFirst = t.writes.at(-1)?.[1] ?? ''
    expect(afterFirst).toContain('line two\n')
    expect(afterFirst).toContain('line 25\n')
    const second = setup({ ...pathMap('notes.md', afterFirst) })
    const secondRevert = await second.review.revertHunk('ed1', patch, 0, 0)
    expect(secondRevert.isReverted).toBe(true)
    expect(second.writes.at(-1)?.[1]).toBe(ORIGINAL)
  })

  it('serializes overlapping hunk reverts against the actual bytes written by the previous hunk', async () => {
    const { patch, edited } = await twoHunkEdit()
    const writing = Promise.withResolvers<undefined>()
    const t = setup(pathMap('notes.md', edited), { beforeWrite: () => writing.promise })
    const first = t.review.revertHunk('ed1', patch, 0, 0)
    const second = t.review.revertHunk('ed1', patch, 0, 1)
    await Promise.resolve()
    writing.resolve(undefined)
    const reverted = await Promise.all([first, second])
    expect(reverted.every((result) => result.isReverted)).toBe(true)
    expect(t.writes).toHaveLength(2)
    expect(t.disk.get('/ws/notes.md')).toBe(ORIGINAL)
  })

  it('frees the file lane after a failed write and checks the next revert against current content', async () => {
    const { patch, edited } = await twoHunkEdit()
    const beforeWrite = vi.fn<(fsPath: string) => Promise<void>>()
    beforeWrite.mockRejectedValueOnce(new Error('write refused')).mockResolvedValue(undefined)
    const t = setup(pathMap('notes.md', edited), { beforeWrite })
    const results = await Promise.allSettled([
      t.review.revertHunk('ed1', patch, 0, 0),
      t.review.revertHunk('ed1', patch, 0, 1),
    ])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: new Error('write refused') })
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { isReverted: true } })
    expect(t.disk.get('/ws/notes.md')).toContain('line two\n')
    expect(t.disk.get('/ws/notes.md')).toContain('line 25\n')
    t.disk.set('/ws/notes.md', ORIGINAL)
    const stale = await t.review.revertHunk('ed1', patch, 0, 0)
    expect(stale.isReverted).toBe(false)
    expect(t.writes).toHaveLength(1)
  })

  it('refuses ordinary and hunk reverts under dirty buffers, including canonical aliases and created files', async () => {
    const dirtyPaths = new Set(['/ws/notes.md', '/ws/new.txt'])
    const t = setup(
      {
        ...pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n'),
        '/ws/link.md': '# Notes\n\nsecond line\nthird line\n',
        '/ws/new.txt': 'hi\n',
      },
      {
        hasUnsavedChanges: (file) => dirtyPaths.has(file),
        realPaths: { '/ws/link.md': '/ws/notes.md' },
      },
    )
    const aliasPatch = PATCH.replace('notes.md', 'link.md')
    expect(await t.review.revert('ed1', PATCH)).toEqual([
      {
        level: 'warning',
        text: 'notes.md cannot be reverted: save or discard the unsaved editor changes, then try again.',
      },
    ])
    const aliased = await t.review.revertHunk('ed1', aliasPatch, 0, 0)
    const created = await t.review.revertHunk('created', CREATED, 0, 0)
    expect(aliased.isReverted).toBe(false)
    expect(created.isReverted).toBe(false)
    expect(t.writes).toEqual([])
    expect(t.deleted).toEqual([])
  })

  it('rechecks dirty buffers and confinement after the saved text is read', async () => {
    for (const isHunk of [false, true]) {
      let isDirty = false
      const t = setup(pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n'), {
        hasUnsavedChanges: () => isDirty,
        beforeRead: () => {
          isDirty = true
          return Promise.resolve()
        },
      })
      if (isHunk) {
        const reverted = await t.review.revertHunk('ed1', PATCH, 0, 0)
        expect(reverted.isReverted).toBe(false)
      } else {
        expect(await t.review.revert('ed1', PATCH)).toHaveLength(1)
      }
      expect(t.writes).toEqual([])
      expect(t.deleted).toEqual([])
    }
    const realPaths: Record<string, string> = {}
    const swapped = setup(pathMap('notes.md', '# Notes\n\nsecond line\nthird line\n'), {
      realPaths,
      beforeRead: () => {
        realPaths['/ws/notes.md'] = '/outside/notes.md'
        return Promise.resolve()
      },
    })
    const redirected = await swapped.review.revertHunk('ed1', PATCH, 0, 0)
    expect(redirected.isReverted).toBe(false)
    expect(swapped.writes).toEqual([])
  })

  it('refuses a hunk the file no longer carries, an unknown hunk, and removes a created file only when nothing of it is left', async () => {
    const { patch } = await twoHunkEdit()
    const t = setup({ ...pathMap('notes.md', ORIGINAL) })
    const refused = await t.review.revertHunk('ed1', patch, 0, 0)
    expect(refused.isReverted).toBe(false)
    expect(refused.notices[0]?.text).toBe(
      'notes.md cannot be rebuilt: the file changed since this edit.',
    )
    const unknownHunk = await t.review.revertHunk('ed1', patch, 0, 9)
    expect(unknownHunk.notices).toEqual([{ level: 'warning', text: UI_TEXT.editNoPatch }])
    expect(t.writes).toEqual([])
    const created = setup({ ...pathMap('new.txt', 'hi\n') })
    const createdRevert = await created.review.revertHunk('c', CREATED, 0, 0)
    expect(createdRevert.isReverted).toBe(true)
    expect(created.deleted).toHaveLength(1)
    // A file the edit created, in two hunks: one hunk out leaves the other's line.
    const twoHunks = JSON.stringify({
      files: [
        {
          path: 'made.txt',
          created: true,
          hunks: [
            { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+a'] },
            { oldStart: 0, oldLines: 0, newStart: 2, newLines: 1, lines: ['+b'] },
          ],
        },
      ],
    })
    const made = setup({ ...pathMap('made.txt', 'a\nb\n') })
    const madeRevert = await made.review.revertHunk('m', twoHunks, 0, 1)
    expect(madeRevert.isReverted).toBe(true)
    expect(made.deleted).toEqual([])
    expect(made.writes.at(-1)?.[1]).toBe('a\n')
  })
})
