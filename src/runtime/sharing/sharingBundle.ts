import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import type * as Entry from './sharingEntry'
import { UI_TEXT } from '../../shared/constants'

interface RuntimeSharingBundle {
  readonly runRuntimeSharing: typeof Entry.runRuntimeSharing
  readonly runtimeAcpSharing: typeof Entry.runtimeAcpSharing
}
function isBundle(value: unknown): value is RuntimeSharingBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runRuntimeSharing' in value &&
    typeof value.runRuntimeSharing === 'function' &&
    'runtimeAcpSharing' in value &&
    typeof value.runtimeAcpSharing === 'function'
  )
}
export function runtimeSharingLoader(bundlePath: string, log: Logger): () => RuntimeSharingBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle,
    // A bundle that cannot load is an installation fault, not a prompt-file
    // error; the loader already logged the cause.
    label: 'sharing runtime',
    unavailable: () => UI_TEXT.actionFailed,
  })
}
