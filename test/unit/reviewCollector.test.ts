// The review collector's failure reads (src/host/review/reviewCollector.ts):
// a folder that vanished mid-review reviews nothing (cancelled); a folder
// that cannot be read at all keeps the review closed as git failing, never
// as cancelled; only git's own exit 1 reads as an empty filter inventory.
import { execFile } from 'node:child_process'
import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { GitExitError } from '../../src/host/git'
import {
  createReviewCollector,
  type ReviewCollectorDeps,
} from '../../src/host/review/reviewCollector'
import { usingTempDir } from './helpers/temporaryFolders'

const runFile = promisify(execFile)

/** Real git, its failures as the product's own exit error with real codes. */
const realGit: ReviewCollectorDeps['runGit'] = async (args, cwd, timeoutMs) => {
  try {
    const finished = await runFile('git', [...args], { cwd, timeout: timeoutMs })
    return finished.stdout
  } catch (error: unknown) {
    const failure = error as { readonly code?: unknown; readonly stderr?: unknown }
    throw new GitExitError(
      typeof failure.code === 'number' ? failure.code : -1,
      typeof failure.stderr === 'string' ? failure.stderr : '',
      [...args].join(' '),
    )
  }
}

const neverPick: ReviewCollectorDeps['pickOne'] = () =>
  Promise.reject(new Error('no picker runs in these reviews'))

const foreignExitOne: ReviewCollectorDeps['runGit'] = async (args, cwd, timeoutMs) => {
  if (args.includes('--get-regexp')) {
    await runFile(process.execPath, ['-e', 'process.exit(1)'], { cwd })
  }
  return await realGit(args, cwd, timeoutMs)
}

describe('createReviewCollector', () => {
  it('cancels when the folder vanished', async () => {
    await usingTempDir('review-collector-', async (folder) => {
      const collect = createReviewCollector({
        workspaceRoot: path.join(folder, 'gone'),
        runGit: realGit,
        pickOne: neverPick,
      })
      const collection = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
      expect(collection).toEqual({ kind: 'cancelled' })
    })
  })

  it('refuses an unreadable folder as git failing, never as cancelled', async () => {
    await usingTempDir('review-collector-', async (folder) => {
      const locked = path.join(folder, 'locked')
      await mkdir(locked)
      try {
        await chmod(locked, 0)
        const collect = createReviewCollector({
          workspaceRoot: locked,
          runGit: realGit,
          pickOne: neverPick,
        })
        const collection = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
        expect(collection.kind).toBe('refused')
        expect(collection).toMatchObject({ refusal: 'gitFailed' })
      } finally {
        await chmod(locked, 0o755)
      }
    })
  })

  it('reads git exit 1 as an empty filter inventory and reviews on', async () => {
    await usingTempDir('review-collector-', async (folder) => {
      // Outside any repository real git answers the filter read with
      // exit 1: the review reads it as no filters and refuses for the
      // honest reason (no repository), never as git failing.
      const collect = createReviewCollector({
        workspaceRoot: folder,
        runGit: realGit,
        pickOne: neverPick,
      })
      const collection = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
      expect(collection).toEqual({ kind: 'refused', refusal: 'notRepository' })
    })
  })

  it('closes on a foreign exit 1 instead of emptying the inventory', async () => {
    await usingTempDir('review-collector-', async (folder) => {
      // A process that is not git exiting 1 for the filter read: only
      // git's own exit 1 reads as an empty inventory. The old handler
      // emptied on any numeric 1 and reviewed on; the fixed one refuses.
      const collect = createReviewCollector({
        workspaceRoot: folder,
        runGit: foreignExitOne,
        pickOne: neverPick,
      })
      const collection = await collect({ scope: 'uncommitted', focus: 'general' }, () => true)
      expect(collection).toMatchObject({ kind: 'refused', refusal: 'gitFailed' })
    })
  })
})
