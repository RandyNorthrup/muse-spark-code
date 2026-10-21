// The checkpoint storage guard's refusal reads
// (src/host/checkpoints/checkpointHost.ts): a turn that cannot be marked
// refuses the shell entry with the mark failure as its cause, closing the
// uncertain mark either way; a thrown run guard is the refusal itself,
// returned as a refused entry, never thrown. The ToolIo is the runtime's
// own headless wiring and the port is the product's own factory: with no
// known namespace the port's mark calls fail with the product's own
// native-unsafe error, and the tests assert that failure travels.
import { describe, expect, it } from 'vitest'
import { ShellEntryError } from '../../src/core/shellResult'
import { ShellTimeLimit } from '../../src/core/backends/modelapi/tools'
import { UI_TEXT } from '../../src/shared/constants'
import {
  createCheckpointPort,
  withCheckpointStorageGuard,
  type CheckpointPort,
} from '../../src/host/checkpoints/checkpointHost'
import { headlessToolIo } from './helpers/headlessToolIo'
import { usingTempDir } from './helpers/temporaryFolders'

/** The real port, recording every mark call. */
function ports(options: { namespaceKnown: boolean; closeFails?: Error }) {
  const marks: { readonly key: string; readonly isRunning: boolean }[] = []
  const closeError: Error | undefined = options.closeFails
  const port = createCheckpointPort({
    store: undefined,
    isNamespaceKnown: () => options.namespaceKnown,
    isWorkspaceTrusted: () => true,
    isEnabled: () => true,
    hasGit: () => false,
    ...(closeError !== undefined && {
      onAvailabilityChanged: () => {
        throw closeError
      },
    }),
  })
  const checkpoints: CheckpointPort = {
    ...port,
    markTurn: async (key, isRunning) => {
      marks.push({ key, isRunning })
      await port.markTurn(key, isRunning)
    },
  }
  return { checkpoints, marks }
}

/** Runs the entry, returning the failure it throws. */
async function runThrowing(
  guarded: ReturnType<typeof withCheckpointStorageGuard>,
): Promise<unknown> {
  try {
    await guarded.runShell(
      'true',
      '/ws',
      1000,
      new AbortController().signal,
      new ShellTimeLimit(),
      () => undefined,
    )
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe('withCheckpointStorageGuard', () => {
  it('refuses the entry with the mark failure, closing the uncertain mark', async () => {
    await usingTempDir('checkpoint-guard-', async (root) => {
      const { checkpoints, marks } = ports({ namespaceKnown: false })
      const guarded = withCheckpointStorageGuard(headlessToolIo(root), checkpoints)
      const failure = await runThrowing(guarded)
      expect(failure).toBeInstanceOf(ShellEntryError)
      expect((failure as ShellEntryError).cause).toBeInstanceOf(Error)
      expect(((failure as ShellEntryError).cause as Error).message).toBe(
        UI_TEXT.checkpointsNativeUnsafe,
      )
      expect(marks).toHaveLength(2)
      expect(marks[0]).toMatchObject({ isRunning: true })
      expect(marks[1]).toMatchObject({ isRunning: false })
      expect(marks[0]?.key).toBe(marks[1]?.key)
    })
  })

  it('refuses with the open failure when the close fails too', async () => {
    await usingTempDir('checkpoint-guard-', async (root) => {
      const closeFailure = new Error('presence file is still down')
      const { checkpoints } = ports({ namespaceKnown: false, closeFails: closeFailure })
      const guarded = withCheckpointStorageGuard(headlessToolIo(root), checkpoints)
      const failure = await runThrowing(guarded)
      expect(failure).toBeInstanceOf(ShellEntryError)
      // The swallowed close failure never masks the open one.
      expect(((failure as ShellEntryError).cause as Error).message).toBe(
        UI_TEXT.checkpointsNativeUnsafe,
      )
      expect(((failure as ShellEntryError).cause as Error).message).not.toBe(closeFailure.message)
    })
  })

  it('returns a refused entry when the run guard throws', async () => {
    await usingTempDir('checkpoint-guard-', async (root) => {
      const { checkpoints } = ports({ namespaceKnown: true })
      const guarded = withCheckpointStorageGuard(headlessToolIo(root), checkpoints)
      const result = await guarded.runShell(
        'true',
        '/ws',
        1000,
        new AbortController().signal,
        new ShellTimeLimit(),
        () => {
          throw new Error('resource is busy')
        },
      )
      expect(result.isEntryRefused).toBe(true)
    })
  })
})
