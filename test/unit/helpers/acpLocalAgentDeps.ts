// The ACP agent's non-backend dependencies for a test that drives it with a
// real client over a local backend: its folder as the default working folder,
// the real paid-use composition with nothing flagged and no remembered grant,
// the real maker surface, and questions declined.
import path from 'node:path'
import { createAcpAgent, type AcpAgentDeps } from '../../../src/acp/agent'
import { AcpMakerSurface } from '../../../src/acp/maker'
import { AcpPaidUse } from '../../../src/acp/paid'
import type { CoreLogger } from '../../../src/core/logging'
import { paidGrantFile } from '../../../src/runtime/paidGrants'
import { modelApiRig, type ModelApiRig } from './conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './editorChatRig'

export function acpLocalAgentDeps(
  folder: string,
  log: CoreLogger,
): Pick<AcpAgentDeps, 'defaultCwd' | 'paid' | 'maker' | 'log' | 'questions'> {
  return {
    defaultCwd: folder,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: paidGrantFile({
        file: path.join(folder, 'paid-grants.json'),
        log,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      log,
    }),
    maker: new AcpMakerSurface({ log }),
    log,
    questions: 'decline',
  }
}

/**
The real ACP agent over the real Model API host (the editor-chat rig's
local providers), starting on its local provider model. `extra` lends
the agent more of its deps once the rig and the local deps exist.
*/
export function createLocalAcpAgent(
  folder: string,
  log: CoreLogger,
  extra?: (rig: ModelApiRig, deps: ReturnType<typeof acpLocalAgentDeps>) => Partial<AcpAgentDeps>,
): { agent: ReturnType<typeof createAcpAgent>; rig: ModelApiRig } {
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, {
    ...(models !== undefined && { models }),
  })
  const deps = acpLocalAgentDeps(folder, log)
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(rig.host),
    },
    version: '0.19.0',
    // A provider run starts on the model it names: the rig's local provider.
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: 'manual',
      initialModelId: 'probe-custom/custom-model',
    },
    signIn: {
      id: 'auth-set',
      name: 'Model API key',
      description: 'Model API key',
      args: [],
      command: 'muse-spark-code-acp auth set',
    },
    ...deps,
    ...extra?.(rig, deps),
  })
  return { agent, rig }
}
