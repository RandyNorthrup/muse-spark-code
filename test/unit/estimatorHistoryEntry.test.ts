// M117 C-M117-2: the run discloses the history journal's skipped records.
// A damaged journal file stays out of calibration but shows in the honesty
// block by opaque file id and fixed code; a clean journal attaches nothing.
// The journal is real files on disk; the ports hand the run its listing.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import { fileHistoryPorts } from '../../src/host/estimator/historyStore'
import {
  estimateSectionSchema,
  fleetSnapshotSchema,
  parseEstimateGoal,
} from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { fleetMachine, scheduleFleet } from './helpers/estimatorKindScheduleFixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'
const PLAN = `## 6. Milestones

### M117 — Capacity work (2026-10-06)

**Status 2026-10-06: building.**

- **Goal.** Ship capacity.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Hours |
| ---- | ----- | ------------- | ------ | ----- |
| 0 | all | \`src/a.ts\` | First | 8 |
`
/** A board that must never be contacted: any call fails the test loudly. */
const untouchedBoard = {
  audit: (): Promise<never> =>
    Promise.reject(new Error('board untouched while history is disclosed')),
  start: (): Promise<never> =>
    Promise.reject(new Error('board untouched while history is disclosed')),
}

const roots: string[] = []
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  setUiText(EN, BASE_LOCALE)
})

async function journalDir(isDamaged: boolean): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'm117-history-entry-'))
  roots.push(root)
  if (isDamaged) {
    await writeFile(
      path.join(root, 'damaged.json'),
      JSON.stringify({ version: 99, durationBasis: 'agentTime', record: {} }),
      'utf8',
    )
  }
  return root
}

async function sectionFor(directory: string) {
  setUiText(EN, BASE_LOCALE)
  const goal = parseEstimateGoal('M117')
  if (goal === undefined) throw new Error('unparseable goal: M117')
  const snapshot = buildPlanSnapshot(PLAN, goal, AS_OF, { branches: [] })
  const laneKind = snapshot.lanes[0]?.lane.kind
  if (laneKind === undefined) throw new Error('plan snapshot has no lanes')
  const base = scheduleFleet()
  const pool = fleetSnapshotSchema.parse({
    ...base,
    roles: [{ id: 'schedule-role', laneKinds: [laneKind] }],
    machines: [
      {
        ...fleetMachine('schedule-machine', 'linux-x64-schedule', 2),
        id: 'schedule-machine',
        capacityByKind: [{ kind: laneKind, slots: 1 }],
      },
    ],
  })
  const history = fileHistoryPorts(directory)
  return await createEstimatorRun(
    {
      snapshot: () => Promise.resolve(snapshot),
      fleet: () => Promise.resolve(pool),
      history: () => history.history(),
      historySkipped: () => history.skipped(),
      candidatePool: () => Promise.resolve(pool),
      board: () => untouchedBoard,
      prices: () => ({
        cached: () => Promise.reject(new Error('no catalog in this run')),
        store: () => Promise.resolve(),
        fetchPublic: () => Promise.reject(new Error('network must stay off')),
      }),
      priceLookup: () => ({
        enabled: false,
        networkAllowed: false,
        maxAgeMs: 0,
        catalogUrls: [],
      }),
    },
    EN,
    BASE_LOCALE,
  ).estimate(
    { goal, asOf: AS_OF, fleet: 'optimum', optimize: 'speed', seed: 'history' },
    new AbortController().signal,
  )
}

describe('M117 history skip disclosures', () => {
  it('discloses skipped history records without changing calibrated output', async () => {
    const section = await sectionFor(await journalDir(true))
    expect(section.historySkipped).toHaveLength(1)
    expect(section.historySkipped?.[0]?.code).toBe('unknownHistoryVersion')
    // Skipped diagnostics are strings only: the disclosure walk gains no targets.
    expect(
      section.disclosures.every((disclosure) => !disclosure.path.startsWith('/historySkipped')),
    ).toBe(true)
    estimateSectionSchema.parse(structuredClone(section))
  })

  it('omits historySkipped when the journal skipped nothing', async () => {
    const section = await sectionFor(await journalDir(false))
    expect(section).not.toHaveProperty('historySkipped')
  })
})
