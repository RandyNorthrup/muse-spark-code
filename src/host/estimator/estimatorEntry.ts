// The capacity estimator's lazy bundle (M117, PLAN.md D6, D97): esbuild
// builds this file into dist/estimator.js, which the extension, the CLI and
// the ACP agent require the first time an estimate runs, so the engine stays
// out of every bundle loaded at activation. The bundle keeps its own
// installed-language state, so the factory installs the caller's table
// before anything reads it.
//
// The engine composes the lanes (G's goal and DAG, C's calibration, S's
// schedule and seeded simulation, R's recommendations and dated prices, P's
// first-wave starter) behind injected source ports. Missing milestone
// bindings (M113's plan reader and sources, M96's board, M109's broker,
// M110's routes) arrive as those ports and refuse with their handoff names:
// recommendations for rented servers stay advice-only until bound.
//
// Report assembly keeps every number's evidence: inputs' own quantities
// carry theirs; history records are single observations; fitted rows carry
// calibration with their samples and prior rows stay assumptions; the
// P50–P90 band is the dates' uncertainty. Review and redesign overheads are
// zero-valued assumptions: the fitted actual/estimated ratio already carries
// the review time observed in history, and hours per round would count it
// twice (docs/estimator/prior.md).
import * as z from 'zod/mini'
import { setUiText, fill, formatUsd } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { ESTIMATE_ENGINES, UI_TEXT } from '../../shared/constants'
import {
  estimateInputsSchema,
  estimateRequestSchema,
  estimateSectionSchema,
  fleetSnapshotSchema,
  historyRecordSchema,
  type CatalogPrice,
  type EstimateInputs,
  type EstimateLane,
  type EstimateRequest,
  type EstimateSection,
} from '../../shared/estimate'
import { displayUsdNanos, usdNanos } from '../../shared/usd'
import { resolveEstimateGoal, type EstimateGoalSourcesPort } from '../../core/estimator/goal'
import { canEstimateMachineRun } from '../../core/estimator/schedule'
import { fitCalibration, type CalibrationFit } from '../../core/estimator/calibration/fit'
import {
  estimateDurationMap,
  simulateEstimate,
  type EstimateDurationPort,
} from '../../core/estimator/simulate'
import { findEstimateBottleneck } from '../../core/estimator/bottleneck'
import { recommendEstimate } from '../../core/estimator/recommend'
import { lookupEstimatePrices } from '../../core/estimator/prices'
import type { EstimatePriceLookup, EstimatePricePort } from '../../core/estimator/prices'
import { baseRisks } from '../../core/estimator/baseRisk'
import { EstimateWaveStarter } from '../../core/estimator/provision/start'
import type { EstimateStartPort } from '../../shared/estimate'

/** The milestone bindings, injected: each refuses with its handoff until it merges. */
export interface EstimatorSourcePorts extends EstimateGoalSourcesPort {
  /** This estimate's lanes ride along so the fleet can offer them capacity. */
  fleet(lanes: readonly EstimateLane[]): Promise<unknown>
  history(): Promise<unknown>
  candidatePool(lanes: readonly EstimateLane[]): Promise<unknown>
  board(): EstimateStartPort
  prices(): EstimatePricePort
  priceLookup(): Omit<EstimatePriceLookup, 'asOf'>
}

export interface EstimatorRun {
  estimate(request: EstimateRequest, signal: AbortSignal): Promise<EstimateSection>
  startWave(input: EstimateInputs): Promise<readonly string[]>
  price(price: CatalogPrice): string
  /** Rented provisioning stays advice-only: the broker binding is absent. */
  readonly provisionWaiting: string
}

type Disclosure = EstimateSection['disclosures'][number]

const assumed: Omit<Disclosure, 'path'> = {
  basis: 'assumption',
  samples: 0,
  uncertainty: { kind: 'unknown' },
}

/** Same walk as the section's own coverage rule: every number, and p50/p90 dates. */
function disclosureTargets(value: unknown, pointer = ''): Map<string, number | string> {
  if (typeof value === 'number') return new Map([[pointer, value]])
  if (typeof value === 'string' && /\/(?:p50|p90)$/.test(pointer))
    return new Map([[pointer, value]])
  const targets = new Map<string, number | string>()
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (pointer === '' && key === 'disclosures') continue
      const segment = key.replaceAll('~', '~0').replaceAll('/', '~1')
      for (const [path, target] of disclosureTargets(child, `${pointer}/${segment}`))
        targets.set(path, target)
    }
  }
  return targets
}

function atPath(value: unknown, path: string): unknown {
  const segments = path
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
  let current: unknown = value
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isEvidence(value: unknown): value is Omit<Disclosure, 'path'> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const basis = record['basis']
  return (
    typeof basis === 'string' &&
    ['history', 'calibration', 'assumption', 'unknown'].includes(basis) &&
    typeof record['samples'] === 'number' &&
    record['uncertainty'] !== null &&
    typeof record['uncertainty'] === 'object'
  )
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** The estimate's run, assembled from the lanes with their evidence. */
export function createEstimatorRun(
  ports: EstimatorSourcePorts,
  table: UiText,
  locale: string,
): EstimatorRun {
  setUiText(table, locale)
  const board = ports.board()
  const starter = new EstimateWaveStarter(board)
  return {
    provisionWaiting: 'M117-P-M109-provider',
    price: (price) => formatUsd(displayUsdNanos(usdNanos(price.hourlyUsd)), 2),
    startWave: (input) => starter.start(input),
    estimate: async (request, signal) => {
      const parsed = estimateRequestSchema.parse(request)
      signal.throwIfAborted()
      const lanes = await resolveEstimateGoal(parsed.goal, parsed.asOf, {
        snapshot: (goal, asOf) => ports.snapshot(goal, asOf),
      })
      signal.throwIfAborted()
      const fleet = fleetSnapshotSchema.parse(await ports.fleet(lanes))
      const history = z.array(historyRecordSchema).parse(await ports.history())
      signal.throwIfAborted()
      const inputs = estimateInputsSchema.parse({
        request: parsed,
        lanes,
        fleet,
        history,
      })
      const pairs: { kind: string; machineClassId: string }[] = []
      for (const lane of inputs.lanes)
        for (const machine of inputs.fleet.machines) {
          if (!canEstimateMachineRun(lane, machine)) continue
          if (
            pairs.every(
              (pair) => pair.kind !== lane.kind || pair.machineClassId !== machine.classId,
            )
          )
            pairs.push({ kind: lane.kind, machineClassId: machine.classId })
        }
      for (const lane of inputs.lanes)
        if (pairs.every((pair) => pair.kind !== lane.kind))
          throw new Error(UI_TEXT.estimateNoCapacity)
      const fits = new Map<string, CalibrationFit>()
      const calibration: EstimateSection['calibration'] = []
      for (const pair of pairs)
        for (const engine of [undefined, ...ESTIMATE_ENGINES] as const) {
          const fit = fitCalibration(
            inputs.history,
            pair.kind,
            pair.machineClassId,
            parsed.asOf,
            'agentTime',
            engine,
          )
          fits.set(`${pair.kind}:${pair.machineClassId}:${engine ?? ''}`, fit)
          calibration.push(fit.calibration)
        }
      signal.throwIfAborted()
      const zero = {
        status: 'known' as const,
        value: 0,
        basis: 'assumption' as const,
        samples: 0,
        uncertainty: { kind: 'interval' as const, lower: 0, upper: 0 },
      }
      const durationPort: EstimateDurationPort = {
        model: (lane, machineClassId) => {
          const fit = fits.get(`${lane.kind}:${machineClassId}:`)
          if (fit === undefined) refuse('missing-fit')
          return {
            kind: 'lognormal',
            calibration: fit.calibration,
            reviewHours: zero,
            redesignHours: zero,
          }
        },
      }
      const simulation = simulateEstimate(inputs, durationPort)
      signal.throwIfAborted()
      const durations = estimateDurationMap(simulation.durationSamples)
      const limitingResource = findEstimateBottleneck(inputs.lanes, inputs.fleet, durations)
      const lookup = ports.priceLookup()
      const catalog =
        lookup.enabled && lookup.networkAllowed
          ? await lookupEstimatePrices({ ...lookup, asOf: parsed.asOf }, ports.prices())
          : { rows: [], sources: [], unavailable: [] }
      signal.throwIfAborted()
      const pool = fleetSnapshotSchema.parse(await ports.candidatePool(inputs.lanes))
      const [failurePrefix = 'Estimate failed: '] = UI_TEXT.estimateFailed.split('{detail}', 2)
      const recommendation = recommendEstimate(
        inputs,
        pool,
        {
          forecast: (variant) => {
            try {
              return {
                status: 'feasible' as const,
                simulation: simulateEstimate(variant, durationPort),
              }
            } catch (error: unknown) {
              // S refuses infeasible fleets as estimate failures; bugs propagate.
              if (error instanceof Error && error.message.startsWith(failurePrefix))
                return { status: 'infeasible' as const, reason: error.message }
              throw error
            }
          },
        },
        catalog.rows.flatMap((row) =>
          pool.machines
            .filter((machine) => machine.classId === row.classId)
            .map((machine) => ({ machineId: machine.id, price: row.price })),
        ),
      )
      const fittedSamples = calibration
        .filter((row) => row.basis === 'fitted')
        .map((row) => row.samples)
      const dateEvidence: Omit<Disclosure, 'path'> =
        fittedSamples.length === 0
          ? { ...assumed }
          : {
              basis: 'calibration',
              samples: Math.min(...fittedSamples),
              uncertainty: {
                kind: 'time',
                earliest: simulation.p50,
                latest: simulation.p90,
              },
            }
      const rowEvidence = new Map(
        calibration.map((row, index) => [
          `/calibration/${String(index)}`,
          row.basis === 'fitted'
            ? { basis: 'calibration' as const, samples: row.samples }
            : { basis: 'assumption' as const, samples: 0 },
        ]),
      )
      const draft = {
        kind: 'estimate' as const,
        schemaVersion: 1 as const,
        asOf: parsed.asOf,
        p50: simulation.p50,
        p90: simulation.p90,
        seed: simulation.seed,
        runs: simulation.runs,
        schedule: simulation.schedule,
        criticalPath: simulation.criticalPath,
        limitingResource,
        setups: recommendation.setups,
        inputs,
        calibration,
        risks: baseRisks(inputs.lanes, parsed.asOf),
      }
      const disclosures: Disclosure[] = []
      for (const [path] of disclosureTargets(draft)) {
        if (/\/p50$|\/p90$/.test(path)) {
          disclosures.push({ ...dateEvidence, path })
          continue
        }
        const segments = path.slice(1).split('/')
        const rowKey = segments.length > 2 ? `/${segments[0] ?? ''}/${segments[1] ?? ''}` : ''
        const row = rowKey.startsWith('/calibration/') ? rowEvidence.get(rowKey) : undefined
        if (row !== undefined) {
          disclosures.push({ ...row, path, uncertainty: { kind: 'unknown' } })
          continue
        }
        const parent = atPath(draft, `/${segments.slice(0, -1).join('/')}`)
        if (isEvidence(parent)) {
          // The interval covers the measured value only: bounds and sample
          // counts keep the basis with unknown uncertainty.
          disclosures.push(
            path.endsWith('/value')
              ? {
                  path,
                  basis: parent.basis,
                  samples: parent.samples,
                  uncertainty: parent.uncertainty,
                }
              : {
                  path,
                  basis: parent.basis,
                  samples: parent.samples,
                  uncertainty: { kind: 'unknown' },
                },
          )
          continue
        }
        if (path.startsWith('/inputs/history/')) {
          disclosures.push({ path, basis: 'history', samples: 1, uncertainty: { kind: 'unknown' } })
          continue
        }
        disclosures.push({ ...assumed, path })
      }
      return estimateSectionSchema.parse({ ...draft, disclosures })
    },
  }
}

/** The bundle's shape is guarded beside its loader (estimatorBundle.ts): a
 * value imported from this entry would carry the engine back into
 * dist/extension.js, which the bundle-split gate refuses.
 */
