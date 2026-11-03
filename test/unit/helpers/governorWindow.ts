// The window's own governor host as the person's settings leave it, for suites
// that run team slots over the real queue and sampler: `isLimited` sets the
// memory limit to 0%, which holds this machine at throttle (one place per kind).
// On macOS before libuv 1.52 (Node 22, CI's runtime) the machine's memory reads
// only through the helper, so `memoryReader` lends the suite's compiled one
// (`liveSamplerSuite`); without it a 0% limit never holds the throttle there.
import { configureResources, loadResourceWindow } from '../../../src/core/resources/admission'
import type { DarwinMemoryReader } from '../../../src/core/resources/sampler/darwinMemory'

/** Readings the window's sampler takes before the limit shows in the level. */
const READINGS = 3

export async function governorWindow(options: {
  readonly isLimited: boolean
  readonly memoryReader: () => DarwinMemoryReader | undefined
}) {
  const errors: unknown[] = []
  const dispose = configureResources({
    inspect: (key: string) =>
      key === 'resourceMemoryMaxPercent' && options.isLimited ? { globalValue: 0 } : undefined,
    onError: (error?: unknown) => {
      errors.push(error)
    },
    darwinMemory: options.memoryReader,
  })
  const window = await loadResourceWindow()
  if (window === undefined) {
    dispose()
    throw new Error('the governor window did not load')
  }
  for (let reading = 0; reading < READINGS; reading += 1) await window.port.refreshStatus()
  return { window, errors, dispose }
}
