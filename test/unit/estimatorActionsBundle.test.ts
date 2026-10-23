// The estimator run's lazy actions bundle
// (src/host/estimator/estimateActionsEntry.ts): composer parsing resolves
// through the lazily loaded chunk, and first-wave starts share one starter,
// so a lane started once is never submitted again.
import { expect, it } from 'vitest'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import type { EstimatorSourcePorts } from '../../src/host/estimator/estimatorEntry'
import type { EstimateStartPort } from '../../src/shared/estimate'
import { estimateRequestSchema, fleetSnapshotSchema } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { scheduleFleet, scheduleLane } from './helpers/estimatorKindScheduleFixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'

function tripwire(name: string): (...args: never[]) => Promise<unknown> {
  return () => Promise.reject(new Error(`the actions path never reaches ${name}`))
}

function ports(board: () => EstimateStartPort): EstimatorSourcePorts {
  return {
    snapshot: tripwire('snapshot'),
    fleet: tripwire('fleet'),
    history: tripwire('history'),
    candidatePool: tripwire('candidatePool'),
    board,
    prices: () => {
      throw new Error('the actions path never reaches prices')
    },
    priceLookup: () => {
      throw new Error('the actions path never reaches priceLookup')
    },
  }
}

it('parses a composer command through the lazy actions bundle', async () => {
  setUiText(EN, BASE_LOCALE)
  const run = createEstimatorRun(
    ports(() => ({
      audit: () => Promise.reject(new Error('parsing never audits a wave')),
      start: () => Promise.reject(new Error('parsing never starts a wave')),
    })),
    EN,
    BASE_LOCALE,
  )
  const request = await run.parseCommand?.('/estimate M117', { asOf: AS_OF, optimize: 'speed' })
  expect(request?.goal).toEqual({ kind: 'milestone', milestoneId: 'M117' })
  expect(request?.fleet).toBe('current')
})

it('starts first waves through one shared starter', async () => {
  setUiText(EN, BASE_LOCALE)
  const started: string[][] = []
  let boardCalls = 0
  const run = createEstimatorRun(
    ports(() => {
      boardCalls += 1
      return {
        audit: () => Promise.resolve({ allowed: true, missingPrerequisites: [] }),
        start: (laneIds: readonly string[]) => {
          started.push([...laneIds])
          return Promise.resolve()
        },
      }
    }),
    EN,
    BASE_LOCALE,
  )
  const request = estimateRequestSchema.parse({
    goal: { kind: 'milestone', milestoneId: 'M117' },
    asOf: AS_OF,
    fleet: 'current',
    optimize: 'cost',
  })
  // The schedule refuses a wave into unknown account capacity, so the
  // account reports its token rate and current window like a bound one.
  const fleet = fleetSnapshotSchema.parse({
    ...scheduleFleet(),
    accounts: [
      {
        id: 'schedule-account',
        providerId: 'schedule-provider',
        requestsPerMinute: 10,
        tokensPerMinute: 100_000,
        usageLimits: [
          {
            kind: 'rolling',
            periodSeconds: 86_400,
            id: 'tokens',
            unit: 'tokens',
            remaining: 100_000,
            allowance: 100_000,
            resetsAt: '2026-10-07T12:00:00.000Z',
            timeZone: 'UTC',
          },
        ],
      },
    ],
  })
  const input = { request, lanes: [scheduleLane('0')], fleet, history: [] }
  await expect(run.startWave(input)).resolves.toEqual(['0'])
  await expect(run.startWave(input)).resolves.toEqual([])
  expect(started).toEqual([['0']])
  expect(boardCalls).toBe(1)
})
