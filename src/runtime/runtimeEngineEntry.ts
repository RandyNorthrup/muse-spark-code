// Load the ACP engine only after headless arguments, input and budgets are admitted.
export { createAcpAgent } from '../acp/agent'
export { createRuntimeBackend } from './backends'
export { createExecClient } from './exec/execClient'
export { PROTOCOL_VERSION, ndJsonStream, RequestError } from '@agentclientprotocol/sdk/unstable'
export { setUiText } from '../shared/l10n/text'
export { assembleProviderRun } from './exec/providerExec'
export { providersFilePath, resolveEndpointHost } from './providersCommands'
export { parseStoredProviderSecret } from './keyStore'
import { MuseCodeHost } from '../core/backends/musecode/MuseCodeHost'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import { MuseCodeBackendManager } from '../host/backend/museCodeBackendManager'
import type { UsageRecording, UsageScopeReader } from '../core/usage/recording'

export function installUsageRecording(
  recording: UsageRecording,
  scope?: UsageScopeReader,
): () => void {
  const model = ModelApiBackendManager.usageRecording
  const muse = MuseCodeHost.usageRecording
  const manager = MuseCodeBackendManager.usageRecording
  const modelScope = ModelApiBackendManager.usageScope
  const museScope = MuseCodeHost.usageScope
  ModelApiBackendManager.usageRecording = recording
  MuseCodeHost.usageRecording = recording
  // The Muse Code host that runs is dist/museCode.js's own copy of the
  // class; the manager forwards this onto it at every bundle load.
  MuseCodeBackendManager.usageRecording = recording
  // Surviving hosts keep publishing after a reauthentication: they read the
  // live owner per observation instead of a retired generation.
  if (scope !== undefined) {
    ModelApiBackendManager.usageScope = scope
    MuseCodeHost.usageScope = scope
  }
  return () => {
    ModelApiBackendManager.usageRecording = model
    MuseCodeHost.usageRecording = muse
    MuseCodeBackendManager.usageRecording = manager
    ModelApiBackendManager.usageScope = modelScope
    MuseCodeHost.usageScope = museScope
  }
}

// Runtime-only schedule session ownership stays behind this existing engine boundary.
export { createRuntimeScheduleDelivery } from './schedules/delivery'
