import { vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
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
export function uiApproval(now = Date.now()): Extract<ApprovalRequest, { kind: 'machine' }> {
  return {
    kind: 'machine',
    id: MAKER_UI_ID,
    digest: createHash('sha256').update('M104 S190').digest('hex'),
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

export function installMakerBrowser() {
  let pointed: Element | null = null
  document.elementFromPoint = () => pointed
  HTMLElement.prototype.scrollIntoView = vi.fn()
  const observers: {
    callback: (entries: IntersectionObserverEntry[]) => void
    targets: Set<Element>
  }[] = []
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      public readonly targets = new Set<Element>()
      public constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        observers.push({ callback, targets: this.targets })
      }
      public observe(target: Element) {
        this.targets.add(target)
      }
      public disconnect() {
        this.targets.clear()
      }
    },
  )
  return (indexes?: readonly number[]) => {
    for (const observer of observers)
      observer.callback(
        [...observer.targets]
          .filter((_target, index) => indexes === undefined || indexes.includes(index))
          .map((target) => ({
            target,
            isIntersecting: true,
            intersectionRatio: 1,
            time: 0,
            get boundingClientRect() {
              pointed = target
              return target.getBoundingClientRect()
            },
            intersectionRect: target.getBoundingClientRect(),
            rootBounds: null,
          })),
      )
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
