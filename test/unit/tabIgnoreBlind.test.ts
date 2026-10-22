import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { GitExitError } from '../../src/host/git'
import { TabIgnoreCache, type TabIgnoreDeps } from '../../src/host/tab/tabIgnore'
import { resolveWorkingGit } from './helpers/realGit'
import { usingTempDir } from './helpers/temporaryFolders'

const runExecFile = promisify(execFile)
const resolvedGit: Promise<string> = resolveWorkingGit()

/** Real git: answers and failures come from the git binary itself. */
const realRunGit = async (args: readonly string[], cwd: string): Promise<string> => {
  try {
    const { stdout } = await runExecFile(await resolvedGit, [...args], { cwd })
    return stdout
  } catch (error: unknown) {
    const code = (error as { code?: unknown }).code
    const stderr = String((error as { stderr?: unknown }).stderr ?? error)
    if (typeof code === 'number') throw new GitExitError(code, stderr, args.join(' '))
    throw error
  }
}
const depsFor = (
  root: string,
  runGit: TabIgnoreDeps['runGit'] = realRunGit,
  traces: string[] = [],
): TabIgnoreDeps => ({
  runGit,
  ignoreFileExists: (absolutePath) => existsSync(absolutePath),
  workspaceRoots: () => [root],
  onIgnoreFilesChanged: () => ({ dispose: () => undefined }),
  log: {
    trace: (message) => void traces.push(message),
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  },
})

const realGitRepo = async (root: string) => {
  await runExecFile(await resolvedGit, ['init', '-q'], { cwd: root })
  writeFileSync(path.join(root, '.gitignore'), '*.log\n', 'utf8')
}

describe('TabIgnoreCache with real git', () => {
  it('reads an ignored path from a real git answer', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      await realGitRepo(root)
      const cache = new TabIgnoreCache(depsFor(root))
      try {
        await expect(cache.isIgnored(root, 'debug.log')).resolves.toBe(true)
      } finally {
        cache.dispose()
      }
    })
  })

  it('reads a non-ignored path from a real exit-1 answer', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      await realGitRepo(root)
      writeFileSync(path.join(root, 'notes.txt'), 'kept', 'utf8')
      const cache = new TabIgnoreCache(depsFor(root))
      try {
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
      } finally {
        cache.dispose()
      }
    })
  })

  it('refuses where an ignore file sits when git cannot answer in a non-repo', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      writeFileSync(path.join(root, '.gitignore'), '*.log\n', 'utf8')
      const cache = new TabIgnoreCache(depsFor(root))
      try {
        await expect(cache.isIgnored(root, 'debug.log')).resolves.toBe(true)
      } finally {
        cache.dispose()
      }
    })
  })

  it('reads a path git never saw when no ignore file claims it', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      const cache = new TabIgnoreCache(depsFor(root))
      try {
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
      } finally {
        cache.dispose()
      }
    })
  })

  it('survives a missing git binary by refusing only under ignore files', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      const noGit: TabIgnoreDeps['runGit'] = async () => {
        await runExecFile('muse-no-such-binary', ['check-ignore'], { cwd: root })
        return ''
      }
      const traces: string[] = []
      const cache = new TabIgnoreCache(depsFor(root, noGit, traces))
      try {
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
        expect(traces.some((line) => line.includes('without git'))).toBe(true)
      } finally {
        cache.dispose()
      }
    })
  })
})
