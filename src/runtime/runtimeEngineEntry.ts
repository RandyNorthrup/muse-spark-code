// Load the ACP engine only after headless arguments, input and budgets are admitted.
export { createAcpAgent } from '../acp/agent'
export { createRuntimeBackend } from './backends'
export { createExecClient } from './exec/execClient'
export { PROTOCOL_VERSION, ndJsonStream, RequestError } from '@agentclientprotocol/sdk'
export { setUiText } from '../shared/l10n/text'
import { MuseCodeHost } from '../core/backends/musecode/MuseCodeHost'
import { ModelApiBackendManager } from '../host/backend/modelApiBackendManager'
import type { UsageRecording } from '../core/usage/recording'

export function installUsageRecording(recording: UsageRecording): () => void {
  const model = ModelApiBackendManager.usageRecording
  const muse = MuseCodeHost.usageRecording
  ModelApiBackendManager.usageRecording = recording
  MuseCodeHost.usageRecording = recording
  return () => {
    ModelApiBackendManager.usageRecording = model
    MuseCodeHost.usageRecording = muse
  }
}
