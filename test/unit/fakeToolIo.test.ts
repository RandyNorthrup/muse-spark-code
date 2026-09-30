// The shell stand-ins keep the real adapter's contract (M72): the sixth
// `runShell` argument, the owner's final admission, is asked once at entry.
// A refusal is the proven no-entry result and records and runs nothing; a
// command that entered keeps its own outcome whatever the owner does next.
import { describe, expect, it, vi } from 'vitest'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { heldShellToolIo, memoryToolIo, noopToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'

function refuse(): never {
  throw new Error('the owner changed')
}

interface StandIn {
  readonly io: ToolIo
  /** How many commands entered the stand-in (it records them). */
  readonly entered: () => number
  /** Lets a command the stand-in holds finish. */
  readonly settle: () => void
}

const RECORDERS: readonly (readonly [string, () => StandIn])[] = [
  [
    'the memory file system',
    () => {
      const io = memoryToolIo({}, ROOT)
      return { io, entered: () => io.shellCalls.length, settle: () => undefined }
    },
  ],
  [
    'the held shell',
    () => {
      const io = heldShellToolIo({}, ROOT)
      return {
        io,
        entered: () => io.runs.length,
        settle: () => {
          io.runs[0]?.finish({ stdout: 'done' })
        },
      }
    },
  ],
]

const STAND_INS: readonly (readonly [string, () => StandIn])[] = [
  ...RECORDERS,
  ['the do-nothing shell', () => ({ io: noopToolIo, entered: () => 0, settle: () => undefined })],
]

describe('the shell stand-ins and the final admission', () => {
  it.each(STAND_INS)('%s refuses at its entry and records nothing', async (_name, make) => {
    const { io, entered } = make()
    const result = await io.runShell('ls', ROOT, 1000, undefined, undefined, refuse)
    expect(result).toMatchObject({
      exitCode: null,
      isCancelled: true,
      isEntryRefused: true,
      isWorkspaceShutdownProven: true,
    })
    expect(entered()).toBe(0)
  })

  it.each(STAND_INS)('%s asks once, and runs the command when admitted', async (_name, make) => {
    const { io, settle } = make()
    const guard = vi.fn()
    const pending = io.runShell('ls', ROOT, 1000, undefined, undefined, guard)
    settle()
    expect(guard).toHaveBeenCalledOnce()
    const result = await pending
    expect(result.exitCode).toBe(0)
    expect(result.isEntryRefused).toBeUndefined()
  })

  it.each(RECORDERS)('%s records a command only once it entered', async (_name, make) => {
    const { io, entered, settle } = make()
    const pending = io.runShell('ls', ROOT, 1000, undefined, undefined, vi.fn())
    settle()
    await pending
    expect(entered()).toBe(1)
  })

  it('keeps an entered held command’s outcome when the owner changes afterwards', async () => {
    const io = heldShellToolIo({}, ROOT)
    let isAllowed = true
    const pending = io.runShell('ls', ROOT, 1000, undefined, undefined, () => {
      if (!isAllowed) refuse()
    })
    isAllowed = false
    io.runs[0]?.finish({ stdout: 'listed', exitCode: 0 })
    const result = await pending
    expect(result).toMatchObject({ stdout: 'listed', exitCode: 0 })
    expect(result.isEntryRefused).toBeUndefined()
  })
})
