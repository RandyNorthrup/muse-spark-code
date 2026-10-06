// Only this lazy entry belongs to startup. All maker schemas and UI wait for
// a host maker message; the buffer preserves approvals arriving during import.
import type { MakerSurfaceMessage } from '../shared/makerProtocol'
import { MAKER_PROTOCOL_MAX_ITEMS, MAKER_PROTOCOL_VERSION } from '../shared/constants'
import type { HostBridge } from './hostBridge'

export function listenForMaker(host: HostBridge<MakerSurfaceMessage>): void {
  const pending: unknown[] = []
  let receive: ((raw: unknown) => void) | undefined
  let isLoading = false
  let isDisposed = false
  let dispose: (() => void) | undefined
  const listener = (event: MessageEvent<unknown>) => {
    const raw = event.data
    if (receive !== undefined) {
      receive(raw)
      return
    }
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !('type' in raw) ||
      typeof raw.type !== 'string' ||
      !raw.type.startsWith('maker') ||
      pending.length >= MAKER_PROTOCOL_MAX_ITEMS
    )
      return
    pending.push(raw)
    if (isLoading) return
    isLoading = true
    void import('./maker/MakerSurface').then(({ mountMaker }) => {
      if (isDisposed) return
      const element = document.createElement('div')
      document.body.append(element)
      const surface = mountMaker(element, host, pending)
      receive = surface.receive
      dispose = surface.dispose
      pending.length = 0
      host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerReady' })
    })
  }
  host.messages.addEventListener('message', listener)
  window.addEventListener(
    'pagehide',
    () => {
      isDisposed = true
      host.messages.removeEventListener('message', listener)
      dispose?.()
      pending.length = 0
    },
    { once: true },
  )
}
