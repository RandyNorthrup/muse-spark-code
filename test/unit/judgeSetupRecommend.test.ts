// M125 lane H: the recommender. The shipped table recommends nothing
// anywhere yet (no verified-path timings — the honest fail-closed);
// constructed rows prove the pick rule: verified only, digest and
// room required, most accurate first with faster breaking ties, a
// speed-only last resort, classes exactly eligible's, and reasons in
// plain words.
import { beforeEach, describe, expect, it } from 'vitest'
import type { JudgeGpuBackend } from '../../src/core/judge/hardware/types'
import { recommendJudgeModel } from '../../src/core/judge/setup/recommend'
import { loadJudgeModelsTable } from '../../src/core/judge/setup/table'
import type {
  JudgeModelLatency,
  JudgeModelRow,
  JudgeModelsTable,
} from '../../src/shared/judgeModels/schema'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { descriptorByName } from './helpers/judgeHardware/descriptors'
import { DIGEST, GIB, judgeRow, SHIPPED_TABLE } from './helpers/judgeSetupWorld'

function latency(
  backend: JudgeGpuBackend,
  platform: 'linux' | 'darwin' | 'win32',
  p50Ms: number,
  p95Ms: number,
  path: 'verified' | 'raw' = 'verified',
): JudgeModelLatency {
  return { backend, platform, p50Ms, p95Ms, path, source: 'test' }
}

/** A row with no timings unless the case gives its own. */
function row(model: string, overrides: Partial<JudgeModelRow> = {}): JudgeModelRow {
  return judgeRow(model, { latency: [], ...overrides })
}

function table(rows: JudgeModelRow[]): Pick<JudgeModelsTable, 'rows'> {
  return { rows }
}

describe('setup recommender', () => {
  beforeEach(() => {
    setUiText(EN, 'en')
  })

  it('recommends nothing from the shipped table: no verified timings anywhere', () => {
    const loaded = loadJudgeModelsTable(SHIPPED_TABLE, '2026-10-22')
    if (loaded.table === undefined) throw new Error('shipped table failed to load')
    for (const name of ['noGpu16GB', 'nvidia8GB', 'appleSilicon', 'tooSmall']) {
      const recommendation = recommendJudgeModel(descriptorByName(name), loaded.table)
      expect(recommendation.model).toBeUndefined()
      expect(recommendation.fitting).toEqual([])
      expect(recommendation.servesSpeedOnly).toBe(false)
      expect(recommendation.reasons).toContain(
        'Nothing to recommend yet: no model has verified timings on this computer.',
      )
    }
  })

  it('picks the most accurate verified row that fits, faster on ties', () => {
    const summary = descriptorByName('noGpu16GB')
    const accurate = row('accurate:test', {
      accuracy: { correct: 39, total: 40, source: 'test' },
      latency: [latency('cpu', 'linux', 300, 356)],
    })
    const weaker = row('weaker:test', {
      accuracy: { correct: 30, total: 40, source: 'test' },
      latency: [latency('cpu', 'linux', 100, 120)],
    })
    const tied = row('tied:test', {
      accuracy: { correct: 39, total: 40, source: 'test' },
      latency: [latency('cpu', 'linux', 100, 120)],
    })
    const pick = recommendJudgeModel(summary, table([accurate, weaker, tied]))
    expect(pick.model).toBe('tied:test')
    expect(pick.digest).toBe(DIGEST)
    expect(pick.backend).toBe('cpu')
    expect(pick.p95Ms).toBe(120)
    expect(pick.fitting).toEqual(['tied:test', 'accurate:test', 'weaker:test'])
    expect(pick.servesSpeedOnly).toBe(false)
    expect(pick.reasons).toContain('Recommended: tied:test (4.5 GB).')
  })

  it('uses a verified row only on its own backend and platform', () => {
    const cudaOnly = row('cuda:test', {
      latency: [latency('cuda', 'linux', 300, 356)],
    })
    const cpu = recommendJudgeModel(descriptorByName('noGpu16GB'), table([cudaOnly]))
    expect(cpu.model).toBeUndefined()
    const gpu = recommendJudgeModel(descriptorByName('nvidia8GB'), table([cudaOnly]))
    expect(gpu.model).toBe('cuda:test')
    expect(gpu.reasons).toContain("It fits in your GPU's memory.")
    const mac = recommendJudgeModel(descriptorByName('appleSilicon'), table([cudaOnly]))
    expect(mac.model).toBeUndefined()
    const metal = row('metal:test', {
      latency: [latency('metal', 'darwin', 100, 120)],
    })
    const linuxSeesNothing = recommendJudgeModel(descriptorByName('nvidia8GB'), table([metal]))
    expect(linuxSeesNothing.model).toBeUndefined()
    const macPicksMetal = recommendJudgeModel(descriptorByName('appleSilicon'), table([metal]))
    expect(macPicksMetal.model).toBe('metal:test')
    expect(macPicksMetal.backend).toBe('metal')
  })

  it('ignores raw-path timings even when everything else fits', () => {
    const summary = descriptorByName('noGpu16GB')
    const raw = row('raw:test', { latency: [latency('cpu', 'linux', 100, 120, 'raw')] })
    const pick = recommendJudgeModel(summary, table([raw]))
    expect(pick.model).toBeUndefined()
    expect(pick.fitting).toEqual([])
    expect(pick.reasons).toContain(
      'Nothing to recommend yet: no model has verified timings on this computer.',
    )
  })

  it('requires a digest, a resident size, RAM headroom and disk room', () => {
    const summary = descriptorByName('noGpu16GB')
    const base = {
      latency: [latency('cpu', 'linux', 300, 356)],
    }
    const cases: { name: string; overrides: Partial<JudgeModelRow> }[] = [
      { name: 'no-digest', overrides: { digest: undefined } },
      { name: 'no-resident', overrides: { residentBytesCpu: undefined } },
      { name: 'too-big-ram', overrides: { residentBytesCpu: 15 * GIB } },
      { name: 'too-big-disk', overrides: { downloadBytes: 500 * GIB } },
    ]
    for (const { overrides } of cases) {
      expect(
        recommendJudgeModel(summary, table([row('x:test', { ...base, ...overrides })])).model,
      ).toBeUndefined()
    }
    // Exactly resident plus the 2 GiB headroom fits; one byte more does not.
    const exact = row('exact:test', { ...base, residentBytesCpu: 14 * GIB })
    expect(recommendJudgeModel(summary, table([exact])).model).toBe('exact:test')
    const over = row('over:test', { ...base, residentBytesCpu: 14 * GIB + 1 })
    expect(recommendJudgeModel(summary, table([over])).model).toBeUndefined()
    // Unknown disk never fits.
    const unknownDisk = { ...summary, diskFreeBytes: undefined }
    expect(recommendJudgeModel(unknownDisk, table([row('d:test', base)])).model).toBeUndefined()
  })

  it('holds calibration-gated rows until a profile lands, and says so', () => {
    const summary = descriptorByName('nvidia8GB')
    const gated = row('gated:test', {
      technique: 'logprob',
      requiresCalibration: true,
      latency: [latency('cuda', 'linux', 100, 137)],
    })
    const held = recommendJudgeModel(summary, table([gated]))
    expect(held.model).toBeUndefined()
    expect(held.reasons).toContain(
      'No local judge is ready yet: the fitting models still need calibration.',
    )
    const profiled = row('gated:test', {
      technique: 'logprob',
      requiresCalibration: true,
      profiledFamilies: ['risk.destructive'],
      latency: [latency('cuda', 'linux', 100, 137)],
    })
    const picked = recommendJudgeModel(summary, table([profiled]))
    expect(picked.model).toBe('gated:test')
    expect(picked.reasons).toContain('Calibrated for: risk.destructive.')
  })

  it('falls back to a speed-only row only when no full row fits', () => {
    const summary = descriptorByName('noGpu8GB')
    const small = row('small:test', {
      speedOnly: true,
      downloadBytes: 1 * GIB,
      residentBytesCpu: 1 * GIB,
      accuracy: { correct: 30, total: 40, source: 'test' },
      latency: [latency('cpu', 'linux', 600, 830)],
    })
    const alone = recommendJudgeModel(summary, table([small]))
    expect(alone.model).toBe('small:test')
    expect(alone.servesSpeedOnly).toBe(true)
    expect(alone.reasons).toContain(
      'A smaller model, lower quality: speed decisions only, never destructive-command review or vetoes.',
    )
    const full = row('full:test', {
      downloadBytes: 5 * GIB,
      residentBytesCpu: 5 * GIB,
      accuracy: { correct: 39, total: 40, source: 'test' },
      latency: [latency('cpu', 'linux', 300, 356)],
    })
    // 5 GiB + 2 GiB headroom fits 8 GiB: the full row wins.
    const together = recommendJudgeModel(summary, table([small, full]))
    expect(together.model).toBe('full:test')
    expect(together.servesSpeedOnly).toBe(false)
    expect(together.fitting).toEqual(['full:test', 'small:test'])
  })

  it('names exactly the classes the p95 admits, on and off', () => {
    const summary = descriptorByName('noGpu16GB')
    const fast = row('fast:test', { latency: [latency('cpu', 'linux', 100, 200)] })
    const fastPick = recommendJudgeModel(summary, table([fast]))
    expect(fastPick.classes).toEqual(['I', 'S', 'B', 'P'])
    expect(fastPick.reasons).toContain(
      'Fast enough for: decisions before each request, decisions while you type, decisions while the model works, and checks on each reply.',
    )
    expect(fastPick.reasons.some((reason) => reason.startsWith('Not fast enough'))).toBe(false)
    const slow = row('slow:test', { latency: [latency('cpu', 'linux', 3000, 4000)] })
    const slowPick = recommendJudgeModel(summary, table([slow]))
    expect(slowPick.classes).toEqual(['S', 'P'])
    expect(slowPick.reasons).toContain(
      'Fast enough for: decisions while you type and checks on each reply.',
    )
    expect(slowPick.reasons).toContain(
      'Not fast enough for: decisions before each request and decisions while the model works.',
    )
    const tooSlow = row('too-slow:test', { latency: [latency('cpu', 'linux', 5000, 6000)] })
    expect(recommendJudgeModel(summary, table([tooSlow])).model).toBeUndefined()
  })

  it('judges CPU-only options on request and explains a missing GPU', () => {
    const cpuRow = row('cpu:test', { latency: [latency('cpu', 'linux', 300, 356)] })
    const forced = recommendJudgeModel(descriptorByName('nvidia8GB'), table([cpuRow]), {
      cpuOnly: true,
    })
    expect(forced.model).toBe('cpu:test')
    expect(forced.backend).toBe('cpu')
    expect(forced.reasons).toContain('It fits in memory with room to spare.')
    expect(forced.reasons).not.toContain('No usable GPU was found; judging CPU-only options.')
    const plain = recommendJudgeModel(descriptorByName('noGpu16GB'), table([cpuRow]))
    expect(plain.reasons[0]).toBe('No usable GPU was found; judging CPU-only options.')
  })

  it('covers the remaining classes: too small, old driver, ROCm without rows', () => {
    const cpuRow = row('cpu:test', { latency: [latency('cpu', 'linux', 300, 356)] })
    const small = recommendJudgeModel(descriptorByName('tooSmall'), table([cpuRow]))
    expect(small.model).toBeUndefined()
    expect(small.reasons).toContain(
      'No local judge fits this computer: nothing fast enough fits in memory and on disk.',
    )
    const driver = recommendJudgeModel(descriptorByName('oldDriver'), table([cpuRow]))
    expect(driver.model).toBe('cpu:test')
    expect(driver.reasons[0]).toBe('No usable GPU was found; judging CPU-only options.')
    const rocm = recommendJudgeModel(descriptorByName('amdRocm'), table([cpuRow]))
    expect(rocm.model).toBeUndefined()
    expect(rocm.reasons).toContain(
      'Nothing to recommend yet: no model has verified timings on this computer.',
    )
  })

  it('reports the worst verified p95 and the uncalibrated default', () => {
    const summary = descriptorByName('noGpu16GB')
    const repeated = row('repeated:test', {
      latency: [latency('cpu', 'linux', 100, 200), latency('cpu', 'linux', 300, 400)],
    })
    const pick = recommendJudgeModel(summary, table([repeated]))
    expect(pick.p95Ms).toBe(400)
    expect(pick.reasons).toContain('Should answer in about 0.4s at worst.')
    expect(pick.reasons).toContain('Checks on replies stay off until it is calibrated for them.')
  })
})
