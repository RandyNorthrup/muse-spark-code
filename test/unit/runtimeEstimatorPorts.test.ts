// M117 W, C-M117-1: the ACP agent's headless estimator bindings read plan
// snapshots through the shared core adapter, refuse the still-unmerged
// milestone bindings with their handoff names, serve the local fleet, keep
// price lookups off, and answer `/estimate --help` without loading the engine.
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { createRuntimeEstimate, runtimeEstimatorPorts } from '../../src/runtime/estimator/ports'
import { chainLanes } from './helpers/estimator/fixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'

function rejectedSnapshot(): Promise<never> {
  return Promise.reject(new Error('Goal not found: M999'))
}

function stubSnapshotSource(): () => Promise<never> {
  return rejectedSnapshot
}

function workingSnapshotBundle(): unknown {
  return { createPlanSnapshotSource: stubSnapshotSource }
}

function missingSnapshotBundle(): unknown {
  throw new Error('missing')
}

function neverSnapshotBundle(): unknown {
  throw new Error('snapshot must stay on disk for this test')
}

function portsWithoutSnapshot() {
  return runtimeEstimatorPorts({
    snapshotBundlePath: 'dist/planSnapshot.js',
    log,
    loadBundle: neverSnapshotBundle,
  })
}

const lanes = chainLanes

const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
  vi.clearAllMocks()
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M117 headless estimator bindings', () => {
  it('reads the snapshot from the plan instead of the plan-reader handoff', async () => {
    // The loader's module is handed in: the bundle itself stays out of the test.
    const ports = runtimeEstimatorPorts({
      snapshotBundlePath: 'dist/planSnapshot.js',
      log,
      loadBundle: workingSnapshotBundle,
    })
    // The adapter runs and reports the unknown goal instead of refusing with
    // the retired handoff name.
    await expect(
      ports.snapshot({ kind: 'milestone', milestoneId: 'M999' }, ESTIMATOR_AS_OF),
    ).rejects.toThrow(/Goal not found/)
    expect(log.error).not.toHaveBeenCalled()
  })
  it('refuses estimateUnavailable when the snapshot bundle is missing', async () => {
    const ports = runtimeEstimatorPorts({
      snapshotBundlePath: 'dist/planSnapshot.js',
      log,
      loadBundle: missingSnapshotBundle,
    })
    await expect(
      ports.snapshot({ kind: 'milestone', milestoneId: 'M999' }, ESTIMATOR_AS_OF),
    ).rejects.toThrow(UI_TEXT.estimateUnavailable)
  })
  it('refuses the unmerged milestone bindings with their handoff names', () => {
    const ports = portsWithoutSnapshot()
    expect(() => ports.board().audit(['M117:A'])).toThrow('M117-W-M96-board')
    expect(() => ports.board().start(['M117:A'])).toThrow('M117-W-M96-board')
    expect(() => ports.prices().cached('https://provider.invalid/rates')).toThrow(
      'M117-W-M113-catalog',
    )
  })
  it('serves the local fleet and keeps price lookups off', async () => {
    const ports = portsWithoutSnapshot()
    const fleet = fleetSnapshotSchema.parse(await ports.fleet(lanes()))
    expect(fleet.machines.length).toBeGreaterThan(0)
    expect(fleet.accounts.map((account) => account.id)).toContain('local')
    expect(
      fleetSnapshotSchema.parse(await ports.candidatePool(lanes())).machines.length,
    ).toBeGreaterThan(0)
    expect(await ports.history()).toEqual([])
    expect(ports.priceLookup()).toMatchObject({ enabled: false, networkAllowed: false })
  })
  it('answers --help without loading the engine', async () => {
    const loadBundle = vi.fn(() => {
      throw new Error('engine must stay on disk for --help')
    })
    const estimate = createRuntimeEstimate({ bundlePath: 'estimator.js', log, loadBundle })
    const text = await estimate.run('/estimate --help', process.cwd(), new AbortController().signal)
    expect(text).toBe(`${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`)
    expect(loadBundle).not.toHaveBeenCalled()
  })
  it('refuses honestly when the engine cannot load', async () => {
    const estimate = createRuntimeEstimate({
      bundlePath: 'estimator.js',
      log,
      loadBundle: () => {
        throw new Error('no engine on disk')
      },
    })
    await expect(
      estimate.run('/estimate m117', process.cwd(), new AbortController().signal),
    ).resolves.toBe(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
    expect(log.error).toHaveBeenCalled()
  })
})
