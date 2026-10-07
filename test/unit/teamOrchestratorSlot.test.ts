// Lane T: the orchestrator slot. The drills: Reset clears the stored
// override (not just the pill's label); Default follows the picker live.

import { describe, expect, it } from 'vitest'
import {
  readOrchestratorOverride,
  requiresBackendSwitch,
  resetOrchestratorSlot,
  resolveDefaultModel,
  resolveOrchestratorModel,
} from '../../src/core/team/orchestratorSlot'

function memoryState(stored?: unknown): {
  get: (key: string) => unknown
  update: (key: string, value: unknown) => Promise<void>
  written: { key: string; value: unknown }[]
} {
  const written: { key: string; value: unknown }[] = []
  let current = stored
  return {
    get: () => current,
    update: (key: string, value: unknown) => {
      written.push({ key, value })
      current = value
      return Promise.resolve()
    },
    written,
  }
}

describe('readOrchestratorOverride', () => {
  it('reads no override by default: the picker decides', () => {
    expect(readOrchestratorOverride(memoryState())).toBeUndefined()
  })

  it('reads a stored override', () => {
    const state = memoryState({ modelId: 'opus-5.5', backend: 'modelApi' })
    expect(readOrchestratorOverride(state)).toEqual({ modelId: 'opus-5.5', backend: 'modelApi' })
  })

  it('reads anything else stored as none', () => {
    expect(readOrchestratorOverride(memoryState({ model: 'x' }))).toBeUndefined()
    expect(readOrchestratorOverride(memoryState('opus'))).toBeUndefined()
  })
})

describe('resetOrchestratorSlot', () => {
  it('clears the stored override, so the picker decides again', async () => {
    const state = memoryState({ modelId: 'opus-5.5', backend: 'modelApi' })
    await resetOrchestratorSlot(state)
    expect(readOrchestratorOverride(state)).toBeUndefined()
    expect(state.written).toHaveLength(1)
  })
})

describe('resolveOrchestratorModel', () => {
  it('is the picker while the user never touches roles', () => {
    expect(
      resolveOrchestratorModel({
        override: undefined,
        pickerModelId: 'muse-spark-1.3',
        pickerBackend: 'musecode',
      }),
    ).toEqual({ modelId: 'muse-spark-1.3', backend: 'musecode', isOverridden: false })
  })

  it('takes effect for new conversations once set', () => {
    expect(
      resolveOrchestratorModel({
        override: { modelId: 'opus-5.5', backend: 'modelApi' },
        pickerModelId: 'muse-spark-1.3',
        pickerBackend: 'musecode',
      }),
    ).toEqual({ modelId: 'opus-5.5', backend: 'modelApi', isOverridden: true })
  })
})

describe('resolveDefaultModel', () => {
  it('follows the picker live: a change applies to the next delegation', () => {
    const first = resolveDefaultModel({
      override: undefined,
      pickerModelId: 'a',
      pickerBackend: 'musecode',
    })
    const second = resolveDefaultModel({
      override: undefined,
      pickerModelId: 'b',
      pickerBackend: 'musecode',
    })
    expect(first.modelId).toBe('a')
    expect(second.modelId).toBe('b')
  })

  it('follows the override while one is set', () => {
    expect(
      resolveDefaultModel({
        override: { modelId: 'opus-5.5', backend: 'modelApi' },
        pickerModelId: 'muse-spark-1.3',
        pickerBackend: 'musecode',
      }).modelId,
    ).toBe('opus-5.5')
  })
})

describe('requiresBackendSwitch', () => {
  it('says so only across backends', () => {
    expect(requiresBackendSwitch('musecode', 'modelApi')).toBe(true)
    expect(requiresBackendSwitch('modelApi', 'modelApi')).toBe(false)
  })
})
