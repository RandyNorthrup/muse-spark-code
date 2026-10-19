// Lane T: the orchestrator slot. The pure resolutions (the picker while the
// user never touches roles, the override once set, Default following the
// picker live) need no store and stay here. The drills — Reset clears the
// stored override (not just the pill's label), reads see a real stored
// override — run over the real settings store in
// test/integration/orchestratorSlot.test.ts.

import { describe, expect, it } from 'vitest'
import {
  requiresBackendSwitch,
  resolveDefaultModel,
  resolveOrchestratorModel,
} from '../../src/core/team/orchestratorSlot'

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
