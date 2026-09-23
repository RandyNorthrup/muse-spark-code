import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceFileLister, parseNulSeparated } from '../../src/host/mention/workspaceFiles'
import { FakeLogOutputChannel } from './helpers/fakes'

function setup(
  options: { respectGitIgnore?: boolean; gitFails?: boolean; isTrusted?: boolean } = {},
) {
  const log = new FakeLogOutputChannel()
  const runGit = vi.fn((_args: readonly string[], _cwd: string) =>
    options.gitFails === true
      ? Promise.reject(new Error('spawn git ENOENT'))
      : Promise.resolve('src/a.ts\0src/b.ts\0'),
  )
  const findFiles = vi.fn(() => Promise.resolve(['src/a.ts', 'src/b.ts', 'node_modules/x.js']))
  const list = createWorkspaceFileLister({
    workspaceRoot: '/ws',
    respectGitIgnore: () => options.respectGitIgnore ?? true,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    runGit,
    findFiles,
    log,
  })
  return { list, runGit, findFiles, log }
}

describe('parseNulSeparated', () => {
  it('splits on NUL and drops the trailing empty entry', () => {
    expect(parseNulSeparated('a\0b c\0')).toEqual(['a', 'b c'])
    expect(parseNulSeparated('')).toEqual([])
  })
})

describe('createWorkspaceFileLister', () => {
  it('uses git ls-files in the workspace root when .gitignore is respected', async () => {
    const { list, runGit, findFiles } = setup()
    await expect(list()).resolves.toEqual(['src/a.ts', 'src/b.ts'])
    expect(runGit).toHaveBeenCalledWith(
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      '/ws',
    )
    expect(findFiles).not.toHaveBeenCalled()
  })

  it('falls back to the file search when git is unavailable, with a warning', async () => {
    const { list, findFiles, log } = setup({ gitFails: true })
    await expect(list()).resolves.toEqual(['src/a.ts', 'src/b.ts', 'node_modules/x.js'])
    expect(findFiles).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('spawn git ENOENT')
  })

  it('skips git entirely when .gitignore is not respected', async () => {
    const { list, runGit, findFiles } = setup({ respectGitIgnore: false })
    await list()
    expect(runGit).not.toHaveBeenCalled()
    expect(findFiles).toHaveBeenCalledOnce()
  })

  it('skips git in Restricted Mode, where the repository config is untrusted (D24)', async () => {
    const { list, runGit, findFiles } = setup({ isTrusted: false })
    await expect(list()).resolves.toEqual(['src/a.ts', 'src/b.ts', 'node_modules/x.js'])
    expect(runGit).not.toHaveBeenCalled()
    expect(findFiles).toHaveBeenCalledOnce()
  })
})
