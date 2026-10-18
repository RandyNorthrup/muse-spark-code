// The edit review's resolve (src/host/editor/editReview.ts): a file the
// workspace cannot hand over (a real missing file) refuses the entry with
// the panel's fixed words, while the log names only the failure's kind —
// never the filesystem's words.
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { EditReview } from '../../src/host/editor/editReview'

const quiet = (): void => undefined

function memoryLog(warned: string[]): Logger {
  return { trace: quiet, info: quiet, warn: (message) => void warned.push(message), error: quiet }
}

it('refuses a file the workspace cannot hand over, with kind words in the log', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'edit-review-'))
  const warned: string[] = []
  const review = new EditReview({
    platform: 'linux',
    workspaceRoot: root,
    readFile: () => Promise.resolve(undefined),
    realPath: (fsPath) => realpath(fsPath),
    hasUnsavedChanges: () => false,
    withAdmission: (work) => work(quiet),
    io: {
      writeFileIfUnchanged: () => Promise.reject(new Error('unused in describe')),
      trashFileIfUnchanged: () => Promise.reject(new Error('unused in describe')),
      createFileIfAbsent: () => Promise.reject(new Error('unused in describe')),
    },
    openDiff: () => Promise.resolve(),
    log: memoryLog(warned),
  })
  const patchJson = JSON.stringify({ files: [{ path: 'missing.ts', hunks: [] }] })
  const described = await review.describe(patchJson)
  expect(described).toHaveLength(1)
  expect(described[0]?.path).toBe('missing.ts')
  expect(described[0]?.refusal).toContain('missing.ts')
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('could not resolve missing.ts')
  expect(warned[0]).toContain('Error')
  expect(warned[0]).not.toContain('no such file')
})
