// Lane T: the orchestrator slot. The pure resolutions (the picker while the
// user never touches roles, the override once set, Default following the
// picker live) need no store and stay here. The store drills — Reset clears
// the stored override, reads see a real stored override — have no executable
// real-store path yet: the product keeps the slot in workspace state (PLAN.md
// M96 lane T), which no test can reach until the slot's owner wires it, and
// the key is not a registered configuration (VS Code refuses the write on
// every host). They return with that owner wiring; until then the read/reset
// functions carry @unwired M96.

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
