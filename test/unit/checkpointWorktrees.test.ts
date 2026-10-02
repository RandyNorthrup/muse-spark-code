import { realpath } from 'node:fs'
import { chmod, rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import type { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import * as memoryIo from '../../src/host/backend/memoryIo'
import { processGitRunner } from '../../src/host/git'
import { createWorktreeFeatures } from '../../src/host/worktreeFeatures'
import { UI_TEXT } from '../../src/shared/constants'
import { posixQuoted } from '../../src/core/shellQuote'
import {
  type Harness,
  harness,
  holdRestoreRef,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  runGit,
  write,
} from './helpers/checkpointHarness'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import { confirmModal, inform, pickOne } from './helpers/vscodeViews'

const realGit = processGitRunner()
const nativePath = promisify(realpath.native)

// Real filesystem resolver behind a facade: the test holds one actual read.
vi.mock('../../src/host/backend/memoryIo', async (importOriginal) => ({
  ...(await importOriginal<typeof memoryIo>()),
  systemPath: vi.fn((file: string) => nativePath(file)),
}))

beforeEach(() => {
  vi.mocked(memoryIo.systemPath).mockReset().mockImplementation(nativePath)
  vi.mocked(window.showInputBox).mockReset().mockResolvedValue('checkpoint-topic')
  vi.mocked(pickOne)
    .mockReset()
    .mockImplementation((items) => Promise.resolve(items[0]))
  vi.mocked(inform).mockReset().mockResolvedValue(undefined)
  vi.mocked(confirmModal)
    .mockReset()
    .mockImplementation((_message, _options, action) => Promise.resolve(action))
  vi.mocked(window.showErrorMessage).mockReset()
})

afterEach(removeCheckpointFolders)

async function repository(): Promise<Harness> {
  const h = await harness()
  await write(h.root, 'a.txt', 'owned checkout\n')
  runGit(h.root, ['add', 'a.txt'])
  runGit(h.root, ['commit', '-q', '-m', 'fixture'])
  return h
}

function featuresOver(h: Harness, manager: MuseCodeBackendManager, signal: AbortSignal) {
  const mutation = vi.fn(async (args: readonly string[], cwd: string, timeoutMs?: number) => {
    expect(h.store.isNativeUnsafe).toBe(true)
    return await realGit(args, cwd, timeoutMs)
  })
  const features = createWorktreeFeatures({
    workspaceRoot: h.root,
    runGit: realGit,
    mutationGit: (args, cwd, timeoutMs) =>
      manager.startWorktreeMutation(cwd, (ownedCwd) => mutation(args, ownedCwd, timeoutMs), signal),
    log: h.log,
  })
  return { features, mutation }
}

type Operation = 'add' | 'remove'

function readyOperation(h: Harness, operation: Operation): void {
  if (operation === 'remove') {
    runGit(h.root, ['worktree', 'add', '-b', 'removable', `${h.root}.worktrees/removable`])
  }
}

describe('extension-managed worktree mutation exclusion (M72)', () => {
  it(
    'runs Git in its checked canonical cwd when an alias retargets during the other root read',
    async () => {
      const h = await repository()
      const other = await repository()
      const alias = path.join(path.dirname(h.top), 'cwd-alias')
      await symlink(h.root, alias, 'junction')
      const aliasRead = Promise.withResolvers<undefined>()
      const resumeRoot = Promise.withResolvers<undefined>()
      vi.mocked(memoryIo.systemPath).mockImplementation(async (file) => {
        if (file === h.root) {
          await resumeRoot.promise
        }
        const resolved = await nativePath(file)
        if (file === alias) {
          aliasRead.resolve(undefined)
        }
        return resolved
      })
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
      })
      const starting = manager.startWorktreeMutation(
        alias,
        async (ownedCwd) => {
          await realGit(
            ['worktree', 'add', '-b', 'checked-cwd', `${h.root}.worktrees/checked`, 'HEAD'],
            ownedCwd,
          )
          return await realGit(['rev-parse', '--show-toplevel'], ownedCwd)
        },
        new AbortController().signal,
      )
      try {
        await aliasRead.promise
        await rm(alias)
        await symlink(other.root, alias, 'junction')
      } finally {
        resumeRoot.resolve(undefined)
      }
      const started = await starting
      expect(started.trim().replaceAll('\\', '/')).toBe(h.root.replaceAll('\\', '/'))
      expect(runGit(h.root, ['show-ref', '--verify', 'refs/heads/checked-cwd'])).toContain(
        'refs/heads/checked-cwd',
      )
      expect(() => runGit(other.root, ['show-ref', '--verify', 'refs/heads/checked-cwd'])).toThrow()
      expect(other.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'admits before a real post-checkout hook writes the original workspace and keeps uncertainty',
    async () => {
      const h = await repository()
      const canary = path.join(h.root, 'hook-canary.txt').replaceAll('\\', '/')
      const quoted = posixQuoted(canary)
      const hook = path.join(h.root, '.git', 'hooks', 'post-checkout')
      await write(
        h.root,
        '.git/hooks/post-checkout',
        `#!/bin/sh\nprintf 'hook wrote${String.raw`\n`}' > ${quoted}\n`,
      )
      await chmod(hook, 0o755)
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
      })
      const action = featuresOver(h, manager, new AbortController().signal)
      await action.features.newWorktree()
      expect(window.showErrorMessage).not.toHaveBeenCalled()
      expect(action.mutation).toHaveBeenCalledOnce()
      expect(await read(h.root, 'hook-canary.txt')).toBe('hook wrote\n')
      expect(h.store.isNativeUnsafe).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each<Operation>(['add', 'remove'])(
    'starts no Git %s mutation under a real restore reservation',
    async (operation) => {
      const h = await repository()
      readyOperation(h, operation)
      await holdRestoreRef(h)
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
      })
      const action = featuresOver(h, manager, new AbortController().signal)
      await (operation === 'add' ? action.features.newWorktree() : action.features.removeWorktree())
      expect(action.mutation).not.toHaveBeenCalled()
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(UI_TEXT.restoreTurnElsewhere),
      )
      if (operation === 'remove') {
        expect(await isPresent(`${h.root}.worktrees/removable`, 'a.txt')).toBe(true)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['window closed', 'manager disposed'])(
    'starts no Git after %s during durable admission',
    async (reason) => {
      const h = await repository()
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const lifetime = new AbortController()
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: async () => {
          entered.resolve(undefined)
          await resume.promise
          await h.store.markNativeBackend()
        },
      })
      const action = featuresOver(h, manager, lifetime.signal)
      const starting = action.features.newWorktree()
      try {
        await entered.promise
        if (reason === 'window closed') {
          lifetime.abort()
        } else {
          await manager.dispose()
        }
      } finally {
        resume.resolve(undefined)
      }
      await starting
      expect(action.mutation).not.toHaveBeenCalled()
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(UI_TEXT.questionCancelled),
      )
      expect(await isPresent(`${h.root}.worktrees/checkpoint-topic`, 'a.txt')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses an unrelated Git cwd after admission without exposing its path',
    async () => {
      const h = await repository()
      const other = await repository()
      const manager = fakeMuseCodeManager({
        workspaceRoot: h.root,
        beforeWorkspaceHostStart: () => h.store.markNativeBackend(),
      })
      const start = vi.fn(() => Promise.resolve(''))
      await expect(
        manager.startWorktreeMutation(other.root, start, new AbortController().signal),
      ).rejects.toThrow(UI_TEXT.checkpointFailed)
      expect(start).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
