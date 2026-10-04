// Real Git, real uncommitted files, no model calls. Disposable repositories
// live under the OS temp directory, never under the checkout's gate inputs.

import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import {
  BestOfNRunner,
  type BestOfNAttemptStart,
  type BestOfNStart,
  type BestOfNRunnerDeps,
} from '../../src/core/bestOfN/bestOfNRunner'
import { processGitRunner } from '../../src/host/git'
import { posixQuoted } from '../../src/core/shellQuote'
import { confineWorkspacePath } from '../../src/core/workspacePath'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'

const roots: string[] = []
// Real Git and a hook process per command take seconds, not milliseconds, on a busy Windows host.
const REAL_GIT_WAIT_MS = 30_000
const REAL_GIT_TEST_MS = 120_000
// Fixture programs/configuration are owned here, never inherited from a developer's global filters.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}
const git = processGitRunner({ env: gitEnv })
const automaticGit = processGitRunner({ isAutomatic: true, env: gitEnv })
const START: BestOfNStart = {
  prompt: 'edit files',
  attempts: 2,
  requestCeilingPerAttempt: 5,
  modelId: 'muse-spark-1.3',
  approvalMode: 'onRequest',
  isCurrent: () => true,
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    // A git or hook process can still hold the folder for a moment on Windows.
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

async function repository(): Promise<string> {
  const requested = await mkdtemp(path.join(tmpdir(), 'muse-best-of-n-'))
  const temp = realpathSync.native(requested)
  roots.push(temp)
  const root = path.join(temp, 'app')
  await mkdir(root)
  await git(['init'], root)
  await git(['config', 'user.name', 'Offline test'], root)
  await git(['config', 'user.email', 'offline@example.invalid'], root)
  await writeFile(path.join(root, 'tracked.txt'), 'before\n')
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n')
  await git(['add', '--all'], root)
  await git(['commit', '-m', 'fixture'], root)
  return root
}

async function started(
  root: string,
  given: Partial<BestOfNRunnerDeps> = {},
): Promise<{
  runner: BestOfNRunner
  attempts: BestOfNAttemptStart[]
  updates: BestOfNRun[]
}> {
  const attempts: BestOfNAttemptStart[] = []
  const updates: BestOfNRun[] = []
  const runner = new BestOfNRunner({
    coordinator: new BestOfNCoordinator(),
    newRunId: () => 'bon-real-1',
    isTrusted: () => true,
    backendKind: () => 'modelApi',
    isBestOfNOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => undefined,
    getAccountId: () => Promise.resolve('offline-account'),
    hasDirtyEditors: () => false,
    validatePaths: () => Promise.resolve(undefined),
    validateWorktree: () => Promise.resolve(undefined),
    realPath: realpath,
    repositoryRoot: () => root,
    platform: process.platform,
    runGit: (args, cwd, input, beforeRun) => automaticGit(args, cwd, undefined, input, beforeRun),
    startAttempt: (attempt) => {
      attempts.push(attempt)
      attempt.admitRequest('offline-account')
      attempt.admitRequest.onRequestStarted?.()
      return Promise.resolve({
        sessionId: attempt.attemptId,
        cancel: () => Promise.resolve(undefined),
        dispose: () => undefined,
      })
    },
    onUpdate: (run) => {
      updates.push(run)
    },
    log: new FakeLogOutputChannel(),
    ...given,
  })
  await runner.start(START)
  return { runner, attempts, updates }
}

async function complete(
  attempts: readonly BestOfNAttemptStart[],
  updates: readonly BestOfNRun[],
): Promise<void> {
  for (const attempt of attempts) {
    attempt.onEvent({
      type: 'completed',
      terminal: 'completed',
      requestsMade: 1,
      ceilingReached: false,
      approvalsDenied: 0,
    })
  }
  await vi.waitFor(
    () => {
      expect(updates.at(-1)?.status).not.toBe('running')
    },
    { timeout: REAL_GIT_WAIT_MS },
  )
}

describe('immutable best-of-N snapshots on real Git', { timeout: REAL_GIT_TEST_MS }, () => {
  it('keeps the captured parent index when its .git pointer is retargeted to a same-HEAD repository', async () => {
    const root = await repository()
    const awaitedMember1 = await git(['rev-parse', 'HEAD'], root)
    const base = awaitedMember1.trim()
    const awaitedMember2 = await git(['rev-parse', '--absolute-git-dir'], root)
    const gitDir = await realpath(awaitedMember2.trim())
    const replacement = path.join(roots.at(-1) ?? '', 'replacement')
    await git(['clone', '--no-hardlinks', root, replacement], root)
    const replacementGit = await realpath(path.join(replacement, '.git'))
    const replacementIndex = await readFile(path.join(replacementGit, 'index'))
    const pinned = path.join(roots.at(-1) ?? '', 'linked-parent-pointer')
    // Replace only the pointer, retaining the owned per-worktree Git directory.
    const linkedParent = path.join(roots.at(-1) ?? '', 'linked-parent')
    await automaticGit(['worktree', 'add', '-b', 'linked-parent-fixture', linkedParent, base], root)
    const linked = await started(linkedParent, { newRunId: () => 'bon-linked-1' })
    const selected = linked.attempts[0]
    if (selected === undefined) throw new Error('Expected linked owned attempt')
    await writeFile(path.join(selected.worktreePath, 'tracked.txt'), 'linked chosen bytes\n')
    await complete(linked.attempts, linked.updates)
    const awaitedMember3 = await git(['rev-parse', '--absolute-git-dir'], linkedParent)
    const linkedGitDir = await realpath(awaitedMember3.trim())
    const rootIndex = await readFile(path.join(gitDir, 'index'))
    await rename(path.join(linkedParent, '.git'), pinned)
    await writeFile(
      path.join(linkedParent, '.git'),
      `gitdir: ${replacementGit.replaceAll('\\', '/')}\n`,
    )
    try {
      const taken = await linked.runner.take(selected.attemptId)
      expect(taken.takenBranch).toBe(selected.branch)
      expect(await readFile(path.join(linkedParent, 'tracked.txt'), 'utf8')).toBe(
        'linked chosen bytes\n',
      )
      const ownedIndexText = await git(
        [`--git-dir=${linkedGitDir}`, `--work-tree=${linkedParent}`, 'show', ':tracked.txt'],
        linkedParent,
      )
      expect(ownedIndexText).toBe('linked chosen bytes\n')
      expect(await readFile(path.join(replacementGit, 'index'))).toEqual(replacementIndex)
      expect(await readFile(path.join(gitDir, 'index'))).toEqual(rootIndex)
      expect(await readFile(path.join(replacement, 'tracked.txt'), 'utf8')).toBe('before\n')
      const awaitedMember4 = await git(
        [`--git-dir=${linkedGitDir}`, 'rev-parse', 'HEAD'],
        linkedParent,
      )
      expect(awaitedMember4.trim()).toBe(base)
    } finally {
      await rm(path.join(linkedParent, '.git'))
      await rename(pinned, path.join(linkedParent, '.git'))
      linked.runner.dispose()
    }
  })

  it('rechecks a real directory alias after held final preparation before applying or staging', async () => {
    const root = await repository()
    const nested = path.join(root, 'nested')
    await mkdir(nested)
    await writeFile(path.join(nested, 'tracked.txt'), 'nested before\n')
    await git(['add', '--all'], root)
    await git(['commit', '-m', 'nested fixture'], root)
    const held = Promise.withResolvers<undefined>()
    const preparing = Promise.withResolvers<undefined>()
    const t = await started(root, {
      validateWorktree: async (workspace) => {
        const awaitedMember5 = await realpath(workspace)
        if (awaitedMember5.toLowerCase() !== workspace.toLowerCase())
          throw new Error('Alias changed')
      },
      validatePaths: async (workspace, files) => {
        for (const file of files) {
          const checked = await confineWorkspacePath(workspace, file, process.platform, {
            realPath: realpath,
          })
          if (!checked.ok || checked.relative !== checked.canonical)
            throw new Error('Alias changed')
        }
      },
      runGit: (args, cwd, input, beforeRun) =>
        automaticGit(
          args,
          cwd,
          undefined,
          input,
          args.includes('apply')
            ? Object.assign(
                () => {
                  beforeRun?.()
                },
                {
                  prepare: async () => {
                    preparing.resolve(undefined)
                    await held.promise
                    await beforeRun?.prepare?.()
                  },
                },
              )
            : beforeRun,
        ),
    })
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a worktree')
    await writeFile(
      path.join(winner.worktreePath, 'nested', 'tracked.txt'),
      'chosen nested bytes\n',
    )
    await complete(t.attempts, t.updates)
    const outside = path.join(roots.at(-1) ?? '', 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'tracked.txt'), 'nested before\n')
    const taking = t.runner.take(winner.attemptId)
    try {
      await preparing.promise
      await rename(nested, `${nested}-saved`)
      await symlink(outside, nested, 'junction')
      held.resolve(undefined)
      await expect(taking).rejects.toMatchObject({ refusal: 'worktreeFailed' })
      expect(await readFile(path.join(outside, 'tracked.txt'), 'utf8')).toBe('nested before\n')
      expect(await readFile(path.join(root, 'nested-saved', 'tracked.txt'), 'utf8')).toBe(
        'nested before\n',
      )
      expect(await git(['diff', '--cached', '--name-only'], root)).toBe('')
    } finally {
      held.resolve(undefined)
      try {
        await taking
      } catch {
        /* The specific refusal above is already asserted; settle owned cleanup. */
      }
      t.runner.dispose()
    }
  })

  it('does not stage real uncommitted edits after cancellation during a held validator', async () => {
    const root = await repository()
    const held = Promise.withResolvers<undefined>()
    const validating = Promise.withResolvers<undefined>()
    let isCapture = false
    const log = new FakeLogOutputChannel()
    const t = await started(root, {
      log,
      validateWorktree: async () => {
        if (!isCapture) {
          return
        }

        validating.resolve(undefined)
        await held.promise
      },
    })
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a worktree')
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'owned uncommitted bytes\n')
    isCapture = true
    winner.onEvent({
      type: 'completed',
      terminal: 'completed',
      requestsMade: 1,
      ceilingReached: false,
      approvalsDenied: 0,
    })
    try {
      await validating.promise
      await t.runner.cancel()
      held.resolve(undefined)
      await vi.waitFor(() => {
        expect(log.warn).toHaveBeenCalledWith(
          "A best-of-N attempt's immutable comparison could not be captured",
        )
      })
      expect(await git(['diff', '--cached', '--name-only'], winner.worktreePath)).toBe('')
      expect(await readFile(path.join(winner.worktreePath, 'tracked.txt'), 'utf8')).toBe(
        'owned uncommitted bytes\n',
      )
    } finally {
      held.resolve(undefined)
      t.runner.dispose()
    }
  })

  it('executes no checkout/fsmonitor/GC hook during automatic worktree capture or Take', async () => {
    const root = await repository()
    const folder = path.join(root, '.git', 'hooks')
    const events = path.join(folder, 'canary-events.txt')
    const script = path.join(folder, 'canary.cjs')
    await writeFile(
      script,
      String.raw`const fs=require('node:fs');const path=require('node:path');fs.appendFileSync(path.join(__dirname,'canary-events.txt'),process.argv[2]+'\n');if(process.argv[2]==='fsmonitor')process.stdout.write('owned-token\0/\0');`,
    )
    const command = `${posixQuoted(process.execPath.replaceAll('\\', '/'))} ${posixQuoted(script.replaceAll('\\', '/'))}`
    for (const [name, event] of [
      ['post-checkout', 'checkout'],
      ['fsmonitor-canary', 'fsmonitor'],
      ['pre-auto-gc', 'gc'],
    ] as const) {
      await writeFile(path.join(folder, name), `#!/bin/sh\nexec ${command} ${event}\n`, {
        mode: 0o755,
      })
    }
    const monitor = path.join(folder, 'fsmonitor-canary')
    await git(['config', 'core.fsmonitor', monitor.replaceAll('\\', '/')], root)
    await git(['config', 'core.fsmonitorHookVersion', '2'], root)
    await git(['update-index', '--fsmonitor'], root)
    const awaitedMember6 = await readFile(path.join(root, '.git', 'index'))
    expect(awaitedMember6.includes(Buffer.from('FSMN'))).toBe(true)
    await git(['config', 'gc.auto', '1'], root)
    await git(['config', 'maintenance.auto', 'true'], root)
    const probe = path.join(roots.at(-1) ?? '', 'hook-probe')
    await git(['worktree', 'add', '-b', 'probe', probe, 'HEAD'], root)
    await git(['status', '--porcelain=v1'], root)
    const observed = await readFile(events, 'utf8')
    expect(observed).toContain('checkout\n')
    expect(observed).toContain('fsmonitor\n')
    await git(['worktree', 'remove', probe], root)
    await writeFile(events, '')
    const t = await started(root)
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a worktree')
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'automatic safe bytes\n')
    await complete(t.attempts, t.updates)
    await t.runner.take(winner.attemptId)
    expect(await readFile(events, 'utf8')).toBe('')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('automatic safe bytes\n')
    const awaitedMember7 = await git(['config', 'core.fsmonitor'], root)
    expect(awaitedMember7.trim()).toBe(monitor.replaceAll('\\', '/'))
    const awaitedMember8 = await git(['config', 'maintenance.auto'], root)
    expect(awaitedMember8.trim()).toBe('true')
    const awaitedMember9 = await git(['config', 'gc.auto'], root)
    expect(awaitedMember9.trim()).toBe('1')
  })

  it('refuses a configured clean filter introduced before capture without executing it', async () => {
    const root = await repository()
    const t = await started(root)
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a worktree')
    const events = path.join(root, '.git', 'filter-events.txt')
    const script = path.join(root, '.git', 'filter-canary.cjs')
    await writeFile(
      script,
      String.raw`require('node:fs').appendFileSync(${JSON.stringify(events)},'filter\n');process.stdin.pipe(process.stdout);`,
    )
    const command = `${posixQuoted(process.execPath.replaceAll('\\', '/'))} ${posixQuoted(script.replaceAll('\\', '/'))}`
    await git(['config', 'filter.canary.clean', command], root)
    await writeFile(path.join(winner.worktreePath, '.gitattributes'), '*.txt filter=canary\n')
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'filtered candidate\n')
    await complete(t.attempts, t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]?.status).toBe('failed')
    await expect(readFile(events)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(t.runner.take(winner.attemptId)).rejects.toMatchObject({
      refusal: 'attemptNotDone',
    })
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
    // Prove the same real filter is wired when ordinary fixture Git asks for it.
    await git(['add', '--all'], winner.worktreePath)
    expect(await readFile(events, 'utf8')).toContain('filter\n')
  })

  it('ignores replacement refs while materializing and comparing a captured object ID', async () => {
    const root = await repository()
    const awaitedMember10 = await git(['rev-parse', 'HEAD:tracked.txt'], root)
    const original = awaitedMember10.trim()
    const awaitedMember11 = await git(
      ['hash-object', '-w', '--stdin'],
      root,
      undefined,
      'unseen replacement bytes\n',
    )
    const replacement = awaitedMember11.trim()
    await git(['replace', original, replacement], root)
    const t = await started(root)
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a worktree')
    expect(await readFile(path.join(winner.worktreePath, 'tracked.txt'), 'utf8')).toBe('before\n')
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'selected object bytes\n')
    await complete(t.attempts, t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]?.diff).toContain('-before')
    expect(t.updates.at(-1)?.runAttempts[0]?.diff).not.toContain('unseen replacement bytes')
    await t.runner.take(winner.attemptId)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('selected object bytes\n')
  })

  it('applies and stages frozen uncommitted text and binary bytes without creating a commit', async () => {
    const root = await repository()
    const base = await git(['rev-parse', 'HEAD'], root)
    const t = await started(root)
    const winner = t.attempts[0]
    const loser = t.attempts[1]
    if (winner === undefined || loser === undefined) throw new Error('Expected two owned worktrees')
    const binary = Uint8Array.of(0, 1, 2, 255)
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'selected\n')
    await writeFile(path.join(winner.worktreePath, 'new.bin'), binary)
    await writeFile(path.join(winner.worktreePath, 'ignored.txt'), 'excluded\n')
    await writeFile(path.join(loser.worktreePath, 'tracked.txt'), 'loser\n')
    await complete(t.attempts, t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]?.files.map((file) => file.path)).toEqual([
      'new.bin',
      'tracked.txt',
    ])
    expect(t.updates.at(-1)?.runAttempts[0]?.diff).toContain('+selected')
    // A later edit in the attempt must not silently replace preview bytes.
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'later unreviewed\n')
    await t.runner.take(winner.attemptId)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('selected\n')
    expect(await readFile(path.join(root, 'new.bin'))).toEqual(Buffer.from(binary))
    expect(await git(['show', ':tracked.txt'], root)).toBe('selected\n')
    expect(await git(['rev-parse', 'HEAD'], root)).toBe(base)
    expect(await git(['status', '--porcelain=v1'], root)).toContain('A  new.bin')
    expect(await readFile(path.join(loser.worktreePath, 'tracked.txt'), 'utf8')).toBe('loser\n')
    await expect(readFile(path.join(root, 'ignored.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['working', 'index', 'head'] as const)(
    'refuses changed target %s without replacing user bytes',
    async (change) => {
      const root = await repository()
      const t = await started(root)
      const winner = t.attempts[0]
      if (winner === undefined) throw new Error('Expected a winner worktree')
      await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'selected\n')
      await complete(t.attempts, t.updates)
      await writeFile(path.join(root, 'tracked.txt'), 'user change\n')
      if (change !== 'working') await git(['add', '--all'], root)
      if (change === 'head') await git(['commit', '-m', 'user change'], root)
      await expect(t.runner.take(winner.attemptId)).rejects.toMatchObject({
        refusal: 'targetChanged',
      })
      expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('user change\n')
      expect(t.updates.at(-1)?.takenBranch).toBeUndefined()
    },
  )

  it('keeps the attempt index owned even if its .git marker is retargeted to the parent', async () => {
    const root = await repository()
    const t = await started(root)
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a winner worktree')
    const marker = path.join(winner.worktreePath, '.git')
    const original = await readFile(marker, 'utf8')
    expect(original).toMatch(/^gitdir: /u)
    // Git for Windows marks this owned file Hidden: Node's default w open refuses it.
    // r+ and explicit truncation preserve attributes and exercise the actual pointer retarget.
    const handle = await open(marker, 'r+')
    try {
      await handle.truncate(0)
      await handle.writeFile(`gitdir: ${path.join(root, '.git')}\n`)
    } finally {
      await handle.close()
    }
    await writeFile(path.join(winner.worktreePath, 'tracked.txt'), 'selected\n')
    await complete(t.attempts, t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]?.status).toBe('completed')
    expect(await git(['diff', '--cached', '--stat'], root)).toBe('')
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
    await t.runner.take(winner.attemptId)
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('selected\n')
  })

  it('rejects an executable symlink snapshot instead of following it during Take', async (context) => {
    const { symlink } = await import('node:fs/promises')
    const root = await repository()
    const t = await started(root)
    const winner = t.attempts[0]
    if (winner === undefined) throw new Error('Expected a winner worktree')
    try {
      await symlink(
        path.join(root, 'tracked.txt'),
        path.join(winner.worktreePath, 'linked.txt'),
        'file',
      )
    } catch (error: unknown) {
      if (
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'EPERM'
      ) {
        context.skip()
        return
      }
      throw error
    }
    await complete(t.attempts, t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]?.status).toBe('failed')
    await expect(t.runner.take(winner.attemptId)).rejects.toMatchObject({
      refusal: 'attemptNotDone',
    })
    expect(await readFile(path.join(root, 'tracked.txt'), 'utf8')).toBe('before\n')
  })
})
