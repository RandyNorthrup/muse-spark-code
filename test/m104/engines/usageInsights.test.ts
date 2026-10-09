import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as traceLogs from '../../../src/runtime/usage/traceLogs'
import { createRuntimeUsageInsights } from '../../../src/runtime/features/usageInsights'
import type { UsageInsightsReport } from '../../../src/runtime/usage/traceLogs'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
afterEach(() => {
  vi.restoreAllMocks()
})
const at = '2026-09-23T03:00:00.000Z'
// The existing traceLogs/insights fixtures use this captured M13 CLI line shape.
const admission = `${at} INFO tbh.local.model x event="model.attempt.lifecycle" run_id="r1" attempt_id="a" task_id="t" phase="admission" outcome="accepted"\n`

async function setup() {
  const homeDir = await fixtures.folder('m104-pb-usage-')
  const directory = traceLogs.traceLogDirectory({ homeDir })
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'cli-fixture.log'), admission)
  const state = { isCurrent: true, canReadTraceLogs: true }
  const create = () =>
    fixtures.own(
      createRuntimeUsageInsights({
        homeDir,
        now: () => Date.parse(at),
        assertCurrent: () => {
          if (!state.isCurrent) throw new Error('replaced')
        },
        canReadTraceLogs: () => state.canReadTraceLogs,
      }),
    )
  return { state, create, directory }
}

describe('portable Account & usage trace data', () => {
  it('reads the actual CLI trace through the existing cached day/week summarizer', async () => {
    const { create, directory } = await setup()
    const owner = create()
    const report = await owner.read()
    expect(report).toMatchObject({ day: { attempts: 1 }, week: { attempts: 1 } })
    await writeFile(path.join(directory, 'cli-second.log'), admission)
    expect(await owner.read()).toBe(report)
  })
  it.each(['isCurrent', 'canReadTraceLogs'] as const)(
    'reads no trace after %s is withdrawn',
    async (field) => {
      const { create, state } = await setup()
      const read = vi.fn(() => Promise.resolve(undefined))
      vi.spyOn(traceLogs, 'createInsightsReader').mockReturnValue({ read })
      const owner = create()
      state[field] = false
      await expect(owner.read()).rejects.toThrow()
      expect(read).not.toHaveBeenCalled()
    },
  )
  it.each(['isCurrent', 'canReadTraceLogs'] as const)(
    'withholds a trace result after late %s withdrawal',
    async (field) => {
      const { create, state } = await setup()
      const report = await create().read()
      const pending = Promise.withResolvers<UsageInsightsReport | undefined>()
      vi.spyOn(traceLogs, 'createInsightsReader').mockReturnValue({ read: () => pending.promise })
      const reading = create().read()
      state[field] = false
      pending.resolve(report)
      await expect(reading).rejects.toThrow()
    },
  )
  it('drains an accepted read during release and refuses later reads', async () => {
    const { create } = await setup()
    const report = await create().read()
    const pending = Promise.withResolvers<UsageInsightsReport | undefined>()
    const read = vi.fn(() => pending.promise)
    vi.spyOn(traceLogs, 'createInsightsReader').mockReturnValue({ read })
    const owner = create()
    const reading = owner.read()
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    pending.resolve(report)
    await expect(reading).rejects.toThrow()
    await closing
    await expect(owner.read()).rejects.toThrow()
    expect(read).toHaveBeenCalledOnce()
  })
  it('preserves explicit missing data and reader failure', async () => {
    const { create, directory } = await setup()
    await writeFile(path.join(directory, 'cli-fixture.log'), '')
    expect(await create().read()).toMatchObject({ day: { attempts: 0 } })
    vi.spyOn(traceLogs, 'createInsightsReader').mockReturnValue({
      read: () => Promise.resolve(undefined),
    })
    expect(await create().read()).toBeUndefined()
    vi.spyOn(traceLogs, 'createInsightsReader').mockReturnValue({
      read: () => Promise.reject(new Error('reader failed')),
    })
    await expect(create().read()).rejects.toThrow('reader failed')
  })
})
