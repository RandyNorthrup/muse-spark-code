// Edit review and `/review` in the runtime panel (M104 lane B): int's own
// review bundle from the shared production build, over a real git repository
// and a real connection to the editor. The editor shows the diff, a Revert
// publishes only while the file is what it read and no editor holds unsaved
// text there, and a file a Revert removes is kept in the data folder's trash.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { processGitRunner } from '../../src/host/git'
import { createRuntimeReview } from '../../src/runtime/features/review'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { fixtureGitEnvironment } from './helpers/fixtureGit'
import { connectedWire } from './helpers/panelWire'
import { fileRoots } from './helpers/tempDirs'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const roots = fileRoots()
// The suite's own folders, made once in beforeAll: the repository, and the runtime's data folder.
const folders = { folder: '', workspace: '', dataFolder: '' }

beforeAll(async () => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  folders.folder = await realpath(await roots.fresh('muse-review-'))
  folders.workspace = path.join(folders.folder, 'workspace')
  folders.dataFolder = path.join(folders.folder, 'data')
  await mkdir(folders.workspace, { recursive: true })
  await mkdir(folders.dataFolder, { recursive: true })
})

function git(...args: string[]): void {
  execFileSync('git', args, {
    cwd: folders.workspace,
    env: fixtureGitEnvironment({ ...process.env, GIT_CEILING_DIRECTORIES: folders.folder }),
    stdio: 'pipe',
  })
}

/** The patch document an edit tool leaves behind: `old` became `new` in one file. */
function patchOf(file: string, isCreated = false): string {
  return JSON.stringify({
    files: [
      {
        path: file,
        ...(isCreated && { created: true }),
        hunks: [
          {
            oldStart: 1,
            oldLines: isCreated ? 0 : 1,
            newStart: 1,
            newLines: 1,
            lines: isCreated ? ['+new'] : ['-old', '+new'],
          },
        ],
      },
    ],
  })
}

async function reviewing(documents: { uri: string; dirty: boolean }[] = []) {
  const { connection, editor } = await connectedWire(['lifecycle', 'ui', 'diff'])
  const diffs: { left: string; right: string; title: string }[] = []
  editor.serve('diff/open', (params) => {
    diffs.push(params as (typeof diffs)[number])
    return null
  })
  const ending = new AbortController()
  const review = createRuntimeReview({
    host: connection,
    distDir: path.join(ROOT, 'dist'),
    workspaceRoot: folders.workspace,
    dataFolder: folders.dataFolder,
    platform: process.platform,
    runGit: processGitRunner(),
    documents: () => documents,
    isTrusted: () => true,
    signal: ending.signal,
    log: stderrLogger(() => undefined, 'warn'),
  })
  return { review, diffs, editor, ending }
}

describe('edit review in the runtime panel', () => {
  it('shows the editor the file before the edit, beside the file as it is', async () => {
    await writeFile(path.join(folders.workspace, 'shown.txt'), 'new\n')
    const { review, diffs } = await reviewing()
    await review.editReview.openDiff('item-1', patchOf('shown.txt'))
    expect(diffs).toHaveLength(1)
    const [diff] = diffs
    expect(diff?.right).toBe(pathToFileURL(path.join(folders.workspace, 'shown.txt')).href)
    // The original side is a file of the data folder holding the text before the edit.
    const original = new URL(diff?.left ?? '')
    expect(await readFile(original, 'utf8')).toBe('old\n')
    expect(original.pathname).toContain(path.basename(folders.dataFolder))
    await review.dispose()
    await expect(readFile(original, 'utf8')).rejects.toThrow()
  })

  it('puts the file back only while it is what the Revert read, and never over unsaved text', async () => {
    const file = path.join(folders.workspace, 'reverted.txt')
    await writeFile(file, 'new\n')
    const dirty = [{ uri: pathToFileURL(file).href, dirty: true }]
    const unsaved = await reviewing(dirty)
    // An editor holding unsaved text there refuses the Revert and the file stays.
    const refused = await unsaved.review.editReview.revert('item-2', patchOf('reverted.txt'))
    expect(refused.map((notice) => notice.level)).not.toEqual([])
    expect(await readFile(file, 'utf8')).toBe('new\n')
    const saved = await reviewing()
    await saved.review.editReview.revert('item-2', patchOf('reverted.txt'))
    expect(await readFile(file, 'utf8')).toBe('old\n')
    // The edit's own change is no longer there: a second Revert finds the file changed and says so.
    const again = await saved.review.editReview.revert('item-2', patchOf('reverted.txt'))
    expect(again.length).toBeGreaterThan(0)
    expect(await readFile(file, 'utf8')).toBe('old\n')
  })

  it('keeps a file a Revert removes in the data folder’s trash', async () => {
    const file = path.join(folders.workspace, 'created.txt')
    await writeFile(file, 'new\n')
    const { review } = await reviewing()
    await review.editReview.revert('item-3', patchOf('created.txt', true))
    await expect(readFile(file, 'utf8')).rejects.toThrow()
    const trashed = await readdir(path.join(folders.dataFolder, 'trash'), { recursive: true })
    expect(trashed.some((entry) => entry.endsWith('created.txt'))).toBe(true)
  })
})

describe('/review in the runtime panel', () => {
  it('reads the material from git and lets the person pick through the editor', async () => {
    git('init', '-q')
    git('config', 'user.email', 'suite@example.invalid')
    git('config', 'user.name', 'suite')
    git('config', 'commit.gpgsign', 'false')
    await writeFile(path.join(folders.workspace, 'tracked.txt'), 'one\n')
    git('add', 'tracked.txt')
    git('commit', '-q', '-m', 'first')
    await writeFile(path.join(folders.workspace, 'tracked.txt'), 'two\n')
    const { review } = await reviewing()
    const collected = await review.review.collect(
      { scope: 'uncommitted', focus: 'general' },
      () => true,
    )
    expect(collected.kind).toBe('material')
    expect(JSON.stringify(collected)).toContain('tracked.txt')
  })

  it('asks the editor which commit when the request names none', async () => {
    await writeFile(path.join(folders.workspace, 'tracked.txt'), 'three\n')
    git('commit', '-q', '-a', '-m', 'second')
    const { review, editor } = await reviewing()
    const asked: { title: string; items: { id: string; title: string }[] }[] = []
    editor.serve('ui/pick', (params) => {
      const question = params as (typeof asked)[number]
      asked.push(question)
      // The newest commit is the first row.
      return [question.items[0]?.id]
    })
    const collected = await review.review.collect({ scope: 'commit', focus: 'general' }, () => true)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.items.map((item) => item.title)).toHaveLength(2)
    expect(collected.kind).toBe('material')
    expect(JSON.stringify(collected)).toContain('three')
  })

  it('answers nothing once the conversation is let go', async () => {
    const { review, ending } = await reviewing()
    ending.abort()
    expect(
      await review.review.collect({ scope: 'uncommitted', focus: 'general' }, () => true),
    ).toEqual(expect.objectContaining({ kind: expect.stringMatching(/cancelled|refused/) }))
  })
})
