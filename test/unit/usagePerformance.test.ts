import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregateUsage, shiftUsageDay, usageLocalDay } from '../../src/core/usage/aggregate'
import { createUsageService } from '../../src/core/usage/usageService'
import { usageFixtureDeps, usageFixtureRecord, usageNow } from './helpers/usageFixture'

describe('usage at the M102 history scale', () => {
  it('serves thirty days times two thousand calls and records the warm service timing on this rig', async () => {
    const records = Array.from({ length: 60_000 }, (_, index) =>
      usageFixtureRecord({
        id: `call-${String(index)}`,
        provider: `provider-${String(index % 9)}`,
        day: shiftUsageDay(usageLocalDay(usageNow), -Math.floor(index / 2000)),
      }),
    )
    const service = createUsageService(usageFixtureDeps(records))
    const query = { range: '30d', groupBy: 'provider', metric: 'cost' } as const
    await service.snapshot(query)
    const started = performance.now()
    const state = await service.snapshot(query)
    const warmMs = performance.now() - started
    expect(state.totals.records).toBe(60_000)
    expect(state.totals.tokens.input).toBe(6_000_000)
    expect(state.buckets).toHaveLength(30)
    expect(state.breakdown).toHaveLength(9)
    expect(state.totals.costs[0]?.usd).toBeCloseTo(600, 6)
    const aggregate = aggregateUsage(records, [], query, usageNow)
    expect(state.totals).toEqual(aggregate.totals)
    const folder = path.join(process.cwd(), 'temp')
    await mkdir(folder, { recursive: true })
    await writeFile(
      path.join(folder, 'm102-s-performance.json'),
      JSON.stringify({
        rig: process.platform === 'win32' ? 'win11' : process.platform,
        records: records.length,
        warmMs,
        targetRig: 'kubuntu',
        targetMs: 300,
      }),
    )
  })
})
