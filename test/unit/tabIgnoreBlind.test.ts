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
})
