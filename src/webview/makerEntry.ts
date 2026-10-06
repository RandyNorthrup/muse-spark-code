// Only this lazy entry belongs to startup. All maker schemas and UI wait for
// a host maker message; the buffer preserves approvals arriving during import.
import type { MakerSurfaceMessage } from '../shared/makerProtocol'
import { MAKER_PROTOCOL_MAX_ITEMS, MAKER_PROTOCOL_VERSION, UI_TEXT } from '../shared/constants'
import type { HostBridge } from './hostBridge'

export function listenForMaker(host: HostBridge<MakerSurfaceMessage>): void {
  const pending: unknown[] = []
  let receive: ((raw: unknown) => void) | undefined
  let isLoading = false
  let isDisposed = false
  let dispose: (() => void) | undefined
  let fallback: HTMLDivElement | undefined
  const load = () => {
    if (isLoading || isDisposed) return
    isLoading = true
    fallback ??= document.createElement('div')
    fallback.className = 'maker-toolbar'
    const status = document.createElement('p')
    status.textContent = UI_TEXT.loadingOutput
    const stop = document.createElement('button')
    stop.textContent = UI_TEXT.makerStopAll
    stop.addEventListener('click', () => {
      host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop' })
    })
    fallback.replaceChildren(status, stop)
    document.body.append(fallback)
    void import('./maker/MakerSurface')
      .then(({ mountMaker }) => {
        if (isDisposed) return
        const element = document.createElement('div')
        document.body.append(element)
        const surface = mountMaker(element, host, pending)
        receive = surface.receive
        dispose = surface.dispose
        pending.length = 0
        fallback?.remove()
        host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerReady' })
      })
      .catch(() => {
        isLoading = false
        if (isDisposed) return
        status.textContent = UI_TEXT.makerLoadFailed
        status.setAttribute('role', 'alert')
        const retry = document.createElement('button')
        retry.textContent = UI_TEXT.makerRetry
        retry.addEventListener('click', load)
        fallback?.append(retry)
      })
  }
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
    load()
  }
  host.messages.addEventListener('message', listener)
  window.addEventListener(
    'pagehide',
    () => {
      isDisposed = true
      host.messages.removeEventListener('message', listener)
      dispose?.()
      fallback?.remove()
      pending.length = 0
    },
    { once: true },
  )
}
