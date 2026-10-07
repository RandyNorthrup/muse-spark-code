import { WEBVIEW_ROOT_ELEMENT_ID, MHP_PANEL, RUNTIME_PANEL, UI_TEXT } from '../constants'
import {
  presentationMessageSchema,
  presentationRequestSchema,
  type PresentationRequest,
  type PresentationState,
} from '../presentationProtocol'
import { installEmbeddedTable } from '../../webview/installTable'
import { showBridgeFailure } from '../../webview/bridges/failure'
import type { PanelBridge } from '../../webview/bridges/types'
import '../../webview/tokens.css'
import '../../webview/styles.css'
import { createPresentationUi } from '../../webview/presentation/presentationUi'

/** Correlated actions settle only after the owning engine's validated acknowledgement. */
export function mountPresentation(host: PanelBridge, element: Element) {
  let isDisposed = false
  let nextId = 0
  const pending = new Map<
    string,
    {
      resolve: (text: string | undefined) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const send = (value: PresentationRequest) => {
    if (isDisposed) throw new Error('MHP_PRESENTATION_DISPOSED')
    host.post(presentationRequestSchema.parse(value))
  }
  const call = (value: (requestId: string) => PresentationRequest) => {
    if (isDisposed || pending.size >= MHP_PANEL.maximumQueuedMessages)
      return Promise.reject(new Error('MHP_PRESENTATION_UNAVAILABLE'))
    const requestId = `presentation-${String(++nextId)}`
    return new Promise<string | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error('MHP_PRESENTATION_ACTION_FAILED'))
      }, RUNTIME_PANEL.requestTimeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      try {
        send(value(requestId))
      } catch (error: unknown) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error instanceof Error ? error : new Error('MHP_PRESENTATION_ACTION_FAILED'))
      }
    })
  }
  const ui = createPresentationUi(element, {
    onReload: () => {
      send({ type: 'presentationReload' })
    },
    onError: () => {
      send({ type: 'presentationError', code: 'MHP_PRESENTATION_RENDER_FAILED' })
    },
  })
  function show(state: PresentationState): void {
    switch (state.kind) {
      case 'plans': {
        ui.showPlans({
          plans: state.plans,
          onRead: async (fileName) => {
            const text = await call((requestId) => ({
              type: 'planAction',
              requestId,
              action: 'read',
              fileName,
            }))
            if (text === undefined) throw new Error('MHP_PRESENTATION_ACTION_FAILED')
            return text
          },
          onOpen: async (fileName) => {
            await call((requestId) => ({ type: 'planAction', requestId, action: 'open', fileName }))
          },
          onImplement: async (fileName) => {
            await call((requestId) => ({
              type: 'planAction',
              requestId,
              action: 'implement',
              fileName,
            }))
          },
        })
        break
      }
      case 'roles': {
        ui.showRoles({
          roles: state.roles,
          traffic: state.traffic,
          rolesTitle: UI_TEXT.presentationRolesTitle,
          trafficTitle: UI_TEXT.presentationTrafficTitle,
          onOpenRole: async (roleId) => {
            await call((requestId) => ({ type: 'openRole', requestId, roleId }))
          },
        })
        break
      }
      case 'manager': {
        const actions = (items: typeof state.actions, entryId?: string) =>
          items.map((action) => ({
            ...action,
            run: async () => {
              await call((requestId) => ({
                type: 'managerAction',
                requestId,
                actionId: action.id,
                ...(entryId !== undefined && { entryId }),
              }))
            },
          }))
        ui.showManager({
          kind: state.manager,
          title: state.title,
          actions: actions(state.actions),
          entries: state.entries.map((entry) => ({
            ...entry,
            actions: actions(entry.actions, entry.id),
          })),
        })
        break
      }
      case 'diff': {
        ui.showDiff({
          title: state.title,
          hunks: state.hunks,
          onDecide: async (hunkId, decision) => {
            await call((requestId) => ({
              type: 'diffDecision',
              requestId,
              reviewId: state.reviewId,
              hunkId: String(hunkId),
              decision,
            }))
          },
        })
        break
      }
      case 'walkthrough': {
        ui.showWalkthrough({
          steps: state.steps.map((step) => ({
            ...step,
            description: step.detail,
            action: { type: 'walkthroughAction', requestId: `step-${step.id}`, stepId: step.id },
            actionTitle: step.actionTitle,
          })),
          post: (value) => {
            const request = presentationRequestSchema.parse(value)
            if (request.type !== 'walkthroughAction')
              throw new Error('MHP_PRESENTATION_ACTION_FAILED')
            void call((requestId) => ({ ...request, requestId })).catch(() => {
              showBridgeFailure(document)
            })
          },
        })
        break
      }
    }
  }
  const receive = (event: Event) => {
    if (isDisposed || !(event instanceof MessageEvent)) return
    try {
      const message = presentationMessageSchema.parse(event.data)
      if (message.type === 'presentationState') show(message.state)
      else {
        const waiting = pending.get(message.requestId)
        if (waiting === undefined) throw new Error('MHP_PRESENTATION_UNCORRELATED_RESULT')
        pending.delete(message.requestId)
        clearTimeout(waiting.timer)
        if (message.result.ok) waiting.resolve(message.result.text)
        else waiting.reject(new Error(message.result.code))
      }
    } catch {
      showBridgeFailure(document)
    }
  }
  host.messages.addEventListener('message', receive)
  send({ type: 'presentationReady' })
  return () => {
    if (isDisposed) return
    isDisposed = true
    host.messages.removeEventListener('message', receive)
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new Error('MHP_PRESENTATION_DISPOSED'))
    }
    pending.clear()
    ui.dispose()
  }
}

async function mount(): Promise<void> {
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) throw tableError
  const { selectBridge } = await import('../../webview/bridges/select')
  const host = await selectBridge(
    { outgoing: presentationRequestSchema, incoming: presentationMessageSchema },
    () => {
      showBridgeFailure(document)
    },
  )
  const element = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
  if (element === null) throw new Error('MHP_PRESENTATION_ELEMENT_MISSING')
  const dispose = mountPresentation(host, element)
  window.addEventListener(
    'pagehide',
    () => {
      dispose()
      host.dispose()
    },
    { once: true },
  )
}
if (typeof document !== 'undefined')
  void mount().catch(() => {
    showBridgeFailure(document)
  })
