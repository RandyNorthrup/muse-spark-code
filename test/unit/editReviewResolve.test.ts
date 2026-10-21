// The edit review's resolve (src/host/editor/editReview.ts): a file the
// workspace cannot hand over (a real symlink loop, which the product's own
// canonicalPath refuses) refuses the entry with the panel's fixed words,
// while the log names only the failure's kind — never the filesystem's
// words. The file and editor answers come through the standalone runtime's
// own ToolIo and the product's canonicalPath, never a hand-written stub.
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { EditReview } from '../../src/host/editor/editReview'
import { canonicalPath } from '../../src/host/canonicalPath'
import { headlessToolIo } from './helpers/headlessToolIo'
import { warnLog } from './helpers/memoryLogs'

const quiet = (): void => undefined

it('refuses a file the workspace cannot hand over, with kind words in the log', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'edit-review-'))
  try {
    // Two links pointing at each other: resolving anything below them
    // fails in the operating system, as a swapped link would.
    await symlink(path.join(root, 'loop-b'), path.join(root, 'loop-a'), 'junction')
    await symlink(path.join(root, 'loop-a'), path.join(root, 'loop-b'), 'junction')
    const toolIo = headlessToolIo(root)
    const warned: string[] = []
    const review = new EditReview({
      platform: process.platform,
      workspaceRoot: root,
      readFile: (fsPath) => toolIo.readFile(fsPath),
      realPath: canonicalPath,
      hasUnsavedChanges: (fsPath) => toolIo.hasUnsavedChanges(fsPath),
      withAdmission: (work) => work(quiet),
      io: {
        writeFileIfUnchanged: () => Promise.reject(new Error('unused in describe')),
        trashFileIfUnchanged: () => Promise.reject(new Error('unused in describe')),
        createFileIfAbsent: () => Promise.reject(new Error('unused in describe')),
      },
      openDiff: () => Promise.resolve(),
      log: warnLog(warned),
    })
    const patchJson = JSON.stringify({ files: [{ path: 'loop-a/missing.ts', hunks: [] }] })
    const described = await review.describe(patchJson)
    expect(described).toHaveLength(1)
    expect(described[0]?.path).toBe('loop-a/missing.ts')
    expect(described[0]?.refusal).toContain('missing.ts')
    expect(warned).toHaveLength(1)
    expect(warned[0]).toContain('could not resolve')
    expect(warned[0]).toContain('missing.ts')
    expect(warned[0]).toContain('Error')
    expect(warned[0]).not.toContain('no such file')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
