// D119 catch burn-down, designed keeps: a report/provider failure
// settles under a fixed sentence because the failure may carry paths,
// recipients or credentials. The provider fails for real below and the
// settled record carries none of its text.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import {
  scheduleV2Schema,
  type ScheduleRunContext,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import {
  ScheduleReportActionRunner,
  scheduleReportTool,
} from '../../src/core/schedules/reportAction'

const SECRET = 'SECRET-recipient-secret-path'

function schedule(): ScheduleV2 {
  return scheduleV2Schema.parse({
    id: 'schedule-1',
    name: 'Morning report',
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
    trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 1_700_000_000_000 },
    target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
    delivery: 'interrupt',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() },
    paidCapUsd: Usd.from(0).toAmount(),
    parallel: false,
    zone: 'UTC',
    pinned: false,
    version: 2,
    revision: 0,
    workspaceKey: 'workspace-1',
    paused: false,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    nextFireAtMs: 1_700_000_060_000,
    fireCount: 0,
    consecutiveFailures: 0,
    depth: 0,
    allowAgentReschedule: false,
    creator: { kind: 'user' },
  })
}

function context(): ScheduleRunContext {
  return {
    unattended: true,
    scheduleId: 'schedule-1',
    runId: scheduleEventRunId('schedule-1', { source: 'manual', eventKey: 'req-1' }),
    grant: { rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() },
    creator: { kind: 'user' },
    mode: 'manual',
    depth: 0,
    allowAgentReschedule: false,
  }
}

describe('report failure secrecy', () => {
  it('settles a throwing provider as failed without its text', async () => {
    const job = schedule()
    const runner = new ScheduleReportActionRunner({
      store: { list: () => Promise.resolve([job]) },
      reports: {
        run: () => Promise.reject(new Error(`provider exploded: ${SECRET}`)),
      },
      audit: () => Promise.resolve(undefined),
      now: () => 1,
    })
    const result = await runner.run(job, context(), 1_700_000_060_000)
    expect(result.outcome).toBe('failed')
    expect(result.reason).toBe(UI_TEXT.scheduleV2.reportAction.failed)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })

  it('refuses a throwing admission without its text', async () => {
    const job = schedule()
    const tool = scheduleReportTool(
      {
        destinationsAllowed: () => Promise.resolve(true),
        admit: () => Promise.reject(new Error(`admission exploded: ${SECRET}`)),
      },
      { bounded: (request) => request },
      () => ({ rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() }),
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
  })
})
