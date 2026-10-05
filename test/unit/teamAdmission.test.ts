// Lane A admission slots (M96, PLAN.md D75): removing each limit in turn
// must fail its own case.

import { describe, expect, it } from 'vitest'
import {
  TeamAdmission,
  teamShellCommandSlots,
  type TeamAdmissionLimits,
} from '../../src/core/team/teamAdmission'

function limits(overrides: Partial<TeamAdmissionLimits> = {}): TeamAdmissionLimits {
  return {
    globalLimit: 20,
    processLimit: 4,
    shellLimit: 4,
    maxDepth: 2,
    agentLimit: () => 8,
    entryLimit: () => 4,
    roleLimit: () => 4,
    ...overrides,
  }
}

const ENGINE_TASK = {
  entryId: 'eng-1',
  agentKey: 'opus',
  agentKind: 'engine',
  roleId: 'engineering',
  depth: 1,
} as const
const PROCESS_TASK = {
  entryId: 'rev-1',
  agentKey: 'codex',
  agentKind: 'museCode',
  roleId: 'code-review',
  depth: 1,
} as const

describe('teamAdmission', () => {
  it('admits while every slot has room, and releases every counter', () => {
    const admission = new TeamAdmission(limits())
    const first = admission.admitTask({ ...ENGINE_TASK })
    expect(first.admitted).toBe(true)
    if (!first.admitted) throw new Error('unreachable')
    expect(admission.runningByEntry('eng-1')).toBe(1)
    expect(admission.runningByAgent('opus')).toBe(1)
    expect(admission.runningGlobal()).toBe(1)
    first.release()
    first.release()
    expect(admission.runningByEntry('eng-1')).toBe(0)
    expect(admission.runningGlobal()).toBe(0)
  })

  it('refuses per entry: concurrent has no room', () => {
    const admission = new TeamAdmission(limits({ entryLimit: () => 1 }))
    const first = admission.admitTask({ ...ENGINE_TASK })
    expect(first.admitted).toBe(true)
    const second = admission.admitTask({ ...ENGINE_TASK })
    expect(second).toMatchObject({ admitted: false, reason: 'entry' })
  })

  it('refuses per agent: the plan limit spans every role', () => {
    const admission = new TeamAdmission(limits({ agentLimit: () => 1 }))
    const first = admission.admitTask({ ...ENGINE_TASK })
    expect(first.admitted).toBe(true)
    const other = admission.admitTask({ ...ENGINE_TASK, entryId: 'eng-2', roleId: 'research' })
    expect(other).toMatchObject({ admitted: false, reason: 'agent' })
  })

  it('refuses per role: the intensity level bounds the role', () => {
    const admission = new TeamAdmission(limits({ roleLimit: () => 1 }))
    expect(admission.admitTask({ ...ENGINE_TASK })).toMatchObject({ admitted: true })
    expect(admission.admitTask({ ...ENGINE_TASK, entryId: 'eng-2' })).toMatchObject({
      admitted: false,
      reason: 'role',
    })
  })

  it('refuses global: twenty tasks made ready at once never pass teamMaxWorkers together', () => {
    const admission = new TeamAdmission(
      limits({ globalLimit: 20, roleLimit: () => 20, agentLimit: () => 20 }),
    )
    const held = []
    for (let n = 0; n < 20; n += 1) {
      const admitted = admission.admitTask({ ...ENGINE_TASK, entryId: `eng-${String(n)}` })
      expect(admitted.admitted).toBe(true)
      if (admitted.admitted) held.push(admitted)
    }
    expect(admission.admitTask({ ...ENGINE_TASK, entryId: 'eng-21' })).toMatchObject({
      admitted: false,
      reason: 'global',
    })
    for (const task of held) task.release()
  })

  it('refuses process workers past teamMaxProcessWorkers, but not engine workers', () => {
    const admission = new TeamAdmission(limits({ processLimit: 1 }))
    expect(admission.admitTask({ ...PROCESS_TASK }).admitted).toBe(true)
    expect(admission.admitTask({ ...PROCESS_TASK, entryId: 'rev-2' })).toMatchObject({
      admitted: false,
      reason: 'process',
    })
    expect(admission.admitTask({ ...ENGINE_TASK }).admitted).toBe(true)
  })

  it('refuses depth past the maximum: a worker’s children never nest deeper than delegates allow', () => {
    const admission = new TeamAdmission(limits())
    expect(admission.admitTask({ ...ENGINE_TASK, depth: 2 }).admitted).toBe(true)
    expect(admission.admitTask({ ...ENGINE_TASK, depth: 3 })).toMatchObject({
      admitted: false,
      reason: 'depth',
    })
    expect(admission.admitTask({ ...ENGINE_TASK, depth: 0 })).toMatchObject({
      admitted: false,
      reason: 'depth',
    })
  })

  it('refuses shell commands past the slots, and hands the slot back', () => {
    const admission = new TeamAdmission(limits({ shellLimit: 1 }))
    const first = admission.acquireShell()
    expect(first.admitted).toBe(true)
    expect(admission.acquireShell()).toMatchObject({ admitted: false, reason: 'shell' })
    if (!first.admitted) throw new Error('unreachable')
    first.release()
    expect(admission.acquireShell().admitted).toBe(true)
  })

  it('sizes shell slots at half the logical CPUs, at least 1', () => {
    expect(teamShellCommandSlots(1)).toBe(1)
    expect(teamShellCommandSlots(8)).toBe(4)
    expect(teamShellCommandSlots(7)).toBe(3)
  })
})
