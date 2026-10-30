// The ACP agent's live sessions are held by the runtime's one
// ControllerRegistry (M104 lane B): the claim, the release barrier a newer
// load waits on, closing and signing out. The backend is the product's own
// Model API host over the real file session store (`modelApiRig`), with no
// key stored and the editor-chat rig's real providers file for its models
// (local addresses; any send refuses): a session starts and ends locally,
// and a real ACP client drives the real agent. No turn is sent: every
// prompt here is refused before it reaches the host.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { acpLocalAgentDeps } from './helpers/acpLocalAgentDeps'
import { modelApiRig } from './helpers/conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './helpers/editorChatRig'

const log = stderrLogger(() => undefined, 'warn')
// The protocol's own code for a session the agent does not hold.
const RESOURCE_NOT_FOUND = acp.RequestError.resourceNotFound().code
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** The real agent over the real Model API host and its file store. */
function agentOverModelApi() {
  const folder = mkdtempSync(path.join(tmpdir(), 'acp-registry-'))
  folders.push(folder)
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, {
    ...(models !== undefined && { models }),
  })
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
    ...acpLocalAgentDeps(folder, log),
  })
  return { agent, folder, rig }
}

/** The JSON-RPC error code a request answered with, or undefined when it succeeded. */
async function codeOf(request: Promise<unknown>): Promise<number | undefined> {
  try {
    await request
  } catch (error: unknown) {
    if (error instanceof acp.RequestError) return error.code
    throw error
  }
  return undefined
}

/** Initializes the connection and starts a session in the folder. */
async function newSession(
  editor: Parameters<Parameters<ReturnType<typeof acp.client>['connectWith']>[1]>[0],
  folder: string,
): Promise<string> {
  await editor.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  const { sessionId } = await editor.request('session/new', { cwd: folder, mcpServers: [] })
  return sessionId
}

describe('ACP sessions in the runtime’s controller registry', () => {
  it('holds a new session, lets it go on close, and finds nothing after', async () => {
    const { agent, folder, rig } = agentOverModelApi()
    await acp.client({ name: 'registry' }).connectWith(agent, async (editor) => {
      const sessionId = await newSession(editor, folder)
      expect(rig.host.sessionCount).toBe(1)
      expect(await codeOf(editor.request('session/close', { sessionId }))).toBeUndefined()
      // Closed: the registry holds nothing under the id, so a second close
      // and a prompt both answer resource-not-found, and no turn is sent.
      expect(await codeOf(editor.request('session/close', { sessionId }))).toBe(RESOURCE_NOT_FOUND)
      expect(
        await codeOf(
          editor.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'hi' }] }),
        ),
      ).toBe(RESOURCE_NOT_FOUND)
      expect(rig.errors).toEqual([])
    })
  })

  it('lets every held session go on logout', async () => {
    const { agent, folder } = agentOverModelApi()
    await acp.client({ name: 'registry' }).connectWith(agent, async (editor) => {
      const sessionId = await newSession(editor, folder)
      await editor.request('logout', {})
      expect(await codeOf(editor.request('session/close', { sessionId }))).toBe(RESOURCE_NOT_FOUND)
    })
  })
})
