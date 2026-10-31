// A real ACP agent on a real MuseCodeHost over the replay wire, for suites
// that assert what the editor hears. Every wire byte is recorded live with
// zero model calls: the 1.4.11 echo capture (test/fixtures/acphonest/) for
// the start, the mode acks and the released broadcasts, plus the 1.4.7 echo
// capture's model/list (1.4.11 serves the echo catalogue empty).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable'
import type { PermissionMode } from '../../../src/shared/constants'
import { createAcpAgent } from '../../../src/acp/agent'
import type { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import type { Logger } from '../../../src/host/logger'
import {
  type Answer,
  closeLiveHosts,
  recordedResult,
  refuseUnscripted,
  type ReplayWire,
  startLiveHost,
} from './museReplay'
import { acpLocalAgentDeps } from './acpLocalAgentDeps'
import { levelLogger, type LoggedMessage } from './collectingLogger'

export function acpFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/acphonest/${name}`, import.meta.url), 'utf8'),
  )
}

export interface AcpReplayLive {
  readonly host: MuseCodeHost
  readonly wire: ReplayWire
  readonly folder: string
  readonly agent: ReturnType<typeof createAcpAgent>
  readonly logged: LoggedMessage[]
}

const folders: string[] = []

/** The replay agent over a replay host: a ready Muse Code backend, no remembered grants. */
export function createReplayAgent(options: {
  readonly host: MuseCodeHost
  readonly folder: string
  readonly log: Logger
  readonly initialMode?: PermissionMode
}): ReturnType<typeof createAcpAgent> {
  const { host, folder, log } = options
  return createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.19.0',
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: options.initialMode ?? 'manual',
    },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
    ...acpLocalAgentDeps(folder, log),
  })
}

/** Start the rig; the suite closes it with `closeAcpReplayRigs` in `afterEach`. */
export function startAcpReplayRig(initialMode: PermissionMode = 'manual'): AcpReplayLive {
  const acks: Readonly<Record<string, unknown>> = {
    onRequest: acpFixture('mode-ack-onRequest-1.4.11.json'),
    denyUnmatched: acpFixture('mode-ack-denyUnmatched-1.4.11.json'),
    allowAll: acpFixture('mode-ack-allowAll-1.4.11.json'),
    promptUnmatched: acpFixture('mode-ack-promptUnmatched-1.4.11.json'),
  }
  const skills = acpFixture('skill-list-1.4.11.json')
  const logged: LoggedMessage[] = []
  const log = levelLogger(logged)
  const { host, wire } = startLiveHost(
    (method, params): Answer => {
      switch (method) {
        case 'model/list': {
          return { result: recordedResult(2) }
        }
        case 'session/start': {
          return { result: acpFixture('session-start-1.4.11.json') }
        }
        case 'session/setReasoningEffort': {
          return { result: acpFixture('session-setReasoningEffort-1.4.11.json') }
        }
        case 'session/setPermissionProfile': {
          return { result: acpFixture('session-setPermissionProfile-1.4.11.json') }
        }
        case 'skill/list': {
          return { result: skills }
        }
        case 'session/setApprovalMode': {
          const ack = typeof params['mode'] === 'string' ? acks[params['mode']] : undefined
          return ack === undefined ? refuseUnscripted(method) : { result: ack }
        }
        default: {
          return refuseUnscripted(method)
        }
      }
    },
    undefined,
    { initializeResult: acpFixture('initialize-1.4.11.json'), log },
  )
  const folder = mkdtempSync(path.join(tmpdir(), 'acp-replay-'))
  folders.push(folder)
  const agent = createReplayAgent({ host, folder, log, initialMode })
  return { host, wire, folder, agent, logged }
}

export async function closeAcpReplayRigs(): Promise<void> {
  await closeLiveHosts()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
}

/** The recorded broadcast params for a capture file. */
export function acpNoteParams(name: string): Record<string, unknown>[] {
  return acpFixture(name) as Record<string, unknown>[]
}

/** A released broadcast is answered in order, so a backend round trip after it proves it was handled. */
export async function flushReplayBackend(host: MuseCodeHost): Promise<void> {
  await host.listModels()
}

/**
A real editor on the replay agent: session updates land in `seen`, then the
run gets the opened session. The initialize and session/new preamble stays
in one place so every suite opens sessions the same way.
*/
export async function withReplayEditorSession(
  agent: ReturnType<typeof createAcpAgent>,
  folder: string,
  seen: SessionUpdate[],
  name: string,
  run: (editor: acp.ClientContext, sessionId: string) => Promise<void>,
): Promise<void> {
  await acp
    .client({ name })
    .onNotification('session/update', (context) => {
      seen.push(context.params.update)
    })
    .connectWith(agent, async (editor) => {
      await editor.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      await run(editor, created.sessionId)
    })
}
