import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  EditReview,
  originalUriPath,
  stripExtendedLengthPrefix,
} from '../../src/host/editor/editReview'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

const PATCH =
  '{"files":[{"path":"notes.md","hunks":[{"oldStart":1,"oldLines":3,"newStart":1,"newLines":4,"lines":[" # Notes"," ","-first line","+second line","+third line"]}]}]}'
const CREATED =
  '{"files":[{"path":"new.txt","hunks":[{"oldStart":0,"oldLines":0,"newStart":1,"newLines":1,"lines":["+hi"]}]}]}'
const ESCAPING = '{"files":[{"path":"../outside.txt","hunks":[]}]}'

function setup(
  files: Record<string, string>,
  options: {
    platform?: NodeJS.Platform
    /** Given as undefined: no folder is open (D27). */
    workspaceRoot?: string | undefined
    /** Canonical forms by path, as the file system would resolve links. */
    realPaths?: Record<string, string>
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
    readFile: (fsPath) => Promise.resolve(disk.get(fsPath)),
    realPath: (fsPath) => Promise.resolve(options.realPaths?.[fsPath] ?? fsPath),
    writeFile: (fsPath, content) => {
      writes.push([fsPath, content])
      return Promise.resolve()
    },
    deleteFile: (fsPath) => {
      deleted.push(fsPath)
      return Promise.resolve()
    },
    openDiff: vi.fn((beforeUri: string, fsPath: string, title: string) => {
      diffs.push([beforeUri, fsPath, title])
      return Promise.resolve()
    }),
    log,
  })
  return { review, writes, deleted, diffs, log }
}

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
