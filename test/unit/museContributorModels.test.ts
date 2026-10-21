// Contributor-tier models on the Muse Code backend. The CLI's `model/list`
// never serves a contributor row (recorded 2026-10-18 on 1.4.10,
// test/fixtures/muse-contributor/provenance.json), while `session/start`
// accepts `<base>-contributor` by name for every listed base — so the host
// derives each counterpart from the served reading while its `serve` runs
// with `--contributor-mode on`. The provider, not the product, decides
// whether the person may use one.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  contributorModelSummaries,
  modelListResultSchema,
  toContributorSummary,
  toModelSummary,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { workerServeArgs } from '../../src/core/team/workers/museCodeWorker'

function recordedModels() {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/muse-contributor/model-list-1.4.10.json', import.meta.url),
      'utf8',
    ),
  )
  return modelListResultSchema.parse(raw).models.map((row) => toModelSummary(row))
}

describe('contributorModelSummaries', () => {
  it('derives one -contributor counterpart per served base, carrying its limits', () => {
    const base = recordedModels()
    expect(base.map((model) => model.modelId)).toEqual([
      'muse-wonder-1.0',
      'muse-wonder-full-1.0',
      'muse-spark-1.3',
      'muse-spark-1.2',
    ])
    const derived = contributorModelSummaries(base)
    expect(derived.map((model) => model.modelId)).toEqual([
      'muse-wonder-1.0-contributor',
      'muse-wonder-full-1.0-contributor',
      'muse-spark-1.3-contributor',
      'muse-spark-1.2-contributor',
    ])
    for (const model of derived) {
      const own = base.find((candidate) => model.modelId === `${candidate.modelId}-contributor`)!
      expect(model.displayLabel).toBe(model.modelId)
      expect(model.contextLimit).toBe(own.contextLimit)
      expect(model.outputLimit).toBe(own.outputLimit)
      expect(model.isDefault).toBe(false)
      expect(model.isActive).toBe(false)
    }
  })

  it('carries the base effort support onto the counterpart', () => {
    const summary = toContributorSummary({
      modelId: 'muse-spark-1.3',
      displayLabel: 'muse-spark-1.3',
      contextLimit: 1_007_997,
      outputLimit: 128_000,
      isDefault: false,
      isActive: true,
      variants: ['minimal', 'low'],
      defaultReasoningEffort: 'high',
    })
    expect(summary.modelId).toBe('muse-spark-1.3-contributor')
    expect(summary.variants).toEqual(['minimal', 'low'])
    expect(summary.defaultReasoningEffort).toBe('high')
  })

  it('never doubles a tier the catalogue already serves', () => {
    const base = recordedModels()
    const withServed = [...base, toContributorSummary(base[2]!)]
    expect(contributorModelSummaries(withServed).map((model) => model.modelId)).toEqual([
      'muse-wonder-1.0-contributor',
      'muse-wonder-full-1.0-contributor',
      'muse-spark-1.2-contributor',
    ])
  })
})

describe('workerServeArgs contributor mode', () => {
  it('adds the per-process override only while the person enabled it', () => {
    expect(workerServeArgs('team', true, true)).toEqual([
      'serve',
      '--contributor-mode',
      'on',
      '--trust-workspace',
    ])
    expect(workerServeArgs('team', true)).toEqual(['serve', '--trust-workspace'])
    expect(workerServeArgs('team', true, false)).toEqual(['serve', '--trust-workspace'])
  })
})
