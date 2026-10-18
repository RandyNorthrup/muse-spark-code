// The mention file lister (src/host/mention/workspaceFiles.ts): when git
// cannot list the files, the search's own list stands in and the log names
// only the failure's kind — the mention index never pretends .gitignore
// was applied. A stop during either list still stops the whole list.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { createWorkspaceFileLister } from '../../src/host/mention/workspaceFiles'

const quiet = (): void => undefined

const quietLogger = (warned: string[]): Logger => ({
  trace: quiet,
  info: quiet,
  warn: (message) => void warned.push(message),
  error: quiet,
})

function gitRefusal(): Error {
  try {
    readFileSync(path.join(tmpdir(), `no-git-list-${String(process.pid)}`), 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error) return error
  }
  throw new Error('the refusal did not refuse')
}

it('falls back to the search list with kind words when git cannot list', async () => {
  const warned: string[] = []
  const list = createWorkspaceFileLister({
    workspaceRoot: tmpdir(),
    respectGitIgnore: () => true,
    isWorkspaceTrusted: () => true,
    runGit: () => Promise.reject(gitRefusal()),
    findFiles: () => Promise.resolve(['fallback.ts']),
    log: quietLogger(warned),
  })
  await expect(list()).resolves.toEqual(['fallback.ts'])
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('.gitignore is not applied to mentions')
  expect(warned[0]).toContain('Error')
  expect(warned[0]).not.toContain('no such file')
})

it('a stop during either list still stops the whole list', async () => {
  const list = createWorkspaceFileLister({
    workspaceRoot: tmpdir(),
    respectGitIgnore: () => true,
    isWorkspaceTrusted: () => true,
    runGit: () => Promise.resolve('a.ts\0'),
    findFiles: () => Promise.resolve(['fallback.ts']),
    log: quietLogger([]),
  })
  const controller = new AbortController()
  controller.abort()
  await expect(list(controller.signal)).rejects.toThrow()
})
