// The window's own governor host as the person's settings leave it, for suites
// that run team slots over the real queue and sampler: `isLimited` sets the
// memory limit to 0%, which holds this machine at throttle (one place per kind).
import { configureResources, loadResourceWindow } from '../../../src/core/resources/admission'

/** Readings the window's sampler takes before the limit shows in the level. */
const READINGS = 3

export async function governorWindow(options: { readonly isLimited: boolean }) {
  const errors: unknown[] = []
  const dispose = configureResources({
    inspect: (key: string) =>
      key === 'resourceMemoryMaxPercent' && options.isLimited ? { globalValue: 0 } : undefined,
    onError: (error?: unknown) => {
      errors.push(error)
    },
  })
  const window = await loadResourceWindow()
  if (window === undefined) {
    dispose()
    throw new Error('the governor window did not load')
  }
  for (let reading = 0; reading < READINGS; reading += 1) await window.port.refreshStatus()
  return { window, errors, dispose }
}
