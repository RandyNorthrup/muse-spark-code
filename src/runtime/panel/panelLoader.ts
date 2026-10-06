import type * as RuntimePanelPortsBundle from './runtimeFeaturesEntry'
import type * as RuntimePanelBundle from './panelEntry'
import { lazyBundleLoader, type LazyBundleLoaderOptions } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'

type Bundle = typeof RuntimePanelBundle
/** The packaged same-build factory's callable signature is trusted after its entry guard (PLAN §8). */
function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runRuntimePanel' in value &&
    typeof value.runRuntimePanel === 'function'
  )
}
export function panelLoader(
  deps: Pick<LazyBundleLoaderOptions<Bundle>, 'bundlePath' | 'log' | 'loadBundle'>,
): () => Bundle {
  return lazyBundleLoader({
    ...deps,
    isBundle,
    label: 'runtime panel bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}

// The signature belongs to this exact packaged build; only callable factories cross the loader.
export function panelPortsLoader(
  deps: Pick<
    LazyBundleLoaderOptions<typeof RuntimePanelPortsBundle>,
    'bundlePath' | 'log' | 'loadBundle'
  >,
): () => typeof RuntimePanelPortsBundle {
  return lazyBundleLoader({
    ...deps,
    isBundle: (value): value is typeof RuntimePanelPortsBundle =>
      typeof value === 'object' &&
      value !== null &&
      'createRuntimePanelPorts' in value &&
      typeof value.createRuntimePanelPorts === 'function',
    label: 'runtime panel ports bundle',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
