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
  validateOrchestratorSettings,
} from '../../src/core/team/orchestratorSlot'
import { teamSettingCapabilities } from '../../src/core/team/modelSettings'
import { metaCapabilityRecord } from '../../src/core/providers/capabilityRecord'

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

describe('validateOrchestratorSettings', () => {
  it('accepts a served effort and cap', () => {
    expect(
      validateOrchestratorSettings({ effort: 'low', outputCap: 128 }, 'muse-spark-1.3'),
    ).toBeUndefined()
  })
  it('refuses a setting no conversation path applies, with its reason', () => {
    expect(validateOrchestratorSettings({ temperature: 0.5 }, 'muse-spark-1.3')).toMatch(
      /temperature.*0\.5.*muse-spark-1\.3/,
    )
  })
  it('refuses an effort the model family does not serve, never remapping it', () => {
    // muse-spark-1.2 serves up to xhigh: max refuses instead of becoming none.
    expect(validateOrchestratorSettings({ effort: 'max' }, 'muse-spark-1.2')).toMatch(
      /effort.*max.*muse-spark-1\.2/,
    )
  })
  it('refuses an empty effort and a malformed cap', () => {
    expect(validateOrchestratorSettings({ effort: '' }, 'muse-spark-1.3')).toMatch(/effort/)
    expect(validateOrchestratorSettings({ outputCap: 0 }, 'muse-spark-1.3')).toMatch(/outputCap/)
  })
  it('leaves an unknown family to the live session check', () => {
    expect(validateOrchestratorSettings({ effort: 'turbo' }, 'other-model')).toBeUndefined()
  })
  // P2-5: saved settings are validated against the model's current
  // capability record before anything is allocated.
  it('refuses a cap above the model maximum from its current record, never clamping', () => {
    const caps = teamSettingCapabilities(metaCapabilityRecord('muse-spark-1.2'))
    expect(
      validateOrchestratorSettings({ outputCap: Number.MAX_SAFE_INTEGER }, 'muse-spark-1.2', caps),
    ).toMatch(/outputCap.*muse-spark-1\.2/)
    expect(
      validateOrchestratorSettings({ outputCap: 131_072 }, 'muse-spark-1.2', caps),
    ).toBeUndefined()
  })
  it('refuses a changed effort capability from the current record, qualified ids included', () => {
    const caps = { effortTiers: ['low'] as const, maxOutputTokens: 1000 }
    expect(validateOrchestratorSettings({ effort: 'high' }, 'openai/gpt-x', caps)).toMatch(
      /effort.*high.*openai\/gpt-x/,
    )
    expect(validateOrchestratorSettings({ effort: 'low' }, 'openai/gpt-x', caps)).toBeUndefined()
    // Unknown halves stay lenient: the session re-checks live tiers at apply.
    expect(
      validateOrchestratorSettings({ effort: 'turbo' }, 'openai/gpt-x', {
        effortTiers: undefined,
        maxOutputTokens: undefined,
      }),
    ).toBeUndefined()
  })
})
