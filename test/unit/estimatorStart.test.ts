import { describe, expect, it, vi } from 'vitest'
import { EstimateWaveStarter } from '../../src/core/estimator/provision/start'
import { FakeEstimateStart } from './helpers/estimator/fakes'
import { pending } from './helpers/estimatorProvisionFixtures'
import { scheduleLane, scheduleFleet, simulationInputs } from './helpers/estimatorScheduleFixtures'

describe('M117 first-wave dispatch under the playbook', () => {
  it('submits only resource-admitted first lanes, sorted small first, after the audit', async () => {
    const board = new FakeEstimateStart()
    const starter = new EstimateWaveStarter(board)
    const inputs = simulationInputs([
      scheduleLane('A', { estimatedHours: 2 }),
      scheduleLane('B'),
      scheduleLane('C', { dependencies: ['A'] }),
      scheduleLane('E'),
    ])
    expect(await starter.start(inputs)).toEqual(['B', 'A'])
    expect(board.audits).toEqual([['B', 'A']])
    expect(board.starts).toEqual([['B', 'A']])
  })

  it('dispatches contracts first while other ready lanes wait', async () => {
    const board = new FakeEstimateStart()
    const fleet = scheduleFleet(1)
    for (const machine of fleet.machines)
      machine.capacityByKind.push({ kind: 'contracts', slots: 1 })
    const inputs = simulationInputs(
      [scheduleLane('zero', { kind: 'contracts' }), scheduleLane('A', { estimatedHours: 10 })],
      fleet,
    )
    expect(await new EstimateWaveStarter(board).start(inputs)).toEqual(['zero'])
  })

  it('never duplicates a running lane or dispatches its dependent before merge', async () => {
    const board = new FakeEstimateStart()
    const inputs = simulationInputs([
      scheduleLane('R', { state: 'running' }),
      scheduleLane('D', { dependencies: ['R'] }),
      scheduleLane('P'),
    ])
    expect(await new EstimateWaveStarter(board).start(inputs)).toEqual(['P'])
  })

  it('refuses missing prerequisites before submission', async () => {
    const board = new FakeEstimateStart(['M116'])
    await expect(new EstimateWaveStarter(board).start(simulationInputs())).rejects.toThrow(
      'Contracts must be reviewed',
    )
    expect(board.starts).toEqual([])
  })

  it('waits for merge evidence even when a running prerequisite has zero estimated remainder', async () => {
    const board = new FakeEstimateStart()
    const inputs = simulationInputs([
      scheduleLane('R', { state: 'running', elapsedAgentHours: 1, minimumRemainingHours: 0 }),
      scheduleLane('D', { dependencies: ['R'] }),
      scheduleLane('P'),
    ])
    expect(await new EstimateWaveStarter(board).start(inputs)).toEqual(['P'])
  })

  it('refuses inconsistent or malformed audit results and audit failures', async () => {
    const start = vi.fn(() => Promise.resolve())
    for (const result of [
      { allowed: true, missingPrerequisites: ['M96'] },
      { allowed: false, missingPrerequisites: [] },
    ]) {
      await expect(
        new EstimateWaveStarter({ audit: () => Promise.resolve(result), start }).start(
          simulationInputs(),
        ),
      ).rejects.toThrow()
    }
    await expect(
      new EstimateWaveStarter({
        audit: () => Promise.reject(new Error('private detail')),
        start,
      }).start(simulationInputs()),
    ).rejects.toThrow('prerequisite-audit')
    expect(start).not.toHaveBeenCalled()
  })

  it('serializes concurrent starts and retains claims after uncertain dispatch', async () => {
    const gate = pending<{ allowed: boolean; missingPrerequisites: string[] }>()
    const audit = vi.fn(() => gate.promise)
    const start = vi.fn(() => Promise.resolve())
    const starter = new EstimateWaveStarter({ audit, start })
    const first = starter.start(simulationInputs())
    const second = starter.start(simulationInputs())
    await vi.waitFor(() => {
      expect(audit).toHaveBeenCalledTimes(1)
    })
    gate.resolve({ allowed: true, missingPrerequisites: [] })
    expect(await first).toEqual(['A'])
    expect(await second).toEqual([])
    expect(audit).toHaveBeenCalledTimes(1)
    const failing = new EstimateWaveStarter({
      audit,
      start: () => Promise.reject(new Error('private detail')),
    })
    await expect(failing.start(simulationInputs())).rejects.toThrow('dispatch-uncertain')
    expect(await failing.start(simulationInputs())).toEqual([])
  })

  it('refuses unknown capacity and malformed inputs without submitting', async () => {
    const board = new FakeEstimateStart()
    const inputs = simulationInputs()
    for (const account of inputs.fleet.accounts) delete account.usageLimits
    await expect(new EstimateWaveStarter(board).start(inputs)).rejects.toThrow('unknown-capacity')
    expect(board.starts).toEqual([])
  })
})
