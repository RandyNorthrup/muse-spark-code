import { vi } from 'vitest'
import type {
  ApprovalRequest,
  MakerHostMessage,
  MakerSurfaceMessage,
} from '../../../src/shared/makerProtocol'
import type { HostBridge } from '../../../src/webview/hostBridge'
import { createMakerStore } from '../../../src/webview/maker/store'

export const MAKER_UI_ID = '2b4a9acb-2dc5-4f46-aeb8-40aee71bb875'
export const MAKER_UI_MACHINE = {
  registrationId: MAKER_UI_ID,
  id: 'printer',
  name: 'Bench printer',
  kind: 'moonraker',
  category: 'printer',
  endpoint: 'http://192.168.1.5',
  limits: { extruder: 200 },
} as const
export const MAKER_UI_STATE: Extract<MakerHostMessage, { type: 'makerState' }> = {
  v: 1,
  type: 'makerState',
  isTrusted: true,
  hardwareEnabled: true,
  isInteractive: true,
  machines: [MAKER_UI_MACHINE],
  ports: [{ kind: 'serial', port: 'COM7', vid: '303a', pid: '1001', serialNumber: 'board-one' }],
}
export function uiApproval(now = Date.now()): ApprovalRequest {
  return {
    kind: 'machine',
    id: MAKER_UI_ID,
    digest: 'a'.repeat(64),
    expiresAt: now + 1000,
    action: 'actuate',
    target: {
      kind: 'machine',
      registrationId: MAKER_UI_MACHINE.registrationId,
      id: MAKER_UI_MACHINE.id,
      name: MAKER_UI_MACHINE.name,
      endpoint: MAKER_UI_MACHINE.endpoint,
      identity: 'Klipper',
    },
    payload: 'M104 S190',
    analysis: {
      classes: ['actuate'],
      maxFeedMmMin: 100,
      temperatures: { extruder: 190 },
      unknown: [],
      refused: [],
      hasMotion: false,
    },
  }
}
export function uiBridge() {
  const post = vi.fn<(message: MakerSurfaceMessage) => void>()
  const host: HostBridge<MakerSurfaceMessage> = {
    post,
    messages: window,
    savedState: () => undefined,
    saveState: () => undefined,
  }
  const store = createMakerStore(host)
  return { host, post, store }
}
