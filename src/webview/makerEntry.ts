// Only this lazy entry belongs to startup. All maker schemas and UI wait for
// a host maker message; the storage-independent Stop shell is installed first.
import type { MakerSurfaceMessage } from '../shared/makerProtocol'
import {
  MAKER_PROTOCOL_MAX_ITEMS,
  MAKER_PROTOCOL_VERSION,
  MAKER_STOP_SHELL_ID,
  UI_TEXT,
} from '../shared/constants'
import type { HostBridge } from './hostBridge'
import { isMakerReloadPending, reloadPanelSurface } from './reloadPanelSurface'

export function listenForMaker(host: HostBridge<MakerSurfaceMessage>): void {
  // Host-rendered HTML already shows Stop. Companion hosts without that markup
  // get the same small shell synchronously, before any storage access or import.
  const fallback =
    document.querySelector<HTMLDivElement>(`#${MAKER_STOP_SHELL_ID}`) ??
    document.createElement('div')
  fallback.id = MAKER_STOP_SHELL_ID
  fallback.className = 'maker-toolbar maker-loading-toolbar maker-static-stop'
  const stop = fallback.querySelector('button') ?? document.createElement('button')
  stop.type = 'button'
  if (stop.textContent === '') stop.textContent = UI_TEXT.makerStopAll
  stop.addEventListener('click', () => {
    host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop' })
  })
  fallback.replaceChildren(stop)
  document.body.append(fallback)
  const shouldReopen = isMakerReloadPending()
  const pending: unknown[] = []
  let receive: ((raw: unknown) => void) | undefined
  let isLoading = false
  let isDisposed = false
  const isGone = () => isDisposed
  let dispose: (() => void) | undefined
  const load = () => {
    if (isLoading || isDisposed) return
    isLoading = true
    const status = document.createElement('p')
    status.textContent = UI_TEXT.loadingOutput
    fallback.replaceChildren(stop, status)
    document.body.append(fallback)
    void Promise.allSettled([
      (async () => {
        const { mountMaker } = await import('./maker/MakerSurface')
        if (isGone()) return
        const element = document.createElement('div')
        document.body.append(element)
        let surface: Awaited<ReturnType<typeof mountMaker>>
        try {
          surface = await mountMaker(element, host)
        } catch (error: unknown) {
          element.remove()
          throw error
        }
        if (isGone()) {
          surface.dispose()
          return
        }
        receive = surface.receive
        dispose = surface.dispose
        for (const message of pending) receive(message)
        pending.length = 0
        fallback.remove()
      })(),
    ]).then(([attempt]) => {
      if (attempt.status !== 'rejected') return
      isLoading = false
      if (isDisposed) return
      status.textContent = UI_TEXT.makerLoadFailed
      status.setAttribute('role', 'alert')
      const retry = document.createElement('button')
      retry.textContent = UI_TEXT.makerRetry
      retry.addEventListener('click', () => {
        reloadPanelSurface()
      })
      const dismiss = document.createElement('button')
      dismiss.textContent = UI_TEXT.usageClose
      dismiss.addEventListener('click', () => {
        fallback.replaceChildren(stop)
        pending.length = 0
      })
      fallback.append(retry, dismiss)
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
  if (shouldReopen) load()
  window.addEventListener(
    'pagehide',
    () => {
      isDisposed = true
      host.messages.removeEventListener('message', listener)
      dispose?.()
      fallback.remove()
      pending.length = 0
    },
    { once: true },
  )
  // Transport is ready before imports; hosts replay their current state and pending requests.
  host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerReady' })
}
