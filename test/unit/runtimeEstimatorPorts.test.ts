// M117 W, C-M117-1: the ACP agent's headless estimator bindings read plan
// snapshots through the shared core adapter from the requesting session's
// workspace root (one cached estimator per root, never the process working
// directory), refuse the still-unmerged milestone bindings with their handoff
// names, serve the local fleet stamped with the request's asOf, keep price
// lookups and networked reads off, install the caller's language table in
// the snapshot bundle, and answer `/estimate --help` without loading the
// engine. Repository default timeout; no skips.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fleetSnapshotSchema, type FleetSnapshot } from '../../src/shared/estimate'
import {
  RESOURCE_CPU_DEFAULT_PERCENT,
  RESOURCE_MEMORY_DEFAULT_PERCENT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import {
  createRuntimeEstimate,
  runRuntimeEstimateCommand,
  runtimeEstimatorPorts,
} from '../../src/runtime/estimator/ports'
import { chainLanes } from './helpers/estimator/fixtures'
import { ESTIMATOR_AS_OF } from './helpers/estimator/fakes'

function rejectedSnapshot(): Promise<never> {
  return Promise.reject(new Error('Goal not found: M999'))
}

function workingSnapshotBundle(): unknown {
  return {
    installPlanSnapshotText: () => undefined,
    createPlanSnapshotSource: () => rejectedSnapshot,
  }
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
    root: '/workspace',
    machineDir: '/workspace',
    accounts: { list: () => Promise.resolve([]) },
    loadBundle: neverSnapshotBundle,
  })
}

// The composition engine: the real fleet behind a trivially valid section,
// so the forecasts below prove the owners (not the engine) moved the rows.
function fleetEchoEngine() {
  return {
    createEstimatorRun: (ports: { fleet(lanes: readonly [], asOf: string): Promise<unknown> }) => ({
      estimate: async (request: { asOf: string }) => ({
        kind: 'estimate',
        schemaVersion: 1,
        asOf: request.asOf,
        p50: request.asOf,
        p90: request.asOf,
        seed: 'fleet-echo',
        runs: 1,
        schedule: [],
        criticalPath: [],
        limitingResource: {
          kind: 'criticalPath',
          hoursSavedIfUnbounded: 0,
          moreAgentsHelp: false,
        },
        setups: [],
        inputs: { request, lanes: [], fleet: await ports.fleet([], request.asOf), history: [] },
        disclosures: [],
        calibration: [],
      }),
      startWave: () => Promise.resolve([]),
      price: () => '',
      provisionWaiting: '',
    }),
  }
}

function scratchDir(prefix: string): string {
  // Lane scratch lives under TMPDIR; the fallback keeps Windows CI green.
  return mkdtempSync(path.join(process.env['TMPDIR'] ?? tmpdir(), prefix))
}

/** The fleet out of a composition run's JSON section, narrowed without casts. */
function sectionFleet(out: string): FleetSnapshot {
  const body: unknown = JSON.parse(out)
  if (typeof body !== 'object' || body === null || !('inputs' in body))
    throw new Error('composition run returned no section')
  const inputs: unknown = body.inputs
  if (typeof inputs !== 'object' || inputs === null || !('fleet' in inputs))
    throw new Error('composition run returned no fleet')
  return fleetSnapshotSchema.parse(inputs.fleet)
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
      root: '/workspace',
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
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
      root: '/workspace',
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
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
  it('serves the local fleet stamped with the request asOf and keeps price lookups off', async () => {
    const ports = portsWithoutSnapshot()
    const fleet = fleetSnapshotSchema.parse(await ports.fleet(lanes(), ESTIMATOR_AS_OF))
    expect(fleet.asOf).toBe(ESTIMATOR_AS_OF)
    expect(fleet.machines.length).toBeGreaterThan(0)
    expect(fleet.accounts.map((account) => account.id)).toContain('local')
    expect(
      fleetSnapshotSchema.parse(await ports.candidatePool(lanes(), ESTIMATOR_AS_OF)).machines
        .length,
    ).toBeGreaterThan(0)
    expect(await ports.history()).toEqual([])
    expect(ports.priceLookup()).toMatchObject({ enabled: false, networkAllowed: false })
  })
  it('answers --help without loading the engine', async () => {
    const loadBundle = vi.fn(() => {
      throw new Error('engine must stay on disk for --help')
    })
    const estimate = createRuntimeEstimate({
      bundlePath: 'estimator.js',
      log,
      loadBundle,
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
    })
    const text = await estimate.run('/estimate --help', process.cwd(), new AbortController().signal)
    expect(text).toBe(`${UI_TEXT.estimateUsage}\n${UI_TEXT.estimateCliHelp}`)
    expect(loadBundle).not.toHaveBeenCalled()
  })
  it('refuses honestly when the engine cannot load', async () => {
    const estimate = createRuntimeEstimate({
      bundlePath: 'estimator.js',
      log,
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
      loadBundle: () => {
        throw new Error('no engine on disk')
      },
    })
    await expect(
      estimate.run('/estimate m117', process.cwd(), new AbortController().signal),
    ).resolves.toBe(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
    expect(log.error).toHaveBeenCalled()
  })
  it("reads each requesting session's root and caches one estimator per root", async () => {
    const loaded: string[] = []
    const created: string[] = []
    const roots: string[] = []
    const outcomes: string[] = []
    const estimate = createRuntimeEstimate({
      bundlePath: 'estimator.js',
      log,
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
      loadBundle: (file: string) => {
        loaded.push(file)
        if (file.endsWith('planSnapshot.js')) {
          return {
            installPlanSnapshotText: () => undefined,
            createPlanSnapshotSource: (options: { root: string }) => {
              created.push(options.root)
              return () => {
                roots.push(options.root)
                return Promise.reject(new Error('Goal not found: M112'))
              }
            },
          }
        }
        return {
          createEstimatorRun: (ports: {
            snapshot: (goal: unknown, asOf: string) => Promise<unknown>
          }) => ({
            estimate: async (request: { goal: unknown; asOf: string }) => {
              try {
                await ports.snapshot(request.goal, request.asOf)
                outcomes.push('resolved')
              } catch {
                outcomes.push('rejected')
              }
              throw new Error('stop after the snapshot')
            },
            startWave: () => Promise.resolve([]),
            price: () => '',
            provisionWaiting: '',
          }),
        }
      },
    })
    const signal = new AbortController().signal
    // Each estimate fails past its snapshot, but the snapshot read the
    // requesting session's root, never the process working directory.
    await estimate.run('/estimate M112', '/sessions/editor-a', signal)
    await estimate.run('/estimate M112', '/sessions/editor-b', signal)
    expect(roots).toEqual(['/sessions/editor-a', '/sessions/editor-b'])
    expect(outcomes).toEqual(['rejected', 'rejected'])
    expect(loaded.filter((file) => file === 'estimator.js')).toHaveLength(2)
    // The first root's estimator is reused, not rebuilt: no new bundle
    // load, no new snapshot source, but the estimate still reads its root.
    await estimate.run('/estimate M112', '/sessions/editor-a', signal)
    expect(roots).toEqual(['/sessions/editor-a', '/sessions/editor-b', '/sessions/editor-a'])
    expect(created).toEqual(['/sessions/editor-a', '/sessions/editor-b'])
    expect(loaded.filter((file) => file === 'estimator.js')).toHaveLength(2)
  })
  it('estimates through the CLI owners: resources.json and the registry', async () => {
    const folder = scratchDir('cm1173-cli-')
    try {
      const accounts = { list: () => Promise.resolve([{ id: 'shop' }]) }
      const runCli = async (argv: readonly string[]) => {
        let out = ''
        let err = ''
        const code = await runRuntimeEstimateCommand(argv, {
          bundlePath: 'estimator.js',
          log,
          write: (text) => {
            out += text
          },
          error: (text) => {
            err += text
          },
          machineDir: folder,
          accounts,
          loadBundle: () => fleetEchoEngine(),
        })
        return { code, out, err }
      }
      // A missing file carries the schema defaults the governor itself runs.
      const missing = await runCli(['M999', '--format', 'json'])
      expect(missing.code).toBe(0)
      const missingFleet = sectionFleet(missing.out)
      expect(missingFleet.machines[0]?.caps).toMatchObject({
        cpuPercent: RESOURCE_CPU_DEFAULT_PERCENT,
        memoryPercent: RESOURCE_MEMORY_DEFAULT_PERCENT,
        origin: { source: 'resources.json', cpuPercent: 'default', memoryPercent: 'default' },
      })
      expect(missingFleet.machines[0]?.governorSlots).toBe(1)
      // A present file is the configured value, read at call time: CPU 40
      // reaches the forecast, then 50 after the owner changes it.
      writeFileSync(
        `${folder}/resources.json`,
        JSON.stringify({ 'museSpark.resourceCpuMaxPercent': 40 }),
      )
      const fortyRun = await runCli(['M999', '--format', 'json'])
      const forty = sectionFleet(fortyRun.out)
      expect(forty.machines[0]?.caps).toMatchObject({
        cpuPercent: 40,
        origin: { source: 'resources.json', cpuPercent: 'configured', memoryPercent: 'default' },
      })
      expect(forty.machines[0]?.governorSlots).toBe(1)
      expect(forty.accounts).toEqual([
        { id: 'shop', providerId: 'meta', statedLimits: ['Unknown: limits unread for meta/shop.'] },
      ])
      writeFileSync(
        `${folder}/resources.json`,
        JSON.stringify({ 'museSpark.resourceCpuMaxPercent': 50 }),
      )
      const fiftyRun = await runCli(['M999', '--format', 'json'])
      const fifty = sectionFleet(fiftyRun.out)
      expect(fifty.machines[0]?.caps).toMatchObject({ cpuPercent: 50 })
      // A governor that is off states no threshold row.
      writeFileSync(
        `${folder}/resources.json`,
        JSON.stringify({ 'museSpark.resourceGovernor': false }),
      )
      const offRun = await runCli(['M999', '--format', 'json'])
      const off = sectionFleet(offRun.out)
      expect(off.machines[0]?.caps).toMatchObject({ cpuPercent: 100, memoryPercent: 100 })
      // A malformed file refuses without leaking its bytes.
      writeFileSync(`${folder}/resources.json`, '{"museSpark.resourceCpuMaxPercent":')
      const broken = await runCli(['M999', '--format', 'json'])
      expect(broken.code).toBe(1)
      expect(broken.err).toBe(fill(UI_TEXT.estimateFailed, { detail: 'fleet-caps-invalid' }))
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
  it('estimates through the ACP owners: the same resources.json and registry', async () => {
    const folder = scratchDir('cm1173-acp-')
    try {
      writeFileSync(
        `${folder}/resources.json`,
        JSON.stringify({ 'museSpark.resourceCpuMaxPercent': 40 }),
      )
      const estimate = createRuntimeEstimate({
        bundlePath: 'estimator.js',
        log,
        loadBundle: () => fleetEchoEngine(),
        machineDir: folder,
        accounts: { list: () => Promise.resolve([{ id: 'studio' }]) },
      })
      const signal = new AbortController().signal
      const firstText = await estimate.run('/estimate M999 --format json', folder, signal)
      const first = sectionFleet(firstText)
      expect(first.machines[0]?.caps).toMatchObject({ cpuPercent: 40 })
      expect(first.accounts).toEqual([
        {
          id: 'studio',
          providerId: 'meta',
          statedLimits: ['Unknown: limits unread for meta/studio.'],
        },
      ])
      // The owner changes the file; the next estimate follows it.
      writeFileSync(
        `${folder}/resources.json`,
        JSON.stringify({ 'museSpark.resourceCpuMaxPercent': 60 }),
      )
      const secondText = await estimate.run('/estimate M999 --format json', folder, signal)
      const second = sectionFleet(secondText)
      expect(second.machines[0]?.caps).toMatchObject({ cpuPercent: 60 })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
  it('installs the caller language table in the snapshot bundle', async () => {
    const installed: { locale: string; notFound: string }[] = []
    const ports = runtimeEstimatorPorts({
      snapshotBundlePath: 'dist/planSnapshot.js',
      log,
      root: '/workspace',
      machineDir: '/workspace',
      accounts: { list: () => Promise.resolve([]) },
      loadBundle: () => ({
        installPlanSnapshotText: (table: typeof EN, locale: string) => {
          installed.push({ locale, notFound: table.estimateNotFound })
        },
        createPlanSnapshotSource: () => rejectedSnapshot,
      }),
    })
    setUiText({ ...EN, estimateNotFound: 'Nicht gefunden: {goal}' }, 'de')
    await expect(
      ports.snapshot({ kind: 'milestone', milestoneId: 'M999' }, ESTIMATOR_AS_OF),
    ).rejects.toThrow(/Goal not found/)
    expect(installed).toEqual([{ locale: 'de', notFound: 'Nicht gefunden: {goal}' }])
  })
})
