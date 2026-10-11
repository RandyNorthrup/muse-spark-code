import { describe, expect, it, vi } from 'vitest'
import {
  resourceRunnerPreference,
  type ResourceRunnerRouting,
} from '../../src/core/runners/routing'

function setup(overrides: Partial<ResourceRunnerRouting<string>> = {}) {
  const approvedRunner = vi.fn((): string | undefined => 'approved-linux-check-runner')
  const routing: ResourceRunnerRouting<string> = {
    level: 'relocate',
    relocation: 'paired',
    queued: true,
    keepHere: false,
    approvedRunner,
    ...overrides,
  }
  return { routing, approvedRunner }
}

describe('C2 existing runner routing takes the local resource level', () => {
  it.each(['normal', 'throttle'] as const)(
    'leaves %s routing unchanged without consulting runners',
    (level) => {
      const h = setup({ level })
      expect(resourceRunnerPreference(h.routing)).toBeUndefined()
      expect(h.approvedRunner).not.toHaveBeenCalled()
    },
  )

  it.each(['relocate', 'pause'] as const)(
    'proposes only an already approved matching runner at %s',
    (level) => {
      const h = setup({ level })
      expect(resourceRunnerPreference(h.routing)).toEqual({
        runner: 'approved-linux-check-runner',
        level,
        reason: 'machineBusy',
        requiresConfirmation: false,
      })
      expect(h.approvedRunner).toHaveBeenCalledTimes(1)
    },
  )

  it('leaves running attempts alone even at pause', () => {
    const h = setup({ level: 'pause', queued: false })
    expect(resourceRunnerPreference(h.routing)).toBeUndefined()
    expect(h.approvedRunner).not.toHaveBeenCalled()
  })

  it('does no runner activity with relocation off', () => {
    const h = setup({ relocation: 'off' })
    expect(resourceRunnerPreference(h.routing)).toBeUndefined()
    expect(h.approvedRunner).not.toHaveBeenCalled()
  })

  it('honors Keep here without consulting runners', () => {
    const h = setup({ keepHere: true })
    expect(resourceRunnerPreference(h.routing)).toBeUndefined()
    expect(h.approvedRunner).not.toHaveBeenCalled()
  })

  it('marks Ask as a confirmation proposal and never turns a missing runner into success', () => {
    const h = setup({ relocation: 'ask' })
    expect(resourceRunnerPreference(h.routing)?.requiresConfirmation).toBe(true)
    h.approvedRunner.mockReturnValue(undefined)
    expect(resourceRunnerPreference(h.routing)).toBeUndefined()
  })
})
