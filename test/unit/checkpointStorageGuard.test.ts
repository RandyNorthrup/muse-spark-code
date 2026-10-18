// The checkpoint storage guard's refusal reads
// (src/host/checkpoints/checkpointHost.ts): a turn that cannot be marked
// refuses the shell entry with the mark failure as its cause, closing the
// uncertain mark either way; a thrown run guard is the refusal itself,
// returned as a refused entry, never thrown.
import { describe, expect, it } from 'vitest'
import { ShellEntryError } from '../../src/core/shellResult'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  withCheckpointStorageGuard,
  type CheckpointPort,
} from '../../src/host/checkpoints/checkpointHost'

function ports(options: { markTrue?: Error; markFalse?: Error; unproven?: Error }) {
  const marks: { readonly key: string; readonly isRunning: boolean }[] = []
  const checkpoints = {
    markUnprovenProcess: () =>
      options.unproven === undefined ? Promise.resolve() : Promise.reject(options.unproven),
    markTurn: (key: string, isRunning: boolean) => {
      marks.push({ key, isRunning })
      const failure = isRunning ? options.markTrue : options.markFalse
      return failure === undefined ? Promise.resolve() : Promise.reject(failure)
    },
  } as unknown as CheckpointPort
  return { checkpoints, marks }
}

// The guard only binds the conditional writer through; it never runs here.
const io = {
  writeFileIfUnchanged: () => Promise.resolve('written'),
} as unknown as ToolIo

describe('withCheckpointStorageGuard', () => {
  it('refuses the entry with the mark failure, closing the uncertain mark', async () => {
    const markFailure = new Error('presence file is down')
    const { checkpoints, marks } = ports({ markTrue: markFailure })
    const guarded = withCheckpointStorageGuard(io, checkpoints)
    let failure: unknown
    try {
      await guarded.runShell(
        'true',
        '/ws',
        1000,
        new AbortController().signal,
        1000,
        () => undefined,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ShellEntryError)
    expect((failure as ShellEntryError).cause).toBe(markFailure)
    expect(marks).toHaveLength(2)
    expect(marks[0]).toMatchObject({ isRunning: true })
    expect(marks[1]).toMatchObject({ isRunning: false })
    expect(marks[0]?.key).toBe(marks[1]?.key)
  })

  it('refuses the entry with the mark failure when the close fails too', async () => {
    const markFailure = new Error('presence file is down')
    const { checkpoints } = ports({
      markTrue: markFailure,
      markFalse: new Error('presence file is still down'),
    })
    const guarded = withCheckpointStorageGuard(io, checkpoints)
    let failure: unknown
    try {
      await guarded.runShell(
        'true',
        '/ws',
        1000,
        new AbortController().signal,
        1000,
        () => undefined,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ShellEntryError)
    expect((failure as ShellEntryError).cause).toBe(markFailure)
  })

  it('returns a refused entry when the run guard throws', async () => {
    const { checkpoints } = ports({})
    const guarded = withCheckpointStorageGuard(io, checkpoints)
    const result = await guarded.runShell(
      'true',
      '/ws',
      1000,
      new AbortController().signal,
      1000,
      () => {
        throw new Error('resource is busy')
      },
    )
    expect(result.isEntryRefused).toBe(true)
  })
})
