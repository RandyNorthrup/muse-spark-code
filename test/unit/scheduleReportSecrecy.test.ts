// D119 catch burn-down, designed keeps: a report/provider failure
// settles under a fixed sentence because the failure may carry paths,
// recipients or credentials. The provider fails for real below and the
// settled record carries none of its text.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import {
  ScheduleReportActionRunner,
  scheduleReportTool,
} from '../../src/core/schedules/reportAction'
import { quietStoreBase, runContextFixture, scheduleFixture } from './helpers/scheduleFixtures'
import { collectingLogger } from './helpers/collectingLogger'

const SECRET = 'SECRET-recipient-secret-path'

function schedule() {
  return scheduleFixture({
    name: 'Morning report',
    grant: { rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() },
    action: {
      kind: 'report',
      reportKind: 'status',
      args: {},
      format: 'markdown',
      destinations: [
        {
          id: 'dest-1',
          kind: 'save',
          rootId: 'root-1',
          directory: 'reports',
          nameTemplate: 'n',
          retention: 30,
        },
      ],
    },
  })
}

describe('report failure secrecy', () => {
  it('settles a throwing provider as failed without its text', async () => {
    const job = schedule()
    const logged: string[] = []
    const runner = new ScheduleReportActionRunner({
      store: {
        create: () => Promise.resolve(undefined),
        list: () => Promise.resolve([job]),
        ...quietStoreBase(),
      },
      reports: {
        run: () => Promise.reject(new Error(`provider exploded: ${SECRET}`)),
      },
      audit: () => Promise.resolve(undefined),
      log: collectingLogger(logged),
      now: () => 1,
    })
    const result = await runner.run(job, runContextFixture(job), 1_700_000_060_000)
    expect(result.outcome).toBe('failed')
    expect(result.reason).toBe(UI_TEXT.scheduleV2.reportAction.failed)
    expect(JSON.stringify(result)).not.toContain('SECRET')
    // The record keeps the failure's kind; the secret reaches neither
    // the record nor the person.
    expect(logged).toContain('The schedule report run failed: Error')
    expect(logged.join('\n')).not.toContain('SECRET')
  })

  it('refuses a throwing admission without its text', async () => {
    const job = schedule()
    const logged: string[] = []
    const tool = scheduleReportTool(
      {
        destinationsAllowed: () => Promise.resolve(true),
        admit: () => Promise.reject(new Error(`admission exploded: ${SECRET}`)),
      },
      { bounded: (request) => request },
      () => ({ rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() }),
      collectingLogger(logged),
    )
    const result = await tool.execute({
      name: 'Morning report',
      action: job.action,
      trigger: job.trigger,
      target: job.target,
      delivery: job.delivery,
      whenClosed: job.whenClosed,
      catchUp: job.catchUp,
      mode: job.mode,
      grant: job.grant,
      paidCapUsd: job.paidCapUsd,
      parallel: job.parallel,
      zone: job.zone,
      end: { atMs: 1_800_000_000_000 },
      pinned: job.pinned,
    })
    expect(result).toEqual({ kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.unavailable })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect(logged).toContain('The schedule report tool failed: Error')
    expect(logged.join('\n')).not.toContain('SECRET')
  })
})
