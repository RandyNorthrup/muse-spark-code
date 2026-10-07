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
import { MHP_PRESENTATION, MHP_PANEL } from '../../../src/shared/constants'
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
  return {
    ...services,
    current,
    views,
    state,
    page,
    binding,
    act,
    record,
    open: async (kind: PresentationState['kind'] = 'plans') => {
      await views.show(page)
      const view = views.view({ ...binding, surfaceKind: kind })
      if (view === undefined) throw new Error('View was not adopted')
      return view
    },
  }
}

describe('assembled auxiliary admission', () => {
  it.each(['reload', 'sequential'])('retires completed IDs for %s actions', async (scenario) => {
    const f = fixture()
    const view = await f.open()
    await view.handle({ type: 'presentationReady' })
    const request = {
      type: 'planAction',
      requestId: 'presentation-1',
      action: 'read',
      fileName: 'plan.md',
    } as const
    await view.handle(request)
    if (scenario === 'reload') {
      await view.handle({ type: 'presentationReady' })
      await view.handle(request)
      expect(f.act).toHaveBeenCalledTimes(2)
    } else {
      for (let index = 0; index < MHP_PANEL.maximumQueuedMessages; index += 1)
        await view.handle({ ...request, requestId: `sequential-${String(index)}` })
      expect(f.act).toHaveBeenCalledTimes(MHP_PANEL.maximumQueuedMessages + 1)
    }
    await f.views.dispose()
  })
  it('publishes accepted manager mutations and admits another unchanged entry', async () => {
    const f = fixture()
    const state = {
      kind: 'manager',
      manager: 'mcp',
      title: 'MCP',
      entries: ['one', 'two'].map((id) => ({
        id,
        title: id,
        detail: 'on',
        actions: [{ id: 'toggle', title: 'Disable' }],
      })),
      actions: [],
    } as const
    f.state.value = presentationStateSchema.parse(state)
    f.act.mockImplementation((request) => {
      if (request.type !== 'managerAction' || f.state.value.kind !== 'manager')
        throw new Error('Wrong manager')
      f.state.value = {
        ...f.state.value,
        entries: f.state.value.entries.map((row) =>
          row.id === request.entryId ? { ...row, detail: 'off' } : row,
        ),
      }
      return Promise.resolve(undefined)
    })
    const view = await f.open('manager')
    const output: PresentationMessage[] = []
    view.subscribe((message) => {
      output.push(presentationMessageSchema.parse(message))
    })
    await view.handle({ type: 'presentationReady' })
    await view.handle({
      type: 'managerAction',
      requestId: 'one',
      entryId: 'one',
      actionId: 'toggle',
    })
    expect(output).toContainEqual({ type: 'presentationState', state: f.state.value })
    await view.handle({
      type: 'managerAction',
      requestId: 'two',
      entryId: 'two',
      actionId: 'toggle',
    })
    expect(f.act).toHaveBeenCalledTimes(2)
    expect(output.at(-1)).toMatchObject({ type: 'presentationResult', result: { ok: true } })
    await f.views.dispose()
  })
  it('allows unrelated plan additions but refuses a changed target record', async () => {
    const f = fixture()
    const view = await f.open()
    await view.handle({ type: 'presentationReady' })
    if (f.state.value.kind !== 'plans') throw new Error('Wrong plans')
    f.state.value = {
      kind: 'plans',
      plans: [
        ...f.state.value.plans,
        { fileName: 'new.md', relativePath: '.agents/plans/new.md', title: 'New' },
      ],
    }
    await view.handle({
      type: 'planAction',
      requestId: 'unchanged',
      action: 'open',
      fileName: 'plan.md',
    })
    expect(f.act).toHaveBeenCalledOnce()
    f.state.value.plans[0] = {
      fileName: 'plan.md',
      relativePath: '.agents/plans/other.md',
      title: 'Replaced',
    }
    await view.handle({
      type: 'planAction',
      requestId: 'changed',
      action: 'open',
      fileName: 'plan.md',
    })
    expect(f.act).toHaveBeenCalledOnce()
    await f.views.dispose()
  })
  it.each(['roles', 'diff'] as const)(
    '%s actions ignore unrelated changes and reject target drift',
    async (kind) => {
      const f = fixture()
      f.state.value =
        kind === 'roles'
          ? {
              kind,
              roles: [
                {
                  id: 'role',
                  name: 'Role',
                  providerId: 'provider',
                  modelId: 'model',
                  status: 'working',
                  capabilities: [],
                },
              ],
              traffic: [],
            }
          : {
              kind,
              reviewId: 'review',
              title: 'Diff',
              hunks: [
                {
                  id: 'hunk',
                  uri: 'file:///workspace/source.ts',
                  expectedVersion: 1,
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                  before: 'old',
                  after: 'new',
                },
              ],
            }
      const view = await f.open(kind)
      await view.handle({ type: 'presentationReady' })
      f.state.value =
        f.state.value.kind === 'roles'
          ? {
              ...f.state.value,
              traffic: [
                {
                  id: 'traffic',
                  sourceId: 'peer',
                  targetId: 'role',
                  at: 1,
                  summary: 'New traffic',
                },
              ],
            }
          : { ...f.state.value, title: 'New title' }
      const request =
        kind === 'roles'
          ? ({ type: 'openRole', requestId: 'unchanged', roleId: 'role' } as const)
          : ({
              type: 'diffDecision',
              requestId: 'unchanged',
              reviewId: 'review',
              hunkId: 'hunk',
              decision: 'accept',
            } as const)
      await view.handle(request)
      expect(f.act).toHaveBeenCalledOnce()
      f.state.value =
        f.state.value.kind === 'roles'
          ? {
              ...f.state.value,
              roles: f.state.value.roles.map((row) => ({ ...row, modelId: 'replacement' })),
            }
          : {
              ...f.state.value,
              hunks: f.state.value.hunks.map((row) => ({ ...row, expectedVersion: 2 })),
            }
      await view.handle({ ...request, requestId: 'changed' })
      expect(f.act).toHaveBeenCalledOnce()
      await f.views.dispose()
    },
  )
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
