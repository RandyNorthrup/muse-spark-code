// The M117 estimate as report-v1 sections (M113, PLAN.md D93.4): P50 and
// P90, the critical path, the limiting resource, the setups with their
// marginal values, the inputs and the calibration sample sizes. Pure
// projection over the validated EstimateSection the estimator's own run
// produced; the source owns validation and scrubbing, the collector owns
// section identity through forward().
import type { EstimateSection } from '../../../shared/estimate'
import type { ReportOptions, ReportRow, ReportSection } from '../../../shared/reportSchema'
import { count, label, row, section, text } from './common'

const SOURCE = 'estimate'

function totals(estimate: EstimateSection, options: ReportOptions): ReportSection {
  return section(
    `${SOURCE}/totals`,
    'totals',
    [
      { key: 'name', label: 'name' },
      { key: 'date', label: 'date' },
    ],
    [
      row(
        `${SOURCE}-total`,
        ['p50'],
        { name: text('p50'), date: { type: 'timestamp', value: estimate.p50 } },
        [SOURCE],
      ),
      row(
        `${SOURCE}-total`,
        ['p90'],
        { name: text('p90'), date: { type: 'timestamp', value: estimate.p90 } },
        [SOURCE],
      ),
    ],
    options,
  )
}

function criticalPath(estimate: EstimateSection, options: ReportOptions): ReportSection {
  const rows = estimate.criticalPath.map((laneId, index) =>
    row(
      `${SOURCE}-critical-path`,
      [String(index), laneId],
      { name: text(laneId), order: count(index + 1) },
      [SOURCE],
    ),
  )
  return section(
    `${SOURCE}/criticalPath`,
    'criticalPath',
    [
      { key: 'name', label: 'name' },
      { key: 'order', label: 'count' },
    ],
    rows,
    options,
  )
}

function limitingResource(estimate: EstimateSection, options: ReportOptions): ReportSection {
  const limiting = estimate.limitingResource
  return section(
    `${SOURCE}/limitingResource`,
    'limitingResource',
    [
      { key: 'kind', label: 'kind' },
      { key: 'resource', label: 'name' },
      { key: 'savedHours', label: 'count' },
      { key: 'moreAgentsHelp', label: 'status' },
    ],
    [
      row(
        `${SOURCE}-limiting-resource`,
        [limiting.kind, limiting.resourceId ?? ''],
        {
          kind: text(limiting.kind),
          resource: text(limiting.resourceId ?? ''),
          savedHours: { type: 'number', value: limiting.hoursSavedIfUnbounded },
          moreAgentsHelp: { type: 'boolean', value: limiting.moreAgentsHelp },
        },
        [SOURCE],
      ),
    ],
    options,
  )
}

function setups(estimate: EstimateSection, options: ReportOptions): ReportSection {
  const rows: ReportRow[] = []
  for (const setup of estimate.setups)
    for (const [machineIndex, machine] of setup.machines.entries())
      rows.push(
        row(
          `${SOURCE}-setup`,
          // The engine never repeats a class inside one setup, but the row
          // key must stay unique even if it did: duplicate keys fail the
          // section, and a report must not fail on valid engine output.
          [setup.kind, machine.classId, String(machineIndex)],
          {
            setup: text(setup.kind),
            machine: text(machine.classId),
            machines: count(machine.count),
            slots: count(machine.slots),
            p50: { type: 'timestamp', value: setup.p50 },
            p90: { type: 'timestamp', value: setup.p90 },
            marginalP50Hours: { type: 'number', value: machine.marginalP50Hours },
            marginalP90Hours: { type: 'number', value: machine.marginalP90Hours },
            adviceOnly: { type: 'boolean', value: setup.provisioning === 'adviceOnly' },
          },
          [SOURCE],
        ),
      )
  return section(
    `${SOURCE}/setups`,
    'setups',
    [
      { key: 'setup', label: 'setups' },
      { key: 'machine', label: 'name' },
      { key: 'machines', label: 'count' },
      { key: 'slots', label: 'count' },
      { key: 'p50', label: 'date' },
      { key: 'p90', label: 'date' },
      { key: 'marginalP50Hours', label: 'count' },
      { key: 'marginalP90Hours', label: 'count' },
      { key: 'adviceOnly', label: 'status' },
    ],
    rows,
    options,
  )
}

function inputs(estimate: EstimateSection, options: ReportOptions): ReportSection {
  const rows = estimate.inputs.lanes.map((lane) =>
    row(
      `${SOURCE}-input`,
      [lane.id],
      {
        lane: text(lane.id),
        kind: text(lane.kind),
        estimatedHours: { type: 'number', value: lane.estimatedHours },
        remainingHours: { type: 'number', value: lane.minimumRemainingHours },
        state: label(lane.state),
      },
      [SOURCE],
    ),
  )
  return section(
    `${SOURCE}/inputs`,
    'inputs',
    [
      { key: 'lane', label: 'name' },
      { key: 'kind', label: 'kind' },
      { key: 'estimatedHours', label: 'count' },
      { key: 'remainingHours', label: 'count' },
      { key: 'state', label: 'status' },
    ],
    rows,
    options,
  )
}

function calibration(estimate: EstimateSection, options: ReportOptions): ReportSection {
  const rows = estimate.calibration.map((entry) =>
    row(
      `${SOURCE}-calibration`,
      [entry.kind, entry.machineClassId, entry.engine ?? ''],
      {
        kind: text(entry.kind),
        machine: text(entry.machineClassId),
        engine: text(entry.engine ?? ''),
        basis: text(entry.basis),
        samples: count(entry.samples),
      },
      [SOURCE],
    ),
  )
  return section(
    `${SOURCE}/calibration`,
    'calibration',
    [
      { key: 'kind', label: 'kind' },
      { key: 'machine', label: 'name' },
      { key: 'engine', label: 'name' },
      { key: 'basis', label: 'status' },
      { key: 'samples', label: 'count' },
    ],
    rows,
    options,
  )
}

/** The six D93.4 facets in collector order; empty facets stay empty, never absent. */
export function estimateReportSections(
  estimate: EstimateSection,
  options: ReportOptions,
): ReportSection[] {
  return [
    totals(estimate, options),
    criticalPath(estimate, options),
    limitingResource(estimate, options),
    setups(estimate, options),
    inputs(estimate, options),
    calibration(estimate, options),
  ]
}
