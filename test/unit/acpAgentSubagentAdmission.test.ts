// `/agents continue|retry` through the playbook's child-work admission
// (M116, PLAN.md D215): the agent asks the same `SubagentAdmission` port
// the Model API host asks, as a `delegate` round for the listed child. A
// refusal answers the person and reaches no backend; admitted, the
// control runs as before; without the port, it runs unconsulted. The
// backend is scripted at the agent's own host/session seams; the
// admission, holder and governor readings are real; a real in-process ACP
// client drives real protocol requests. The peer answers the recovery
// confirm the command itself raises by selecting its own `recover`
// option — a choice among offered options, no outside-world vocabulary.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import type { SubagentAdmission } from '../../src/core/backends/modelapi/subagentTools'
import type {
  AgentHost,
  AgentSession,
  SessionHistoryOutcome,
} from '../../src/core/agent/agentBackend'
import { createReadingHolder } from '../../src/core/orchestration/playbook/readingHolder'
import { createSubagentAdmission } from '../../src/runtime/playbook/admission'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { UI_TEXT } from '../../src/shared/constants'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import {
  resourceStatusSchema,
  type ResourceLevel,
  type ResourceStatus,
} from '../../src/shared/resources'
import { collectingLogger } from './helpers/collectingLogger'

const CHILD: ItemSnapshot = {
  itemId: 'item-1',
  kind: 'subagent',
  status: 'completed',
  subagentId: 'subagent-1',
  objective: 'probe the admission',
}
const HISTORY: SessionHistoryOutcome = {
  mode: 'inline',
  items: [CHILD],
  name: undefined,
  todos: [],
}

const status = (level: ResourceLevel): ResourceStatus =>
  resourceStatusSchema.parse({
    level,
    sample: null,
    settings: {},
    queued: [],
    overrideUntilMs: null,
  })

function unused(name: string): () => never {
  return () => {
    throw new Error(`not used: ${name}`)
  }
}

function detachNothing(): void {
  return undefined
}

const ignoreSubscription = (): (() => void) => detachNothing

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

interface Drive {
  readonly chunks: string[]
  readonly controls: [string, string][]
  readonly asked: [string, string | undefined, string | undefined][]
  readonly messages: string[]
}

/** A real agent over a scripted backend, driven over real ACP; `level` is the governor reading. */
async function drive(
  command: string,
  level: ResourceLevel | undefined,
  hasAdmission: boolean,
): Promise<Drive> {
  const folder = mkdtempSync(path.join(tmpdir(), 'agent-admission-'))
  folders.push(folder)
  const messages: string[] = []
  const log = collectingLogger(messages)
  const controls: [string, string][] = []
  const session: AgentSession = {
    sessionId: 'session-1',
    modelId: 'meta/muse-test',
    onEvent: ignoreSubscription,
    sendTurn: unused('sendTurn'),
    setModelCallAllowance: unused('setModelCallAllowance'),
    steer: unused('steer'),
    cancel: unused('cancel'),
    setModel: unused('setModel'),
    setReasoningEffort: () => Promise.resolve(),
    setApprovalMode: unused('setApprovalMode'),
    compact: unused('compact'),
    decideApproval: unused('decideApproval'),
    answerQuestions: unused('answerQuestions'),
    cancelQuestions: unused('cancelQuestions'),
    deferQuestions: unused('deferQuestions'),
    clarifyQuestions: unused('clarifyQuestions'),
    moveToBackground: unused('moveToBackground'),
    stopTask: unused('stopTask'),
    stopAllTasks: unused('stopAllTasks'),
    runUserShell: unused('runUserShell'),
    controlSubagent: (subagentId, action) => {
      controls.push([subagentId, action])
      return Promise.resolve()
    },
    messageSubagent: unused('messageSubagent'),
    controlGoal: unused('controlGoal'),
    readOutput: unused('readOutput'),
    listSkills: () => Promise.resolve([]),
    rename: unused('rename'),
    dispose: () => undefined,
  }
  const host: AgentHost = {
    info: {
      kind: 'modelApi',
      serverName: 'scripted',
      serverVersion: '0',
      grantedCapabilities: [],
      canEditSessions: true,
    },
    onExit: ignoreSubscription,
    sessionCount: 1,
    listModels: () =>
      Promise.resolve([
        {
          modelId: 'meta/muse-test',
          displayLabel: 'test',
          contextLimit: undefined,
          isDefault: true,
          isActive: true,
        },
      ]),
    startSession: () => Promise.resolve(session),
    listSessions: unused('listSessions'),
    readSession: () => Promise.resolve(HISTORY),
    readSessionOutput: unused('readSessionOutput'),
    resumeSession: unused('resumeSession'),
    forkSession: unused('forkSession'),
    deleteSession: unused('deleteSession'),
    onSessionListEvent: unused('onSessionListEvent'),
    readUsage: unused('readUsage'),
    onUsageChanged: unused('onUsageChanged'),
    close: unused('close'),
  }
  const asked: [string, string | undefined, string | undefined][] = []
  let subagentAdmission: SubagentAdmission | undefined
  if (hasAdmission) {
    const real = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(level === undefined ? undefined : status(level)),
    })
    subagentAdmission = (kind, sessionId, targetId, effect, isOver, refused) => {
      asked.push([kind, sessionId, targetId])
      return real(kind, sessionId, targetId, effect, isOver, refused)
    }
  }
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.19.0',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
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
    log,
    questions: 'decline',
    ...(subagentAdmission !== undefined && { subagentAdmission }),
  })
  const chunks: string[] = []
  const editor = acp
    .client({ name: 'agent-admission' })
    .onRequest('session/request_permission', () =>
      Promise.resolve({ outcome: { outcome: 'selected', optionId: 'recover' } }),
    )
    .onNotification('session/update', (context) => {
      const update = context.params.update
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
        chunks.push(update.content.text)
      return Promise.resolve()
    })
  await editor.connectWith(agent, async (peer) => {
    await peer.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    const created = await peer.request('session/new', { cwd: folder, mcpServers: [] })
    const answer = await peer.request('session/prompt', {
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: command }],
    })
    expect(answer.stopReason).toBe('end_turn')
  })
  return { chunks, controls, asked, messages }
}

describe('/agents through the child-work admission', () => {
  it('refuses the resume at pause: the person hears it, the backend hears nothing', async () => {
    const { chunks, controls, asked, messages } = await drive(
      '/agents continue subagent-1',
      'pause',
      true,
    )
    expect(asked).toEqual([['delegate', 'session-1', 'subagent-1']])
    expect(controls).toEqual([])
    expect(chunks.join('\n')).toContain(UI_TEXT.agentResumePaused)
    expect(messages.some((message) => message.includes('A child resume was refused'))).toBe(true)
  })

  it('admits below pause: the control runs as before', async () => {
    const { chunks, controls, asked } = await drive('/agents continue subagent-1', 'normal', true)
    expect(asked).toEqual([['delegate', 'session-1', 'subagent-1']])
    expect(controls).toEqual([['subagent-1', 'continue']])
    expect(chunks.join('\n')).toContain('subagent-1')
    expect(chunks.join('\n')).not.toContain(UI_TEXT.agentResumePaused)
  })

  it('retry goes through the same admission', async () => {
    const { chunks, controls, asked } = await drive('/agents retry subagent-1', 'pause', true)
    expect(asked).toEqual([['delegate', 'session-1', 'subagent-1']])
    expect(controls).toEqual([])
    expect(chunks.join('\n')).toContain(UI_TEXT.agentResumePaused)
  })

  it('without the admission the control runs unconsulted', async () => {
    const { chunks, controls, asked } = await drive('/agents continue subagent-1', 'pause', false)
    expect(asked).toEqual([])
    expect(controls).toEqual([['subagent-1', 'continue']])
    expect(chunks.join('\n')).not.toContain(UI_TEXT.agentResumePaused)
  })
})
