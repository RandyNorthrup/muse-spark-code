import { describe, expect, it } from 'vitest'
import { parseLoopPrompt } from '../../src/core/backends/modelapi/schedules'
import { SCHEDULE_LIFETIME_MS } from '../../src/shared/constants'
import { draftOf } from '../../src/webview/schedules/ScheduleEditor'
import { schedulePromptAction } from '../../src/webview/schedules/prompt'
import { fakeSchedule } from './helpers/schedules/fixtures'

function action(text: string) {
  const schedule = fakeSchedule()
  return schedulePromptAction(
    text,
    schedule.workspaceKey,
    draftOf(schedule),
    schedule.createdAtMs,
    parseLoopPrompt,
  )
}
describe('M115 schedule and loop prompt entry', () => {
  it('refuses a malformed creation draft instead of opening the editor as a valid schedule', () => {
    const schedule = fakeSchedule()
    expect(
      schedulePromptAction(
        '/schedule add',
        schedule.workspaceKey,
        { ...draftOf(schedule), zone: 'bad/zone' },
        schedule.createdAtMs,
        parseLoopPrompt,
      ),
    ).toMatchObject({ kind: 'refused' })
  })
  it('keeps ordinary prompts ordinary and opens the list, timeline or editor locally', () => {
    expect(action('Explain /schedule')).toBeUndefined()
    expect(action('/scheduler')).toBeUndefined()
    expect(action('/schedule')).toEqual({ kind: 'open', view: 'list' })
    expect(action('/schedule list')).toEqual({ kind: 'open', view: 'list' })
    expect(action('/schedule timeline')).toEqual({ kind: 'open', view: 'timeline' })
    expect(action('/schedule add')).toMatchObject({ kind: 'open', view: 'editor' })
    expect(action('/schedule add Check the build')).toMatchObject({
      kind: 'open',
      view: 'editor',
      draft: { action: { kind: 'prompt', prompt: 'Check the build' }, trigger: { kind: 'once' } },
    })
  })
  it.each(['remove', 'run-now', 'pause', 'resume', 'fire'])(
    'routes %s through validated shared requests',
    (verb) => {
      const result = action(`/schedule ${verb} schedule-1`)
      expect(result).toMatchObject({
        kind: 'request',
        request: { workspaceKey: 'workspace-1', id: 'schedule-1' },
      })
      expect(action(`/schedule ${verb} ../escape`)).toMatchObject({ kind: 'refused' })
      expect(action(`/schedule ${verb} schedule-1 extra`)).toMatchObject({ kind: 'refused' })
    },
  )
  it('retains interval and cron loop grammar and its seven-day end while opening the editor for consent', () => {
    const schedule = fakeSchedule()
    expect(action('/loop 2m Read tests')).toMatchObject({
      kind: 'open',
      view: 'editor',
      draft: {
        trigger: { kind: 'interval', everyMs: 120_000, anchorMs: schedule.createdAtMs + 120_000 },
        end: { atMs: schedule.createdAtMs + SCHEDULE_LIFETIME_MS },
      },
    })
    expect(action('/loop "0 9 * * 1" Check CI')).toMatchObject({
      kind: 'open',
      view: 'editor',
      draft: { trigger: { kind: 'cron', expression: '0 9 * * 1' } },
    })
    expect(action('/loop list')).toEqual({ kind: 'open', view: 'list' })
    expect(action('/loop cancel schedule-1')).toMatchObject({
      kind: 'request',
      request: { method: 'schedules/remove', id: 'schedule-1' },
    })
    expect(action('/loop 0m Nope')).toMatchObject({ kind: 'refused' })
    expect(action('/schedule unknown')).toMatchObject({ kind: 'refused' })
  })
})
