// Two app instances starting at the same moment must share the
// created-resources registry: one failed session/new with `Command failed:
// powershell.exe ... [MuseSparkCreated]::Execute('publish', ...)` when lanes
// RLSCHED and RLFINISH started together (2026-10-22 00:52, published 0.19.0).
// The losing compare-and-swap ended the session, and a winning save dropped
// whatever the other process had written. Two real processes meet at the
// same instant here through the product's own native file commands on every
// platform; every created entry must survive in the live manifest and no
// save may fail. The driver (test/hosts/created-registry-race.mjs) is a
// plain node script, so the lead can also run it by hand on any machine.
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runDriverScript } from './helpers/spawnDriver'
import { createdChildFixture, type CreatedChildFixture } from './helpers/resources/createdChild'

const scratch: { fixture?: CreatedChildFixture | undefined } = {}
const PROCESSES = 2
const ROUNDS = 2
const CREATES = 2

beforeAll(async () => {
  scratch.fixture = await createdChildFixture(
    'created-registry-race-',
    'createdRegistryRace.cjs',
    'test/unit/createdRegistryRaceEntry.ts',
    'created-race-jobs-',
  )
})

afterAll(async () => {
  await scratch.fixture?.dispose()
  scratch.fixture = undefined
})

function fixture(): CreatedChildFixture {
  if (scratch.fixture === undefined) throw new Error('the race fixture was not prepared')
  return scratch.fixture
}

interface Summary {
  readonly processes: number
  readonly rounds: number
  readonly creates: number
  readonly created: number
  readonly failures: readonly string[]
  readonly missing: readonly string[]
  readonly crashed: number
}

describe('the created registry under a race (RLWINFIX2 item 1)', () => {
  it('shares the manifest between two processes started together, losing nothing', async () => {
    const { code, output } = await runDriverScript(
      path.resolve('test/hosts/created-registry-race.mjs'),
      [
        fixture().bundle,
        path.join(fixture().folder, 'work'),
        fixture().storage,
        path.resolve('.'),
        fixture().nativeRoot,
        String(PROCESSES),
        String(ROUNDS),
        String(CREATES),
      ],
    )
    const summary = JSON.parse(output) as Summary
    expect(summary.crashed).toBe(0)
    expect(summary.failures).toEqual([])
    // Every created entry survives in the live manifest: no lost update.
    expect(summary.missing).toEqual([])
    expect(summary.created).toBe(PROCESSES * ROUNDS * CREATES)
    expect(code).toBe(0)
    // Two processes times two rounds of native compare-and-swap publishes
    // takes seconds, not milliseconds: the timeout covers the genuinely
    // long race, nothing else.
  }, 120_000)
})
