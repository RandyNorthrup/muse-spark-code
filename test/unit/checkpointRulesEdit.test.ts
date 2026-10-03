import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRulesFile } from '../../src/host/commands/createRulesFile'
import { type CheckpointPort, withCheckpointEdit } from '../../src/host/checkpoints/checkpointHost'
import { UI_TEXT } from '../../src/shared/constants'
import { processGitProcess } from '../../src/host/git'
import { fakeMuseCodeManager } from './helpers/museCodeManager'
import {
  changedFileTurn,
  checkpointPort,
  done,
  type Harness,
  harness,
  holdRestoreRef,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  turn,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

function templateAction(
  h: Harness,
  port: CheckpointPort,
  signal: AbortSignal,
  isTrusted = true,
  isFilePresent: () => Promise<boolean> = async () => await isPresent(h.root, 'AGENTS.md'),
) {
  const manager = fakeMuseCodeManager()
  const check = manager.workspaceActionGuard(signal)
  const writeFile = vi.fn(async (_path: string, content: string) => {
    await write(h.root, 'AGENTS.md', content)
  })
  const run = async () => {
    await createRulesFile({
      workspaceRoot: h.root,
      isWorkspaceTrusted: () => isTrusted,
      fileExists: isFilePresent,
      runInit: () => undefined,
      // As activation wires it: under the lease, and never recorded (M86).
      writeFile: async (file, content) => {
        await withCheckpointEdit(port, h.log, check, async () => {
          await writeFile(file, content)
        })
      },
      openFile: () => Promise.resolve(),
      showInformation: () => undefined,
      showWarning: () => undefined,
      log: h.log,
    })
  }
  return { manager, run, writeFile }
}

describe('Create AGENTS.md pure template admission (M72)', () => {
  it(
    'holds exclusion until actual file I/O settles and clears without a process certainty flag',
    async () => {
      const h = await harness()
      await changedFileTurn(h)
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const port = checkpointPort(h)
      const work = vi.fn(async () => {
        entered.resolve(undefined)
        await resume.promise
        await write(h.root, 'AGENTS.md', 'explicit edit\n')
      })
      const editing = withCheckpointEdit(port, h.log, () => undefined, work)
      try {
        await entered.promise
        expect(await restoreOutcome(h.reopen(), 't1')).toEqual({
          ok: false,
          reason: 'turnElsewhere',
        })
        expect(await isPresent(h.root, 'AGENTS.md')).toBe(false)
      } finally {
        resume.resolve(undefined)
      }
      await editing
      expect(h.store.isNativeUnsafe).toBe(false)
      expect(await read(h.root, 'AGENTS.md')).toBe('explicit edit\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each([true, false])(
    'writes no absent-CLI template under a real restore ref (trusted=%s)',
    async (isTrusted) => {
      let canRunGit = true
      const realGit = processGitProcess()
      const h = await harness({
        gitProcess: async (args, options) => {
          if (!canRunGit) {
            throw new Error('Restricted template admission must run no Git')
          }
          return await realGit(args, options)
        },
      })
      await holdRestoreRef(h)
      canRunGit = isTrusted
      const action = templateAction(
        h,
        checkpointPort(h, isTrusted),
        new AbortController().signal,
        isTrusted,
      )
      await expect(action.run()).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(action.writeFile).not.toHaveBeenCalled()
      expect(await isPresent(h.root, 'AGENTS.md')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['window closed', 'manager disposed'])(
    'writes no template when %s while missing-file lookup is held',
    async (reason) => {
      const h = await harness()
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const lifetime = new AbortController()
      const action = templateAction(h, checkpointPort(h), lifetime.signal, true, async () => {
        entered.resolve(undefined)
        await resume.promise
        return false
      })
      const editing = action.run()
      const refused = expect(editing).rejects.toThrow(UI_TEXT.questionCancelled)
      try {
        await entered.promise
        if (reason === 'window closed') {
          lifetime.abort()
        } else {
          await action.manager.dispose()
        }
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(action.writeFile).not.toHaveBeenCalled()
      expect(await isPresent(h.root, 'AGENTS.md')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    "never records the AGENTS.md the user created while a turn ran, so the turn's restore leaves it",
    async () => {
      const h = await harness()
      await write(h.root, 'a.txt', 'a0\n')
      const action = templateAction(h, checkpointPort(h), new AbortController().signal)
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        await action.run()
      })
      const outcome = done(await restoreOutcome(h.store, 't1'))
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([])
      expect(await read(h.root, 'AGENTS.md')).toContain('##')
      // The turn's own change still goes back.
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'preserves the explicit Restricted Mode template action without invoking Git',
    async () => {
      const h = await harness({
        gitProcess: () => {
          throw new Error('Restricted template action must run no Git')
        },
      })
      const action = templateAction(
        h,
        checkpointPort(h, false),
        new AbortController().signal,
        false,
      )
      await action.run()
      expect(action.writeFile).toHaveBeenCalledOnce()
      expect(await read(h.root, 'AGENTS.md')).toContain('##')
      expect(h.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
