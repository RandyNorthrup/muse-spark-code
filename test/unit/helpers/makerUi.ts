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
  let isVisible = false
  let width = 240
  const resizes: { callback: () => void; active: boolean }[] = []
  const ends: {
    callback: (entries: IntersectionObserverEntry[]) => void
    targets: Set<Element>
  }[] = []
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('maker-payload')
      ? new DOMRect(0, isVisible ? 0 : 900, width, 160)
      : new DOMRect(0, 0, width, 760)
  })
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: {
      configurable: true,
      get() {
        return width
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        return 160
      },
    },
    scrollHeight: {
      configurable: true,
      get() {
        return Number(
          document
            .querySelector<HTMLElement>('.maker-payload-rows')
            ?.style.height.replace('px', '') ?? '160',
        )
      },
    },
  })
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly record
      public constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        this.record = { callback, targets: new Set<Element>() }
        ends.push(this.record)
      }
      public observe(target: Element) {
        this.record.targets.add(target)
      }
      public disconnect() {
        this.record.targets.clear()
      }
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly record
      public constructor(callback: () => void) {
        this.record = { callback, active: false }
        resizes.push(this.record)
      }
      public observe() {
        this.record.active = true
      }
      public disconnect() {
        this.record.active = false
      }
    },
  )
  const visible = () => {
    isVisible = true
    for (const node of document.querySelectorAll<HTMLElement>('.maker-payload')) {
      node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight)
      node.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    for (const end of ends)
      end.callback(
        [...end.targets].map((target) => ({
          target,
          intersectionRatio: 1,
          isIntersecting: true,
          time: 0,
          rootBounds: null,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
        })),
      )
  }
  return Object.assign(visible, {
    resize: (nextWidth = width) => {
      width = nextWidth
      for (const resize of resizes) if (resize.active) resize.callback()
    },
  })
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
