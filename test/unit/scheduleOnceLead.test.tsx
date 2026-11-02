// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 15): a timed send reads in the person's
// own time, in whole minutes, at the earliest a minute ahead. The picker
// guides, and the save says why a sooner send cannot go.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSchedulesBridge } from '../../src/host/schedules/schedulesBridge'
import { TIMED_SEND_MIN_LEAD_MS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { ceilToMinuteMs } from '../../src/shared/resumeOffer'
import type { ScheduleDraft, ScheduleRequest } from '../../src/shared/scheduleV2'
import { ScheduleEditor } from '../../src/webview/schedules/ScheduleEditor'
import type { ScheduleSurfacePort } from '../../src/webview/schedules/ports'
import { TriggerFields, timeTrigger } from '../../src/webview/schedules/TriggerFields'

const NOW_MS = Date.UTC(2026, 10, 1, 12, 0, 30)
const SESSION = { sessionId: 's1', backend: 'modelApi' as const, label: 'Test chat' }

function bridge() {
  return createSchedulesBridge({
    distDir: import.meta.dirname,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    isEnabled: () => true,
    defaultDelivery: () => 'whenIdle',
    pauseAfterFailures: () => 3,
  })
}

function failPort(): never {
  throw new Error('the refused save never reaches the runtime')
}

function unusedPort(): ScheduleSurfacePort {
  return { request: () => failPort(), preview: () => failPort() }
}

describe('once trigger lead', () => {
  it('lands a new once trigger on a valid whole minute, never now', () => {
    expect(timeTrigger('once', NOW_MS, 'UTC')).toEqual({
      kind: 'once',
      atMs: ceilToMinuteMs(NOW_MS + TIMED_SEND_MIN_LEAD_MS),
    })
  })

  it('reads the once moment in local time and rounds up to the minute', () => {
    const seen: number[] = []
    render(
      <TriggerFields
        trigger={{ kind: 'once', atMs: NOW_MS }}
        nowMs={NOW_MS}
        zone="UTC"
        sources={[]}
        onChange={(next) => {
          if (next.kind === 'once') seen.push(next.atMs)
        }}
        onValid={() => undefined}
      />,
    )
    const input = screen.getByLabelText(UI_TEXT.scheduleV2.editor.dateTimeLocal)
    if (!(input instanceof HTMLInputElement)) throw new TypeError('no once input rendered')
    // The picker's floor is a minute ahead, as local text.
    const floor = Date.parse(input.min)
    expect(floor).toBe(ceilToMinuteMs(NOW_MS + TIMED_SEND_MIN_LEAD_MS))
    // A local afternoon reads back as that local afternoon, on the minute.
    fireEvent.change(input, { target: { value: '2026-11-01T12:02' } })
    expect(seen).toEqual([new Date(2026, 10, 1, 12, 2).getTime()])
    // Typed seconds round up to the next whole minute.
    fireEvent.change(input, { target: { value: '2026-11-01T12:02:30' } })
    expect(seen).toEqual([
      new Date(2026, 10, 1, 12, 2).getTime(),
      new Date(2026, 10, 1, 12, 3).getTime(),
    ])
  })

  it('refuses a save less than a minute ahead, in words, saving nothing', () => {
    const live = bridge()
    const saved: ScheduleRequest[] = []
    const draft: ScheduleDraft = {
      ...live.defaultDraft(NOW_MS, SESSION, 'modelApi'),
      trigger: { kind: 'once', atMs: NOW_MS },
    }
    render(
      <ScheduleEditor
        context={{
          port: unusedPort(),
          workspaceKey: 'test',
          targets: [...live.targets(SESSION)],
          defaultDraft: draft,
          nowMs: NOW_MS,
        }}
        schedule={undefined}
        sources={[]}
        busy={false}
        onSave={(request) => {
          saved.push(request)
        }}
        onClose={() => undefined}
      />,
    )
    // Past the picker's own floor (a save after clock drift reaches the
    // same place): the editor refuses in its own words and saves nothing.
    const form = screen
      .getByRole('button', { name: UI_TEXT.scheduleV2.labels.save })
      .closest('form')
    if (form === null) throw new TypeError('no schedule form rendered')
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toBe(UI_TEXT.scheduleV2.editor.onceTooSoon)
    expect(saved).toHaveLength(0)
  })

  it('saves a once trigger a minute ahead and beyond', () => {
    const live = bridge()
    const saved: ScheduleRequest[] = []
    const atMs = ceilToMinuteMs(NOW_MS + TIMED_SEND_MIN_LEAD_MS)
    const draft: ScheduleDraft = {
      ...live.defaultDraft(NOW_MS, SESSION, 'modelApi'),
      trigger: { kind: 'once', atMs },
    }
    render(
      <ScheduleEditor
        context={{
          port: unusedPort(),
          workspaceKey: 'test',
          targets: [...live.targets(SESSION)],
          defaultDraft: draft,
          nowMs: NOW_MS,
        }}
        schedule={undefined}
        sources={[]}
        busy={false}
        onSave={(request) => {
          saved.push(request)
        }}
        onClose={() => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.scheduleV2.labels.save }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ method: 'schedules/create' })
  })
})
