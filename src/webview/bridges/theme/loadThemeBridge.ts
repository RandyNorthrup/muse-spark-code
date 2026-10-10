import type { ThemeBridgeOptions, ThemePort } from './themeBridge'

/** M104 calls this only for companion/native roots, before mounting the panel. */
export async function loadThemeBridge(
  root: HTMLElement,
  port: ThemePort,
  onInvalid: () => void,
  signal: AbortSignal,
  options?: ThemeBridgeOptions,
): Promise<(() => void) | undefined> {
  const isAborted = () => signal.aborted
  const { mountThemeBridge } = await import('./themeEntry')
  if (isAborted()) return undefined
  const dispose = mountThemeBridge(root, port, onInvalid, options)
  const stop = () => {
    signal.removeEventListener('abort', stop)
    dispose()
  }
  signal.addEventListener('abort', stop, { once: true })
  // The initial snapshot/invalid callback may have closed the host surface.
  if (isAborted()) stop()
  return stop
}
