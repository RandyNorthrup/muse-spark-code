// M124 (D106, RVM124 finding 15): the only storage-guard code in
// dist/acp.js: the lazy loader of dist/connectorStoreGuard.js, required on
// `mcp` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Guard from './storageGuard'

interface StorageGuardBundle {
  readonly connectorStorageGuard: typeof Guard.connectorStorageGuard
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isStorageGuardBundle(value: unknown): value is StorageGuardBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'connectorStorageGuard' in value &&
    typeof value.connectorStorageGuard === 'function'
  )
}

export function storageGuardLoader(bundlePath: string, log: Logger): () => StorageGuardBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isStorageGuardBundle,
    label: 'connector storage guard',
    unavailable: () => UI_TEXT.acpConnector.unavailable,
  })
}
