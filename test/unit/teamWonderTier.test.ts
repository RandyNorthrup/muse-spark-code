// A Wonder-tier id as a Muse Code team model (RLF-WONDER, rvint9 P3):
// `modelApiPaidTier('muse-wonder-1.0')` is `'wonder'`, its verified Model
// API tariff, not the standard Muse Code tier. The team registry must
// not offer it as a standard subscription model, and a pool that names it
// is refused in words before either Muse Code-backed worker starts, so
// no request is sent at an unknown billed tier. On the Model API backend
// the same id stays offered, at the Wonder rates, never the standard ones.
import { describe, expect, it } from 'vitest'
import { recordedMuseCodeModels } from './helpers/recordedMuseCodeModels'
import { metaCapabilityRecord } from '../../src/core/providers/capabilityRecord'
import { buildTeamModelOffers } from '../../src/core/team/teamModelRegistry'
import { ACP_PRESETS } from '../../src/core/team/workers/acpWorker'
import { buildWorkerSessionConfig } from '../../src/core/team/workers/museCodeWorker'
import { acpSpawnArgs, WORKER_NATIVE_IO } from '../../src/core/team/workers/workerFence'
import { MODEL_API_PRICES_PER_MILLION } from '../../src/shared/constants'
import { modelApiPaidTier } from '../../src/shared/paidBoundary'
import { isWonderTierModel } from '../../src/shared/wonderTier'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

setUiText(EN, 'en')

const WONDER = 'muse-wonder-1.0'

const registryInput = { engine: [], limits: [], maxWorkers: 2, canRunKind: () => true }

describe('a Wonder-tier id in the team registry', () => {
  it('is exactly the ids whose verified tariff tier is wonder', () => {
    expect(modelApiPaidTier(WONDER)).toBe('wonder')
    expect(isWonderTierModel(WONDER)).toBe(true)
    expect(isWonderTierModel('muse-spark-1.3')).toBe(false)
    expect(isWonderTierModel('muse-wonder-full-1.0')).toBe(false)
    expect(isWonderTierModel('muse-wonder-1.0-contributor')).toBe(false)
  })
  it('is not offered as a standard Muse Code model, and its absence names the tier', () => {
    const result = buildTeamModelOffers({ ...registryInput, museCode: recordedMuseCodeModels() })
    expect(result.offers.map((offer) => offer.ref)).not.toContain(`museCode:${WONDER}`)
    expect(result.absent).toContainEqual({ provider: 'museCode', reason: 'wonderTier' })
    // The standard Spark models the CLI serves are offered unchanged.
    expect(result.offers.map((offer) => offer.ref)).toContain('museCode:muse-spark-1.3')
    expect(result.offers.map((offer) => offer.ref)).toContain('museCode:muse-spark-1.2')
  })

  it('is offered on the Model API backend at the Wonder rates, never the standard ones', () => {
    const record = metaCapabilityRecord('muse-spark-1.3')
    const result = buildTeamModelOffers({
      ...registryInput,
      museCode: [],
      engine: [
        {
          model: {
            modelId: WONDER,
            providerId: 'meta',
            displayLabel: WONDER,
            isDefault: false,
            isActive: false,
            contextLimit: undefined,
          },
          record,
          preset: 'meta',
        },
      ],
    })
    expect(result.offers).toHaveLength(1)
    expect(result.offers[0]).toMatchObject({
      ref: `engine:${WONDER}`,
      inputRate: Number(MODEL_API_PRICES_PER_MILLION.wonder.input),
      outputRate: Number(MODEL_API_PRICES_PER_MILLION.wonder.output),
    })
  })
})

describe('a pool that names a Wonder-tier id', () => {
  it('is refused in words before an ACP worker spawns, naming the model', () => {
    for (const preset of [ACP_PRESETS.own, ACP_PRESETS.gemini, ACP_PRESETS.claude])
      expect(() => acpSpawnArgs({ preset, modelId: WONDER })).toThrow(WONDER)
  })

  it('still spawns for the standard and contributor Muse Code models', () => {
    expect(acpSpawnArgs({ preset: ACP_PRESETS.own, modelId: 'muse-wonder-full-1.0' })).toEqual([
      '--no-user-mcp-servers',
    ])
    expect(acpSpawnArgs({ preset: ACP_PRESETS.own, modelId: 'muse-spark-1.3' })).toEqual([
      '--no-user-mcp-servers',
    ])
    expect(
      acpSpawnArgs({ preset: ACP_PRESETS.own, modelId: 'muse-wonder-1.0-contributor' }),
    ).toEqual(['--no-user-mcp-servers', '--allow-contributor-models'])
  })

  it('is refused in words before a Muse Code worker session is built', async () => {
    await expect(
      buildWorkerSessionConfig({
        task: {
          taskId: 'wonder-task',
          roleId: 'engineering',
          brief: 'Check the tier.',
          branch: 'agents/engineering/wonder-task',
          folder: '/wonder-copy',
          files: [],
        },
        role: {
          roleId: 'engineering',
          workspaceMode: 'own-branch',
          toolGroups: ['read'],
          reportShape: 'summary',
        },
        modelId: WONDER,
        workspaceRoot: '/wonder-workspace',
        platform: process.platform,
        io: WORKER_NATIVE_IO,
        exclusiveUserServers: [],
        bridgeServers: {},
      }),
    ).rejects.toThrow(WONDER)
  })
})
