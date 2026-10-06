import { MAKER_PROTOCOL_VERSION } from '../../shared/constants'
import {
  makerHostMessageSchema,
  makerSurfaceMessageSchema,
  type ApprovalRequest,
  type MakerHostMessage,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'
import type { HostBridge } from '../hostBridge'

type Message<Type extends MakerHostMessage['type']> = Extract<MakerHostMessage, { type: Type }>
interface MakerState {
  readonly admission: Message<'makerState'> | undefined
  readonly approvals: readonly ApprovalRequest[]
  readonly statuses: ReadonlyMap<string, Message<'makerStatus'>['status']>
  readonly log: Message<'makerDeviceLog'> | undefined
  readonly preview: Message<'makerPreview'> | undefined
  readonly presets: Message<'makerPresets'>['event'] | undefined
  readonly notice: Message<'makerNotice'>['notice'] | undefined
  readonly result: Message<'makerResult'> | undefined
}

/** UI state only. Authority and its single-use binding stay in MakerHost. */
export function createMakerStore(host: HostBridge<MakerSurfaceMessage>, now = Date.now) {
  let state: MakerState = {
    admission: undefined,
    approvals: [],
    statuses: new Map(),
    log: undefined,
    preview: undefined,
    presets: undefined,
    notice: undefined,
    result: undefined,
  }
  const listeners = new Set<() => void>()
  let isDisposed = false
  const seen = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const publish = (next: MakerState) => {
    state = next
    for (const listener of listeners) listener()
  }
  const isAdmitted = () =>
    state.admission?.isTrusted === true &&
    state.admission.hardwareEnabled &&
    state.admission.isInteractive
  const didSend = (raw: MakerSurfaceMessage): boolean => {
    if (isDisposed) return false
    const message = makerSurfaceMessageSchema.safeParse(raw)
    if (!message.success || message.data.type === 'makerAnswer') return false
    const type = message.data.type
    if (['makerSend', 'makerSerial', 'makerStatus'].includes(type) && !isAdmitted()) return false
    if (
      (type === 'makerAddMachine' ||
        type === 'makerRemoveMachine' ||
        (type === 'makerHardware' && message.data.enabled)) &&
      (state.admission?.isTrusted !== true || !state.admission.isInteractive)
    )
      return false
    host.post(message.data)
    return true
  }
  const didAnswer = (id: string, decision: 'allow_once' | 'reject_once'): boolean => {
    const request = state.approvals.find((item) => item.id === id)
    if (request === undefined) return false
    const chosen =
      decision === 'allow_once' && isAdmitted() && now() < request.expiresAt
        ? 'allow_once'
        : 'reject_once'
    clearTimeout(timers.get(id))
    timers.delete(id)
    publish({ ...state, approvals: state.approvals.filter((item) => item.id !== id) })
    host.post(
      makerSurfaceMessageSchema.parse({
        v: MAKER_PROTOCOL_VERSION,
        type: 'makerAnswer',
        answer: {
          id: request.id,
          digest: request.digest,
          target: request.target,
          decision: chosen,
        },
      }),
    )
    return chosen === decision
  }
  const receive = (raw: unknown): void => {
    if (isDisposed) return
    const parsed = makerHostMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const message = parsed.data
    switch (message.type) {
      case 'makerState': {
        publish({ ...state, admission: message })
        if (!isAdmitted())
          for (const request of state.approvals) didAnswer(request.id, 'reject_once')
        break
      }
      case 'makerApproval': {
        if (seen.has(message.request.id)) return
        seen.add(message.request.id)
        publish({ ...state, approvals: [...state.approvals, message.request] })
        const remaining = message.request.expiresAt - now()
        if (remaining <= 0 || !isAdmitted()) didAnswer(message.request.id, 'reject_once')
        else
          timers.set(
            message.request.id,
            setTimeout(() => {
              didAnswer(message.request.id, 'reject_once')
            }, remaining),
          )
        break
      }
      case 'makerApprovalClosed': {
        clearTimeout(timers.get(message.id))
        timers.delete(message.id)
        seen.add(message.id)
        publish({ ...state, approvals: state.approvals.filter((item) => item.id !== message.id) })
        break
      }
      case 'makerStatus': {
        publish({
          ...state,
          statuses: new Map(state.statuses).set(message.machineId, message.status),
        })
        break
      }
      case 'makerDeviceLog': {
        publish({ ...state, log: message })
        break
      }
      case 'makerPreview': {
        publish({ ...state, preview: message })
        break
      }
      case 'makerPresets': {
        publish({ ...state, presets: message.event })
        break
      }
      case 'makerNotice': {
        publish({ ...state, notice: message.notice })
        break
      }
      case 'makerResult': {
        publish({ ...state, result: message })
        break
      }
      case 'makerMesh': {
        break // Geometry belongs to the separate preview page.
      }
    }
  }
  return {
    getState: () => state,
    receive,
    send: didSend,
    answer: didAnswer,
    isAdmitted,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: () => {
      for (const request of state.approvals) didAnswer(request.id, 'reject_once')
      isDisposed = true
      listeners.clear()
    },
  }
}
