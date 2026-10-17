// The network posture of a machine with no proxy and VS Code's default
// `http.*` settings (M56, PLAN.md D43), shared by the Diagnostics tests.

import type { NetworkFacts } from '../../../src/core/support/report'

export const DEFAULT_NETWORK_FACTS: NetworkFacts = {
  isProxySet: false,
  proxySupport: 'override',
  isProxyStrictSsl: true,
  isProxyAuthorizationSet: false,
  noProxyCount: 0,
  isSystemCertificatesOn: true,
  isFetchSupportOn: true,
  isWebSocketSupportOn: true,
  fetchRouting: 'routed',
  webSocketRouting: 'routed',
  hasEnvironmentProxy: false,
  hasExtraCaCertificates: false,
  museProxySource: 'none',
  hasMuseCertificateOverride: false,
}
