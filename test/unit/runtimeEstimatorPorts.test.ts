// M117 W: the ACP agent's headless estimator bindings refuse the unmerged
// milestone bindings with their handoff names, serve the local fleet, keep
// price lookups off, and answer `/estimate --help` without loading the engine.
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dags from '../fixtures/estimator/dags.json'
import { estimateLaneSchema, fleetSnapshotSchema } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { createRuntimeEstimate, runtimeEstimatorPorts } from '../../src/runtime/estimator/ports'

function lanes() {
  const chain = dags.find((fixture) => fixture.name === 'chain')
  if (chain === undefined) throw new Error('missing chain fixture')
  return chain.lanes.map((input, index) =>
    estimateLaneSchema.parse({
      ...input,
      id: `M117:${input.id}`,
      kind: index === 0 ? 'contracts' : input.kind,
      dependencies: input.dependencies.map((id) => `M117:${id}`),
    }),
  )
}

const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
  vi.clearAllMocks()
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('M117 headless estimator bindings', () => {
  it('refuses the unmerged milestone bindings with their handoff names', () => {
    const ports = runtimeEstimatorPorts()
    expect(() => ports.snapshot({ kind: 'milestone', milestoneId: 'M117' }, '')).toThrow(
      'M117-W-M113-plan-reader',
    )
    expect(() => ports.board().audit(['M117:A'])).toThrow('M117-W-M96-board')
    expect(() => ports.board().start(['M117:A'])).toThrow('M117-W-M96-board')
    expect(() => ports.prices().cached('https://provider.invalid/rates')).toThrow(
      'M117-W-M113-catalog',
    )
  })
  it('serves the local fleet and keeps price lookups off', async () => {
    const ports = runtimeEstimatorPorts()
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
