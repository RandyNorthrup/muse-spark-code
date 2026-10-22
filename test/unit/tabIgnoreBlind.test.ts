import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { TabIgnoreCache, type TabIgnoreDeps } from '../../src/host/tab/tabIgnore'
import { realGit, resolveGitBinary } from './helpers/realGit'
import { usingTempDir } from './helpers/temporaryFolders'

const runExecFile = promisify(execFile)
const depsFor = (
  root: string,
  runGit: TabIgnoreDeps['runGit'] = realGit,
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
  await runExecFile(await resolveGitBinary(), ['init', '-q'], { cwd: root })
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

  it('refuses a tracked file Cursor ignores where git allows it', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      await realGitRepo(root)
      writeFileSync(path.join(root, '.cursorignore'), 'secret-notes.txt\n', 'utf8')
      writeFileSync(path.join(root, 'secret-notes.txt'), 'cursor says no', 'utf8')
      await realGit(['add', 'secret-notes.txt'], root)
      const cache = new TabIgnoreCache(depsFor(root))
      try {
        await expect(cache.isIgnored(root, 'secret-notes.txt')).resolves.toBe(true)
      } finally {
        cache.dispose()
      }
    })
  })

  it('asks git again after an ignore file changes', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      await realGitRepo(root)
      let gitCalls = 0
      const counting: TabIgnoreDeps['runGit'] = (args, cwd) => {
        gitCalls += 1
        return realGit(args, cwd)
      }
      let clear: (() => void) | undefined
      const cache = new TabIgnoreCache({
        ...depsFor(root, counting),
        onIgnoreFilesChanged: (notify) => {
          clear = notify
          return { dispose: () => undefined }
        },
      })
      try {
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
        const asked = gitCalls
        expect(asked).toBeGreaterThan(0)
        // The cached verdict answers without git.
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
        expect(gitCalls).toBe(asked)
        // An ignore file changed: the verdict is asked again.
        clear?.()
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(false)
        expect(gitCalls).toBeGreaterThan(asked)
      } finally {
        cache.dispose()
      }
    })
  })

  it('refuses a read the ignore files keep changing under', async () => {
    await usingTempDir('muse-tab-ignore-', async (root) => {
      await realGitRepo(root)
      let clear: (() => void) | undefined
      const churning: TabIgnoreDeps['runGit'] = (args, cwd) => {
        const answer = realGit(args, cwd)
        // An ignore file changes under every answer.
        clear?.()
        return answer
      }
      const cache = new TabIgnoreCache({
        ...depsFor(root, churning),
        onIgnoreFilesChanged: (notify) => {
          clear = notify
          return { dispose: () => undefined }
        },
      })
      try {
        await expect(cache.isIgnored(root, 'notes.txt')).resolves.toBe(true)
      } finally {
        cache.dispose()
      }
    })
  })
})
