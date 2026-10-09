// M124 (D106): the only connector code in dist/acp.js: the lazy loader of
// dist/connector.js, required on `mcp` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as Entry from './entry'

interface ConnectorBundle {
  readonly runConnector: typeof Entry.runConnector
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isConnectorBundle(value: unknown): value is ConnectorBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runConnector' in value &&
    typeof value.runConnector === 'function'
  )
}

export function connectorLoader(bundlePath: string, log: Logger): () => ConnectorBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isConnectorBundle,
    label: 'connector',
    unavailable: () => UI_TEXT.acpConnector.unavailable,
  })
}
