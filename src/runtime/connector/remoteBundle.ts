// M124 remote (D240): the only remote-connector code in dist/acp.js: the
// lazy loader of dist/connectorRemote.js, required on `mcp serve-http`
// and `mcp client …` alone (PLAN.md D6).
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import type * as RemoteEntry from './remoteEntry'

interface ConnectorRemoteBundle {
  readonly runConnectorRemote: typeof RemoteEntry.runConnectorRemote
}

/** Same-build signature, trusted after checking the exported function (PLAN §8). */
function isConnectorRemoteBundle(value: unknown): value is ConnectorRemoteBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runConnectorRemote' in value &&
    typeof value.runConnectorRemote === 'function'
  )
}

export function connectorRemoteLoader(
  bundlePath: string,
  log: Logger,
): () => ConnectorRemoteBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isConnectorRemoteBundle,
    label: 'connectorRemote',
    unavailable: () => UI_TEXT.acpConnector.unavailable,
  })
}
