import { MHP_PANEL } from '../../shared/constants'
import {
  presentationRequestSchema,
  presentationStateSchema,
  presentationMessageSchema,
  type PresentationState,
  type PresentationRequest,
  type PresentationMessage,
} from '../../shared/presentationProtocol'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import type {
  RuntimeFeatureContext,
  RuntimePresentationContribution,
  RuntimeConversationPorts,
} from './runtimeFeatures'
import type { PanelView } from './surfaces'
import { redactSecrets } from '../../core/redact'

type Action = Extract<PresentationRequest, { readonly requestId: string }>
export interface RuntimePresentationPage {
  readState(): Promise<PresentationState>
  /** Resolve only after actual engine/native acceptance. Browser supplies current record IDs only. */
  act(request: Action, state: PresentationState, signal: AbortSignal): Promise<string | undefined>
}
interface Page {
  readonly binding: MhpPanelBinding
  readonly source: RuntimePresentationPage
  readonly ending: AbortController
  readonly listeners: Set<(message: PresentationMessage) => void>
  readonly requests: Set<string>
  state: PresentationState | undefined
}

function indexedRecord(request: Action, state: PresentationState): unknown {
  switch (request.type) {
    case 'planAction': {
      return state.kind === 'plans'
        ? state.plans.find((row) => row.fileName === request.fileName)
        : undefined
    }
    case 'managerAction': {
      if (state.kind !== 'manager') return
      const entry = state.entries.find((row) => row.id === request.entryId)
      const action = (request.entryId === undefined ? state.actions : entry?.actions)?.find(
        (row) => row.id === request.actionId,
      )
      return action === undefined ? undefined : { manager: state.manager, entry, action }
    }
    case 'openRole': {
      return state.kind === 'roles'
        ? state.roles.find((row) => row.id === request.roleId)
        : undefined
    }
    case 'diffDecision': {
      return state.kind === 'diff' && state.reviewId === request.reviewId
        ? state.hunks.find((row) => String(row.id) === request.hunkId)
        : undefined
    }
    case 'walkthroughAction': {
      return state.kind === 'walkthrough'
        ? state.steps.find((row) => row.id === request.stepId)
        : undefined
    }
  }
}
function surfaceKind(state: PresentationState): PresentationState['kind'] {
  return state.kind
}

/** Immutable session/surface ownership for C's pages and Promise-returning engine actions. */
export class RuntimePresentationViews {
  private readonly pages = new Map<string, Page>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly acquired = new Set<string>()
  private ending = new AbortController()
  private closing: Promise<void> | undefined
  public constructor(
    private readonly context: Pick<RuntimeFeatureContext, 'sessionId'> & {
      readonly ports: Pick<RuntimeConversationPorts, 'host' | 'log' | 'surface'>
    },
    private readonly recordError?: (code: string) => void,
  ) {}

  private current(page: Page): void {
    this.ending.signal.throwIfAborted()
    page.ending.signal.throwIfAborted()
    if (
      page.binding.sessionId !==
        (this.context.sessionId?.() ??
          this.context.ports.surface.takeRestoredSessionId() ??
          this.context.ports.surface.id) ||
      this.pages.get(page.binding.surface) !== page
    )
      throw new Error('MHP_PANEL_UNKNOWN_SURFACE')
  }
  private post(page: Page, message: PresentationMessage): void {
    this.current(page)
    const parsed = presentationMessageSchema.parse(message)
    for (const listener of page.listeners) listener(parsed)
  }
  private async state(page: Page): Promise<void> {
    const state = presentationStateSchema.parse(await page.source.readState())
    this.current(page)
    if (surfaceKind(state) !== page.binding.surfaceKind)
      throw new Error('MHP_PRESENTATION_KIND_CHANGED')
    if (state.kind === 'roles')
      for (const traffic of state.traffic) traffic.summary = redactSecrets(traffic.summary)
    page.state = state
    this.post(page, { type: 'presentationState', state })
  }
  private async handle(page: Page, raw: unknown): Promise<void> {
    this.current(page)
    const request = presentationRequestSchema.parse(raw)
    if (request.type === 'presentationReady' || request.type === 'presentationReload') {
      await this.state(page)
      return
    }
    if (request.type === 'presentationError') {
      this.context.ports.log.warn(request.code)
      this.recordError?.(request.code)
      return
    }
    if (
      page.requests.has(request.requestId) ||
      page.requests.size >= MHP_PANEL.maximumQueuedMessages
    )
      throw new Error('MHP_PRESENTATION_REQUEST_REFUSED')
    page.requests.add(request.requestId)
    const state = page.state
    try {
      const record = state === undefined ? undefined : indexedRecord(request, state)
      if (record === undefined) throw new Error('MHP_PRESENTATION_INVALID_INDEX')
      const fresh = presentationStateSchema.parse(await page.source.readState())
      if (fresh.kind === 'roles')
        for (const traffic of fresh.traffic) traffic.summary = redactSecrets(traffic.summary)
      this.current(page)
      // Resolve against the current authoritative record, including hunk versions/text.
      const currentRecord = indexedRecord(request, fresh)
      if (currentRecord === undefined || JSON.stringify(currentRecord) !== JSON.stringify(record))
        throw new Error('MHP_PRESENTATION_STATE_CHANGED')
      const text = await page.source.act(
        request,
        fresh,
        AbortSignal.any([page.ending.signal, this.ending.signal]),
      )
      this.current(page)
      await this.state(page)
      this.post(page, {
        type: 'presentationResult',
        requestId: request.requestId,
        result: { ok: true, ...(text !== undefined && { text }) },
      })
    } catch {
      if (
        !this.ending.signal.aborted &&
        !page.ending.signal.aborted &&
        page.binding.sessionId ===
          (this.context.sessionId?.() ??
            this.context.ports.surface.takeRestoredSessionId() ??
            this.context.ports.surface.id)
      )
        this.post(page, {
          type: 'presentationResult',
          requestId: request.requestId,
          result: { ok: false, code: 'MHP_PRESENTATION_ACTION_FAILED' },
        })
    } finally {
      page.requests.delete(request.requestId)
    }
  }
  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.ending.signal.throwIfAborted()
    const running = work()
    this.pending.add(running)
    try {
      return await running
    } finally {
      this.pending.delete(running)
    }
  }
  public show(source: RuntimePresentationPage): Promise<void> {
    return this.track(async () => {
      const sessionId =
        this.context.sessionId?.() ??
        this.context.ports.surface.takeRestoredSessionId() ??
        this.context.ports.surface.id
      const state = presentationStateSchema.parse(await source.readState())
      this.ending.signal.throwIfAborted()
      if (
        sessionId !==
        (this.context.sessionId?.() ??
          this.context.ports.surface.takeRestoredSessionId() ??
          this.context.ports.surface.id)
      )
        throw new Error('MHP_PRESENTATION_SESSION_CHANGED')
      const opened = await this.context.ports.host.request(
        'surfaces/open',
        { kind: surfaceKind(state), sessionId, placement: 'tab' },
        this.ending.signal,
      )
      const id = String(opened.surfaceId)
      this.acquired.add(id)
      if (
        this.ending.signal.aborted ||
        sessionId !==
          (this.context.sessionId?.() ??
            this.context.ports.surface.takeRestoredSessionId() ??
            this.context.ports.surface.id)
      ) {
        await this.context.ports.host.request('surfaces/close', { surfaceId: opened.surfaceId })
        this.acquired.delete(id)
        throw new Error('MHP_PRESENTATION_SESSION_CHANGED')
      }
      if (this.pages.has(id)) throw new Error('MHP_PRESENTATION_DUPLICATE_SURFACE')
      this.pages.set(id, {
        binding: { surface: id, surfaceKind: surfaceKind(state), sessionId },
        source,
        ending: new AbortController(),
        listeners: new Set(),
        requests: new Set(),
        state: undefined,
      })
    })
  }
  public closed(id: string): void {
    const page = this.pages.get(id)
    page?.ending.abort()
    page?.listeners.clear()
    this.pages.delete(id)
    this.acquired.delete(id)
  }
  public view(binding: MhpPanelBinding): PanelView | undefined {
    const page = this.pages.get(binding.surface)
    if (
      binding.sessionId !== page?.binding.sessionId ||
      binding.surfaceKind !== page.binding.surfaceKind
    )
      return
    try {
      this.current(page)
    } catch {
      return
    }
    return {
      handle: (message) => this.track(() => this.handle(page, message)),
      subscribe: (listener) => {
        this.current(page)
        page.listeners.add(listener)
        return () => {
          page.listeners.delete(listener)
        }
      },
    }
  }
  public contribution(
    actions: RuntimePresentationContribution['actions'],
  ): RuntimePresentationContribution {
    return {
      features: {},
      ...(actions !== undefined && { actions }),
      view: (binding) => this.view(binding),
      dispose: () => this.dispose(),
    }
  }
  public dispose(): Promise<void> {
    this.ending.abort()
    for (const page of this.pages.values()) page.ending.abort()
    this.closing ??= (async () => {
      await Promise.allSettled(this.pending)
      const closed = await Promise.allSettled(
        [...this.acquired].map(async (surfaceId) => {
          await this.context.ports.host.request('surfaces/close', { surfaceId })
          this.closed(surfaceId)
        }),
      )
      if (closed.some((result) => result.status === 'rejected'))
        throw new Error('MHP_PRESENTATION_CLOSE_FAILED')
    })()
    return this.closing
  }
}
