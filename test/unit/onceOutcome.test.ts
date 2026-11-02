// M88 lane C (PLAN.md D67, item 15): a timed send's unsent outcome
// is said in the conversation, never silent. A refused, skipped or
// missed once-send voices its settlement's own reason; a turn that
// ran or failed speaks for itself, and recurring schedules and
// report actions are not timed sends.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScheduleDelivery } from '../../src/core/schedules/delivery'
import { scheduleDispatchRefusal } from '../../src/core/schedules/dispatchRefusal'
import type { AttentionNotice } from '../../src/host/conversation/turnNotifications'
import { onceOutcomeNotice, voiceOnceOutcome } from '../../src/host/schedules/onceOutcome'
import { UI_TEXT } from '../../src/shared/constants'
import {
  noScheduleCost,
  scheduleFireRecordSchema,
  type ScheduleDeliveryResult,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { runContextFixture, scheduleFixture } from './helpers/scheduleFixtures'
import { conversationPanel, modelApiRig, panelNotices } from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

function neverReached(name: string): () => never {
  return () => {
    throw new Error(`must stay unreached: ${name}`)
  }
}

function onceSchedule(overrides: Partial<ScheduleV2> = {}): ScheduleV2 {
  return scheduleFixture({
    id: 'once-1',
    name: 'Water the plants',
    action: { kind: 'prompt', prompt: 'Water the plants.' },
    trigger: { kind: 'once', atMs: 1_800_000_000_000 },
    target: { kind: 'conversation', sessionId: 'session-1', backend: 'museCode' },
    ...overrides,
  })
}

function fireResult(
  schedule: ScheduleV2,
  outcome: ScheduleDeliveryResult['outcome'],
  reason?: string,
): ScheduleDeliveryResult {
  return scheduleFireRecordSchema.parse({
    runId: `${schedule.id}:run-1`,
    scheduleId: schedule.id,
    workspaceKey: schedule.workspaceKey,
    occurrenceMs: 1_700_000_000_000,
    observedAtMs: 1_700_000_000_001,
    target: schedule.target,
    delivery: schedule.delivery,
    outcome,
    ...(reason !== undefined && { reason }),
    refusedActions: [],
    cost: noScheduleCost(),
  })
}

describe('onceOutcomeNotice', () => {
  it('says a refused send with its name and the settlement’s reason', () => {
    const schedule = onceSchedule()
    const notice = onceOutcomeNotice(
      fireResult(schedule, 'refused', UI_TEXT.museCodeOnceAccountChanged),
      schedule,
    )
    expect(notice).toEqual({
      key: 'schedule-outcome:once-1:run-1',
      message: `Timed send “Water the plants” was refused: ${UI_TEXT.museCodeOnceAccountChanged}`,
    })
  })

  it('says skipped and missed sends on either backend', () => {
    const skipped = onceSchedule({
      id: 'once-2',
      target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
    })
    expect(
      onceOutcomeNotice(fireResult(skipped, 'skipped', UI_TEXT.turnUnqueued), skipped)?.message,
    ).toBe('Timed send “Water the plants” was skipped: ' + UI_TEXT.turnUnqueued)
    const missed = onceSchedule({ id: 'once-3' })
    expect(
      onceOutcomeNotice(
        fireResult(missed, 'missed', UI_TEXT.scheduleV2.messages.catchUpSkipped),
        missed,
      )?.message,
    ).toBe(
      'Timed send “Water the plants” was missed: ' + UI_TEXT.scheduleV2.messages.catchUpSkipped,
    )
  })

  it('stays quiet when the turn speaks, or the fire is no timed send', () => {
    const schedule = onceSchedule()
    expect(onceOutcomeNotice(fireResult(schedule, 'ran'), schedule)).toBeUndefined()
    expect(onceOutcomeNotice(fireResult(schedule, 'failed', 'broke'), schedule)).toBeUndefined()
    const recurring = onceSchedule({
      trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 0 },
    })
    expect(onceOutcomeNotice(fireResult(recurring, 'refused', 'no'), recurring)).toBeUndefined()
    const report = onceSchedule({
      action: {
        kind: 'report',
        reportKind: 'usage',
        args: {},
        format: 'markdown',
        destinations: [{ id: 'dest-1', kind: 'browser', location: 'local', whenInactive: 'wait' }],
      },
    })
    expect(onceOutcomeNotice(fireResult(report, 'missed', 'no'), report)).toBeUndefined()
  })

  it('falls back to a fixed sentence when the record carries no reason', () => {
    const schedule = onceSchedule()
    expect(onceOutcomeNotice(fireResult(schedule, 'missed'), schedule)?.message).toBe(
      'Timed send “Water the plants” was missed: ' + UI_TEXT.scheduleV2.messages.targetClosed,
    )
    expect(onceOutcomeNotice(fireResult(schedule, 'refused'), schedule)?.message).toBe(
      'Timed send “Water the plants” was refused: ' + UI_TEXT.scheduleV2.messages.targetUnavailable,
    )
  })
})

describe('delivery settled hook', () => {
  it('tells every final settlement, refused or missed', async () => {
    const seen: { result: ScheduleDeliveryResult; schedule: ScheduleV2 }[] = []
    const delivery = new ScheduleDelivery({
      now: () => 1,
      monotonicNow: () => 1,
      holds: () => true,
      targets: {
        find: () => Promise.reject(scheduleDispatchRefusal(UI_TEXT.museCodeOnceAccountChanged)),
        open: neverReached('open'),
        fresh: neverReached('fresh'),
      },
      runs: {
        run: neverReached('runs.run'),
      },
      prompt: neverReached('prompt'),
      settled: (result, schedule) => {
        seen.push({ result, schedule })
      },
    })
    const schedule = onceSchedule({ delivery: 'whenIdle' })
    const refused = await delivery.deliver(schedule, runContextFixture(schedule), 1_700_000_060_000)
    expect(refused.outcome).toBe('refused')
    const skippedCatchUp = onceSchedule({ id: 'once-catchup', catchUp: 'skip' })
    const missed = await delivery.deliverMissed(
      skippedCatchUp,
      runContextFixture(skippedCatchUp),
      1_700_000_060_000,
    )
    expect(missed.outcome).toBe('missed')
    expect(seen.map((entry) => entry.result.outcome)).toEqual(['refused', 'missed'])
    expect(seen.map((entry) => entry.schedule.id)).toEqual(['once-1', 'once-catchup'])
  })
})

describe('voiceOnceOutcome through a real panel', () => {
  let directory = ''
  const attention: AttentionNotice[] = []

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'once-outcome-'))
    attention.length = 0
  })

  afterEach(async () => {
    await removeFolder(directory)
  })

  function voicedPanel() {
    return conversationPanel({
      rig: modelApiRig(directory),
      directory,
      notifyAttention: (notice) => {
        attention.push(notice)
      },
    })
  }

  it('posts the outcome and raises it once', () => {
    const panel = voicedPanel()
    const schedule = onceSchedule()
    const result = fireResult(schedule, 'refused', UI_TEXT.museCodeOnceAccountChanged)
    voiceOnceOutcome(result, schedule, {
      notice: (text) => {
        panel.controller.scheduleNotice(undefined, text)
      },
      attention: (notice) => {
        panel.controller.notifyScheduleOutcome(notice)
      },
    })
    const notices = panelNotices(panel.posted)
    expect(notices).toHaveLength(1)
    expect(notices[0]?.level).toBe('info')
    expect(notices[0]?.text).toContain('Timed send “Water the plants” was refused: ')
    expect(attention).toHaveLength(1)
    expect(attention[0]?.key).toBe('schedule-outcome:once-1:run-1')
    expect(attention[0]?.message).toBe(notices[0]?.text)
  })

  it('says nothing when there is no outcome to voice', () => {
    const panel = voicedPanel()
    const schedule = onceSchedule()
    voiceOnceOutcome(fireResult(schedule, 'ran'), schedule, {
      notice: (text) => {
        panel.controller.scheduleNotice(undefined, text)
      },
      attention: (notice) => {
        panel.controller.notifyScheduleOutcome(notice)
      },
    })
    expect(panelNotices(panel.posted)).toHaveLength(0)
    expect(attention).toHaveLength(0)
  })
})
