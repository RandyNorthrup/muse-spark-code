import { describe, expect, it, vi } from 'vitest'
import { ScheduleSurface } from '../../src/runtime/schedules/surface'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { SCHEDULE_PROTOCOL_VERSION, UI_TEXT } from '../../src/shared/constants'
import { scheduleViewV2Of } from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { fakeScheduleDraft, transientBackgroundConsent } from './helpers/schedules/runtimeFixtures'
import type { ScheduleCallerContext } from '../../src/runtime/schedules/args'
import { unsafeScheduleLauncher } from '../../src/runtime/schedules/registration'

const CWD = '/workspace/schedules',
  KEY = workspaceKey(CWD)
function setup(caller?: ScheduleCallerContext) {
  const entry = new FakeScheduleBackground()
  const background = new ScheduleBackgroundCoordinator({
    entry,
    consent: transientBackgroundConsent(),
    now: () => 1000,
    nextWakeAtMs: () => Promise.resolve(2000),
  })
  const request = vi.fn().mockResolvedValue({
    kind: 'list',
    schedules: [scheduleViewV2Of(fakeSchedule({ workspaceKey: KEY }))],
  })
  const askBackground = vi.fn().mockResolvedValue({ choice: 'notNow', decidedAtMs: 1000 }),
    notice = vi.fn()
  return {
    surface: new ScheduleSurface({
      request,
      background,
      askBackground,
      notice,
      ...(caller !== undefined && { caller: () => caller }),
    }),
    entry,
    background,
    request,
    askBackground,
    notice,
  }
}
async function responseOf(surface: ScheduleSurface, input: unknown) {
  const { response } = await surface.message(input, CWD)
  return response
}
const frame = (request: unknown) => ({
  type: 'schedulesRequest',
  version: SCHEDULE_PROTOCOL_VERSION,
  requestId: 'request-1',
  request,
})
describe('shared schedules channel', () => {
  it('names the unsafe launcher path in background failures without losing a committed creation id', async () => {
    const { surface, request, background, notice } = setup()
    const failure = unsafeScheduleLauncher('/unsafe/ancestor')
    vi.spyOn(background, 'reconcile').mockRejectedValue(failure)
    request.mockResolvedValue({ kind: 'accepted', id: 'committed-1' })
    expect(
      await surface.request(
        { method: 'schedules/create', workspaceKey: KEY, draft: fakeScheduleDraft() },
        KEY,
      ),
    ).toEqual({ kind: 'accepted', id: 'committed-1' })
    expect(notice).toHaveBeenCalledWith(failure.message)
    vi.spyOn(background, 'decide').mockRejectedValue(failure)
    expect(
      await surface.request(
        { method: 'schedules/background', consent: { choice: 'yes', decidedAtMs: 1000 } },
        KEY,
      ),
    ).toEqual({ kind: 'refused', reason: failure.message })
  })
  it('uses the same paid admission for interactive editor requests and forwards trusted host context', async () => {
    const value = fakeScheduleDraft()
    const draft = { ...value, paidCapUsd: 1, grant: { ...value.grant, paidCapUsd: 1 } }
    const request = frame({ method: 'schedules/create', workspaceKey: KEY, draft })
    for (const authorization of [
      { scheduledPrompts: false, maxBudgetUsd: 1 },
      { scheduledPrompts: true },
      { scheduledPrompts: true, maxBudgetUsd: NaN },
    ]) {
      const s = setup({ source: 'interactive', isInteractive: true, ...authorization })
      expect(await responseOf(s.surface, request)).toEqual({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
      })
      expect(s.request).not.toHaveBeenCalled()
    }
    const caller = {
      source: 'interactive' as const,
      isInteractive: true,
      scheduledPrompts: true,
      maxBudgetUsd: 1,
    }
    const s = setup(caller)
    s.request.mockResolvedValue({ kind: 'accepted', id: 'paid-1' })
    expect(await responseOf(s.surface, request)).toEqual({ kind: 'accepted', id: 'paid-1' })
    expect(s.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'schedules/create' }),
      caller,
    )
    expect(s.askBackground).toHaveBeenCalledOnce()
  })
  it.each(['companion', 'JCEF', 'WebView2', 'SWT', 'TUI', 'desktop'])(
    'preserves the version and request id on the %s fake bridge',
    async () => {
      const { surface, request } = setup()
      // The fake transport roundtrips JSON exactly as these bridges do.
      const transportText = JSON.stringify(frame({ method: 'schedules/list', workspaceKey: KEY }))
      const incoming: unknown = JSON.parse(transportText)
      const outgoing = await surface.message(incoming, CWD)
      expect(outgoing).toMatchObject({
        type: 'schedulesResponse',
        version: 1,
        requestId: 'request-1',
        response: { kind: 'list' },
      })
      expect(request).toHaveBeenCalledWith({ method: 'schedules/list', workspaceKey: KEY })
    },
  )
  it('rejects missing/unsupported envelope versions, unknown fields and invalid payloads before calling the engine', async () => {
    const { surface, request } = setup()
    const valid = frame({ method: 'schedules/list', workspaceKey: KEY })
    for (const invalid of [
      { ...valid, version: undefined },
      { ...valid, version: 2 },
      { ...valid, extra: 'unparsed' },
      { ...valid, requestId: '' },
      frame({ method: 'schedules/remove', workspaceKey: KEY, id: '../outside' }),
    ])
      await expect(surface.message(invalid, CWD)).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.invalidRequest,
      )
    expect(request).not.toHaveBeenCalled()
    expect(await surface.request({ method: 'schedules/unknown' }, KEY)).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.invalidRequest,
    })
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses cross-workspace requests and responses without leaking other schedules', async () => {
    const { surface, request } = setup()
    expect(
      await responseOf(surface, frame({ method: 'schedules/list', workspaceKey: 'other' })),
    ).toEqual({ kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidRequest })
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValue({ kind: 'list', schedules: [scheduleViewV2Of(fakeSchedule())] })
    expect(
      await responseOf(surface, frame({ method: 'schedules/list', workspaceKey: KEY })),
    ).toEqual({ kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidResponse })
  })
  it('keeps revision CAS and grants intact and refuses mismatched or malformed results', async () => {
    const { surface, request, entry } = setup(),
      value = fakeScheduleDraft()
    request.mockResolvedValue({ kind: 'refused', reason: 'Stale revision' })
    const update = {
      method: 'schedules/update',
      workspaceKey: KEY,
      id: 'schedule-1',
      revision: 0,
      draft: value,
    }
    expect(await responseOf(surface, frame(update))).toEqual({
      kind: 'refused',
      reason: 'Stale revision',
    })
    expect(request).toHaveBeenCalledWith(update)
    request.mockResolvedValue({ kind: 'accepted', extra: 'unparsed' })
    expect(await responseOf(surface, frame(update))).toMatchObject({ kind: 'refused' })
    request.mockResolvedValue({ kind: 'accepted' })
    const remove = vi.spyOn(entry, 'remove')
    expect(
      await responseOf(surface, frame({ method: 'schedules/list', workspaceKey: KEY })),
    ).toEqual({ kind: 'refused', reason: UI_TEXT.scheduleV2.runtime.invalidResponse })
    expect(remove).not.toHaveBeenCalled()
    request.mockResolvedValue({ kind: 'accepted', id: 'other' })
    expect(await responseOf(surface, frame(update))).toMatchObject({ kind: 'refused' })
  })
  it('carries timelines, grant audits, source capabilities and history with request identity intact', async () => {
    const { surface, request } = setup()
    const trigger = { kind: 'event', source: 'manual', event: 'manual', conditions: [] },
      range = { fromMs: 1000, toMs: 2000 }
    const rows = [
      {
        input: { method: 'schedules/timeline', workspaceKey: KEY, hours: 24 },
        response: { kind: 'timeline', entries: [] },
      },
      {
        input: { method: 'schedules/grantAudit', workspaceKey: KEY, id: 'schedule-1' },
        response: {
          kind: 'grantAudit',
          scheduleId: 'schedule-1',
          entries: [{ scheduleId: 'schedule-1', atMs: 1000, kind: 'revoked' }],
        },
      },
      {
        input: { method: 'schedules/eventSources', workspaceKey: KEY },
        response: {
          kind: 'eventSources',
          sources: [
            {
              id: 'github',
              kinds: ['pullRequestMerged'],
              capability: { available: false, reason: 'No repository connection' },
            },
          ],
        },
      },
      {
        input: { method: 'schedules/historyPreview', workspaceKey: KEY, trigger, range },
        response: {
          kind: 'historyPreview',
          trigger,
          range,
          preview: {
            available: true,
            matchedCount: 1,
            events: [
              {
                source: 'manual',
                eventKey: 'event-1',
                kind: 'manual',
                observedAt: 1500,
                fields: { status: 'ready' },
              },
            ],
          },
        },
      },
    ]
    for (const row of rows) {
      request.mockResolvedValue(row.response)
      expect(await responseOf(surface, frame(row.input))).toEqual(row.response)
      expect(request).toHaveBeenLastCalledWith(row.input)
    }
    request.mockResolvedValue({ ...rows[1]!.response, scheduleId: 'other' })
    expect(await responseOf(surface, frame(rows[1]!.input))).toMatchObject({ kind: 'refused' })
    request.mockResolvedValue({
      ...rows[1]!.response,
      entries: [{ scheduleId: 'other', atMs: 1000, kind: 'revoked' }],
    })
    expect(await responseOf(surface, frame(rows[1]!.input))).toMatchObject({ kind: 'refused' })
    request.mockResolvedValue({ ...rows[3]!.response, range: { fromMs: 1000, toMs: 3000 } })
    expect(await responseOf(surface, frame(rows[3]!.input))).toMatchObject({ kind: 'refused' })
    request.mockResolvedValue({
      ...rows[3]!.response,
      trigger: { ...trigger, event: 'filesChanged' },
    })
    expect(await responseOf(surface, frame(rows[3]!.input))).toMatchObject({ kind: 'refused' })
  })
  it('asks the optional background question only after creation admission, and retains a committed id on background failure', async () => {
    const { surface, request, askBackground, notice } = setup()
    const create = frame({
      method: 'schedules/create',
      workspaceKey: KEY,
      draft: fakeScheduleDraft(),
    })
    request.mockResolvedValue({ kind: 'refused', reason: 'No schedule consent' })
    await surface.message(create, CWD)
    expect(askBackground).not.toHaveBeenCalled()
    request.mockResolvedValue({ kind: 'accepted', id: 'schedule-1' })
    askBackground.mockRejectedValue(new Error('No interactive host'))
    expect(await responseOf(surface, create)).toEqual({
      kind: 'accepted',
      id: 'schedule-1',
    })
    expect(notice).toHaveBeenCalledWith(UI_TEXT.scheduleV2.runtime.backgroundUnavailable)
    notice.mockImplementation(() => {
      throw new Error('Notification host closed')
    })
    expect(await responseOf(surface, create)).toEqual({ kind: 'accepted', id: 'schedule-1' })
  })
  it('exposes background status, registration and removal to Settings and uninstall without calling the engine', async () => {
    const { surface, entry, request } = setup()
    expect(await responseOf(surface, frame({ method: 'schedules/backgroundStatus' }))).toEqual({
      kind: 'backgroundStatus',
      status: { registered: false },
    })
    expect(
      await responseOf(
        surface,
        frame({ method: 'schedules/background', consent: { choice: 'yes', decidedAtMs: 1000 } }),
      ),
    ).toEqual({ kind: 'accepted' })
    expect(entry.registrations).toEqual([2000])
    expect(await responseOf(surface, frame({ method: 'schedules/backgroundRemove' }))).toEqual({
      kind: 'accepted',
    })
    expect(await entry.status()).toEqual({ registered: false })
    vi.spyOn(entry, 'remove').mockRejectedValue(new Error('OS refused'))
    expect(
      await responseOf(surface, frame({ method: 'schedules/backgroundRemove' })),
    ).toMatchObject({ kind: 'refused' })
    expect(request).not.toHaveBeenCalled()
  })
})
