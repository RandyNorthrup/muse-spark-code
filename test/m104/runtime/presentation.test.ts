import { describe, expect, it, vi } from 'vitest'
import {
  RuntimePresentationViews,
  type RuntimePresentationPage,
} from '../../../src/runtime/panel/presentationViews'
import {
  presentationStateSchema,
  presentationMessageSchema,
  type PresentationMessage,
  type PresentationState,
} from '../../../src/shared/presentationProtocol'
import { MHP_PRESENTATION } from '../../../src/shared/constants'
import { fakeSurface } from '../../unit/helpers/fakes'
import { fakeServices, holdSurfaceOpen } from '../ui/services'

function fixture() {
  const services = fakeServices()
  const current = { session: 'one' }
  const record = vi.fn()
  const views = new RuntimePresentationViews(
    {
      sessionId: () => current.session,
      ports: { host: services.host, log: services.log, surface: fakeSurface('one') },
    },
    record,
  )
  const state: { value: PresentationState } = {
    value: {
      kind: 'plans',
      plans: [{ fileName: 'plan.md', relativePath: '.agents/plans/plan.md', title: 'Actual plan' }],
    },
  }
  const act = vi.fn<RuntimePresentationPage['act']>(() => Promise.resolve('Exact saved text'))
  const page = { readState: () => Promise.resolve(state.value), act }
  const binding = { surface: 'surface-1', surfaceKind: 'plans', sessionId: 'one' } as const
  return { ...services, current, views, state, page, binding, act, record }
}

describe('assembled auxiliary admission', () => {
  it('acknowledges accepted exact reads and refuses removed or unindexed records', async () => {
    const f = fixture()
    const output: unknown[] = []
    await f.views.show(f.page)
    const view = f.views.view(f.binding)
    if (view === undefined) throw new Error('View was not adopted')
    const unsubscribe = view.subscribe((message) => {
      output.push(presentationMessageSchema.parse(message))
    })
    await view.handle({ type: 'presentationReady' })
    await view.handle({
      type: 'planAction',
      requestId: 'read',
      action: 'read',
      fileName: 'plan.md',
    })
    expect(output.at(-1)).toEqual({
      type: 'presentationResult',
      requestId: 'read',
      result: { ok: true, text: 'Exact saved text' },
    })
    await view.handle({
      type: 'planAction',
      requestId: 'foreign',
      action: 'read',
      fileName: '../../outside.md',
    })
    expect(f.act).toHaveBeenCalledOnce()
    f.state.value = { kind: 'plans', plans: [] }
    await view.handle({
      type: 'planAction',
      requestId: 'removed',
      action: 'open',
      fileName: 'plan.md',
    })
    expect(f.act).toHaveBeenCalledOnce()
    expect(output.at(-1)).toEqual({
      type: 'presentationResult',
      requestId: 'removed',
      result: { ok: false, code: 'MHP_PRESENTATION_ACTION_FAILED' },
    })
    await view.handle({ type: 'presentationError', code: 'MHP_PRESENTATION_RENDER_FAILED' })
    expect(f.record).toHaveBeenCalledExactlyOnceWith('MHP_PRESENTATION_RENDER_FAILED')
    unsubscribe()
    await f.views.dispose()
  })
  it('waits for engine acceptance, suppresses retired results and rejects a duplicate request', async () => {
    const f = fixture()
    await f.views.show(f.page)
    const view = f.views.view(f.binding)
    if (view === undefined) throw new Error('View was not adopted')
    const output: unknown[] = []
    view.subscribe((message) => {
      output.push(presentationMessageSchema.parse(message))
    })
    await view.handle({ type: 'presentationReady' })
    const pending = Promise.withResolvers<string>()
    f.act.mockImplementationOnce(() => pending.promise)
    const request = {
      type: 'planAction',
      requestId: 'pending',
      action: 'read',
      fileName: 'plan.md',
    } as const
    const action = view.handle(request)
    await vi.waitFor(() => {
      expect(f.act).toHaveBeenCalledOnce()
    })
    expect(
      output.filter(
        (message) => typeof message === 'object' && message !== null && 'requestId' in message,
      ),
    ).toEqual([])
    await expect(view.handle(request)).rejects.toThrow('MHP_PRESENTATION_REQUEST_REFUSED')
    f.current.session = 'two'
    expect(f.views.view(f.binding)).toBeUndefined()
    expect(f.views.view({ ...f.binding, sessionId: 'two' })).toBeUndefined()
    pending.resolve('Old result')
    await action
    expect(output).toHaveLength(1)
    const release = f.views.dispose()
    expect(f.views.dispose()).toBe(release)
    await release
  })
  it('closes an acquisition returned after owner retirement without publishing it', async () => {
    const f = fixture()
    const open = holdSurfaceOpen(f.responses)
    const opening = expect(f.views.show(f.page)).rejects.toThrow('MHP_PRESENTATION_SESSION_CHANGED')
    await vi.waitFor(() => {
      expect(f.requests.at(-1)?.method).toBe('surfaces/open')
    })
    const releasing = f.views.dispose()
    open.resolve({ surfaceId: 'late' })
    await opening
    await releasing
    expect(f.views.view({ ...f.binding, surface: 'late' })).toBeUndefined()
    expect(f.requests.at(-1)).toEqual({ method: 'surfaces/close', params: { surfaceId: 'late' } })
  })
  it('preserves unknown peers/status and scrubs traffic before both publication and index checks', async () => {
    const f = fixture()
    f.state.value = {
      kind: 'roles',
      roles: [
        {
          id: 'actual',
          name: 'Worker',
          providerId: 'verified',
          modelId: 'captured',
          status: 'future-status',
          capabilities: ['tools'],
        },
      ],
      traffic: [
        {
          id: 'message',
          sourceId: 'unknown-peer',
          targetId: 'actual',
          at: 1,
          summary: 'LLM|1|fake-private-token',
        },
      ],
    }
    await f.views.show(f.page)
    const view = f.views.view({ ...f.binding, surfaceKind: 'roles' })
    if (view === undefined) throw new Error('View was not adopted')
    const output: PresentationMessage[] = []
    view.subscribe((message) => {
      output.push(presentationMessageSchema.parse(message))
    })
    await view.handle({ type: 'presentationReady' })
    const published = output[0]
    expect(published?.type).toBe('presentationState')
    expect(JSON.stringify(published)).toContain('future-status')
    expect(JSON.stringify(published)).toContain('unknown-peer')
    expect(JSON.stringify(published)).not.toContain('fake-private-token')
    await view.handle({ type: 'openRole', requestId: 'open', roleId: 'actual' })
    expect(f.act).toHaveBeenCalledOnce()
    await f.views.dispose()
  })
})

it('bounds authored role dates, IDs and collections while retaining unknown statuses', () => {
  const role = {
    id: 'role',
    name: 'Role',
    providerId: 'provider',
    modelId: 'model',
    status: 'new',
    capabilities: [],
  }
  const traffic = {
    id: 'message',
    sourceId: 'unknown',
    targetId: 'role',
    at: MHP_PRESENTATION.maximumDateMs,
    summary: 'Summary',
  }
  expect(
    presentationStateSchema.safeParse({ kind: 'roles', roles: [role], traffic: [traffic] }).success,
  ).toBe(true)
  for (const at of [NaN, Infinity, -1, MHP_PRESENTATION.maximumDateMs + 1])
    expect(
      presentationStateSchema.safeParse({
        kind: 'roles',
        roles: [role],
        traffic: [{ ...traffic, at }],
      }).success,
    ).toBe(false)
  expect(
    presentationStateSchema.safeParse({ kind: 'roles', roles: [{ ...role, id: '' }], traffic: [] })
      .success,
  ).toBe(false)
  expect(
    presentationStateSchema.safeParse({
      kind: 'roles',
      roles: [{ ...role, id: 'x'.repeat(MHP_PRESENTATION.maximumIdChars + 1) }],
      traffic: [],
    }).success,
  ).toBe(false)
  expect(
    presentationStateSchema.safeParse({
      kind: 'roles',
      roles: [role],
      traffic: [{ ...traffic, summary: 'x'.repeat(MHP_PRESENTATION.maximumTextChars + 1) }],
    }).success,
  ).toBe(false)
  expect(
    presentationStateSchema.safeParse({
      kind: 'roles',
      roles: Array.from({ length: MHP_PRESENTATION.maximumRecords + 1 }, () => role),
      traffic: [],
    }).success,
  ).toBe(false)
})
