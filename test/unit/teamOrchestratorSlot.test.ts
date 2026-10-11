// Lane T: the orchestrator slot. The drills: Reset clears the stored
// override (not just the pill's label); Default follows the picker live.

import { describe, expect, it } from 'vitest'
import { AGENT_FILE_MAX_BYTES, TEAM_ROLE_WHEN_TO_USE_MAX_CHARS } from '../../src/shared/constants'
import { teamSnapshotSchema } from '../../src/shared/teamConfig'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
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
  const values = new Map<string, unknown>([[TEAM_WORKSPACE_KEYS.team, stored]])
  return {
    get: (key) => values.get(key),
    update: (key: string, value: unknown) => {
      written.push({ key, value })
      values.set(key, value)
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
    const state = memoryState({
      roles: [],
      intensity: 'minimal',
      orchestrator: { agent: { kind: 'engine', agentId: 'key', model: 'opus-5.5', pays: 'key' } },
    })
    expect(readOrchestratorOverride(state)).toEqual({ modelId: 'opus-5.5', backend: 'modelApi' })
  })

  it('reads anything else stored as none', () => {
    expect(readOrchestratorOverride(memoryState({ model: 'x' }))).toBeUndefined()
    expect(readOrchestratorOverride(memoryState('opus'))).toBeUndefined()
  })
})

describe('resetOrchestratorSlot', () => {
  it('clears the stored override, so the picker decides again', async () => {
    const state = memoryState({
      roles: [],
      intensity: 'minimal',
      orchestrator: { agent: { kind: 'engine', agentId: 'key', model: 'opus-5.5', pays: 'key' } },
    })
    await resetOrchestratorSlot(state)
    expect(readOrchestratorOverride(state)).toBeUndefined()
    expect(state.written).toHaveLength(1)
  })
})

describe('saved role admission', () => {
  it.each([
    { field: 'purpose', maximum: TEAM_ROLE_WHEN_TO_USE_MAX_CHARS },
    { field: 'done', maximum: TEAM_ROLE_WHEN_TO_USE_MAX_CHARS },
    { field: 'guidance', maximum: AGENT_FILE_MAX_BYTES },
  ])('bounds canonical saved $field text', ({ field, maximum }) => {
    const snapshot = (length: number) => ({
      intensity: 'minimal',
      roles: [{ role: 'custom', pool: [], [field]: 'x'.repeat(length) }],
    })
    expect(teamSnapshotSchema.safeParse(snapshot(maximum)).success).toBe(true)
    expect(teamSnapshotSchema.safeParse(snapshot(maximum + 1)).success).toBe(false)
  })

  it.each(['../escape', 'Uppercase', 'bad role', 'nested/role'])(
    'rejects a noncanonical saved role id %s',
    (role) => {
      expect(
        teamSnapshotSchema.safeParse({ intensity: 'minimal', roles: [{ role, pool: [] }] }).success,
      ).toBe(false)
    },
  )
})

describe('canonical Roles storage', () => {
  it('reset preserves the saved roles and never resurrects the obsolete override key', async () => {
    const roles = [
      { role: 'my-role', purpose: 'Saved purpose', guidance: 'Saved guidance', pool: [] },
    ]
    const state = memoryState({
      roles,
      intensity: 'balanced',
      orchestratorModel: 'model',
      orchestrator: {
        agent: { kind: 'museCode', agentId: 'subscription', model: 'model', pays: 'subscription' },
      },
    })
    await state.update('museSpark.team.orchestrator', { modelId: 'obsolete', backend: 'modelApi' })
    expect(readOrchestratorOverride(state)).toEqual({ modelId: 'model', backend: 'musecode' })
    await resetOrchestratorSlot(state)
    expect(state.get(TEAM_WORKSPACE_KEYS.team)).toEqual({ roles, intensity: 'balanced' })
    expect(readOrchestratorOverride(state)).toBeUndefined()
  })
  it('refuses an external orchestrator instead of silently changing backend', () => {
    const state = memoryState({
      roles: [],
      intensity: 'minimal',
      orchestrator: { agent: { kind: 'external', agentId: 'cli', model: 'model', pays: 'key' } },
    })
    expect(readOrchestratorOverride(state)).toBeUndefined()
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
