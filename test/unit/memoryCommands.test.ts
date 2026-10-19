// The memory view's failure reads (src/host/commands/memoryCommands.ts):
// a note or folder that vanished mid-view is said in fixed words; any
// other failure reaches the command as the failure it is, with its cause.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { showMemory, type MemoryViewDeps } from '../../src/host/commands/memoryCommands'

function deps(availableScopes: () => Promise<never>, shown: string[]): MemoryViewDeps {
  return {
    store: { availableScopes },
    showError: (message: string) => {
      shown.push(message)
    },
  } as unknown as MemoryViewDeps
}

describe('showMemory', () => {
  it('says a vanished folder in fixed words', async () => {
    const shown: string[] = []
    const vanished = Object.assign(new Error('ENOENT: no such folder'), { code: 'ENOENT' })
    await showMemory(deps(() => Promise.reject(vanished), shown))
    expect(shown).toEqual([UI_TEXT.memoryFailed])
  })

  it('carries any other failure to the command with its cause', async () => {
    const shown: string[] = []
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    let failure: unknown
    try {
      await showMemory(deps(() => Promise.reject(denied), shown))
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.memoryFailed)
    expect((failure as Error).cause).toBe(denied)
    expect(shown).toEqual([])
  })
})
