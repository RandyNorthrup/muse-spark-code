import { createRoot } from 'react-dom/client'
import type { FallbackUiMethod } from '../../shared/hostApi/fallbackUi'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'
import { MHP_METHODS } from '../../shared/hostApi/methods'
import { Fragment, type ReactNode } from 'react'
import { Confirm } from './Confirm'
import { Picker } from './Picker'
import { Input } from './Input'
import { Toasts } from './Toasts'
import { StatusStrip } from './StatusStrip'
import { OpenExternal } from './OpenExternal'
import './fallbacks.css'

type Handlers = {
  readonly [M in FallbackUiMethod]: (
    params: MhpParams<M>,
    signal?: AbortSignal,
  ) => Promise<MhpResult<M>>
}

/** Browser-side HostServices adapter. The carrier owns RPC and result delivery. */
export function createFallbackUi(element: Element, onCommand: (id: string) => void) {
  const root = createRoot(element)
  const prompts: { id: number; render(): ReactNode; cancel(): void }[] = []
  const notifications: (MhpParams<'ui/notify'> & { id: string })[] = []
  const status = new Map<string | number, MhpParams<'ui/status'>>()
  const progress = new Map<string | number, MhpParams<'ui/progress'>>()
  const clipboardRequests = new Set<() => void>()
  let serial = 0
  let promptSerial = 0
  let isDisposed = false
  function paint(): void {
    if (isDisposed) return
    root.render(
      <>
        <Toasts
          items={notifications}
          onDismiss={(id) => {
            const index = notifications.findIndex((item) => item.id === id)
            if (index !== -1) notifications.splice(index, 1)
            paint()
          }}
        />
        <StatusStrip
          items={[...status].map(([, item]) => item)}
          progress={[...progress].map(([, item]) => item)}
          onCommand={onCommand}
        />
        {prompts[0] === undefined ? null : (
          <Fragment key={prompts[0].id}>{prompts[0].render()}</Fragment>
        )}
      </>,
    )
  }
  function prompt<T>(
    render: (done: (result: T | null) => void) => ReactNode,
    signal?: AbortSignal,
  ): Promise<T | null> {
    if (isDisposed) return Promise.reject(new Error('MHP_UI_DISPOSED'))
    if (signal?.aborted === true) return Promise.reject(new Error('MHP_CANCELLED'))
    return new Promise((resolve, reject) => {
      let isSettled = false
      const settle = (result: T | null, isAborted: boolean) => {
        if (isSettled) return
        isSettled = true
        signal?.removeEventListener('abort', abort)
        const index = prompts.indexOf(entry)
        if (index !== -1) prompts.splice(index, 1)
        if (isAborted) reject(new Error('MHP_CANCELLED'))
        else resolve(result)
        paint()
      }
      const abort = () => {
        settle(null, true)
      }
      const entry = {
        id: ++promptSerial,
        render: () =>
          render((result) => {
            settle(result, false)
          }),
        cancel: abort,
      }
      prompts.push(entry)
      signal?.addEventListener('abort', abort, { once: true })
      paint()
    })
  }
  const handlers: Handlers = {
    'ui/clipboard': async (params, signal) => {
      signal?.throwIfAborted()
      if (!('clipboard' in navigator)) throw new Error('MHP_UNSUPPORTED_CAPABILITY')
      return await new Promise<null>((resolve, reject) => {
        let isSettled = false
        const settle = (failure?: Error) => {
          if (isSettled) return
          isSettled = true
          signal?.removeEventListener('abort', abort)
          clipboardRequests.delete(cancel)
          if (failure === undefined) resolve(null)
          else reject(failure)
        }
        const abort = () => {
          settle(new Error('MHP_CANCELLED'))
        }
        const cancel = () => {
          settle(new Error('MHP_UI_DISPOSED'))
        }
        clipboardRequests.add(cancel)
        signal?.addEventListener('abort', abort, { once: true })
        void (async () => {
          try {
            await navigator.clipboard.writeText(params.text)
            settle()
          } catch (error: unknown) {
            settle(error instanceof Error ? error : new Error('MHP_CLIPBOARD_FAILED'))
          }
        })()
      })
    },
    'ui/openExternal': async (params, signal) => {
      const isOpened = await prompt<boolean>(
        (done) => (
          <OpenExternal
            uri={params.uri}
            onOpened={() => {
              done(true)
            }}
            onCancel={() => {
              done(null)
            }}
          />
        ),
        signal,
      )
      if (isOpened !== true) throw new Error('MHP_CANCELLED')
      return null
    },
    'ui/confirm': (params, signal) =>
      prompt((onResult) => <Confirm params={params} onResult={onResult} />, signal),
    'ui/pick': (params, signal) =>
      prompt((onResult) => <Picker params={params} onResult={onResult} />, signal),
    'ui/input': (params, signal) =>
      prompt((onResult) => <Input params={params} onResult={onResult} />, signal),
    'ui/notify': (params) => {
      notifications.push({ ...params, id: String(++serial) })
      paint()
      return Promise.resolve(null)
    },
    'ui/status': (params) => {
      status.set(params.id, params)
      paint()
      return Promise.resolve(null)
    },
    'ui/progress': (params) => {
      progress.set(params.id, params)
      paint()
      return Promise.resolve(null)
    },
  }
  return {
    async request<M extends FallbackUiMethod>(
      method: M,
      params: MhpParams<M>,
      signal?: AbortSignal,
    ): Promise<MhpResult<M>> {
      if (isDisposed) throw new Error('MHP_UI_DISPOSED')
      signal?.throwIfAborted()
      MHP_METHODS[method].params.parse(params)
      return await handlers[method](params, signal)
    },
    dispose() {
      isDisposed = true
      for (const cancel of clipboardRequests) cancel()
      let entry
      while ((entry = prompts.pop()) !== undefined) entry.cancel()
      root.unmount()
    },
  }
}
