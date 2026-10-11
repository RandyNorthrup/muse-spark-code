// Child process owns a real ACP prompt queued behind a held fake-HTTP turn.
// Parent kills it without release/cleanup, then reopens the durable answer queue.
import * as acp from '@agentclientprotocol/sdk'
import type { AgentSession } from '../../../../src/core/agent/agentBackend'
import { createAcpAgent } from '../../../../src/acp/agent'
import { AcpPaidUse } from '../../../../src/acp/paid'
import * as questionBundle from '../../../../src/acp/questionDeferralEntry'
import { createRuntimeQuestionRegistry } from '../../../../src/runtime/questions/acpRegistry'
import { queuedAnswerBackend } from './queuedAnswerBackend'
import { memoryPaidGrants } from '../paidGrants'
import { UI_TEXT } from '../../../../src/shared/constants'
import path from 'node:path'
import { setImmediate as nextTick } from 'node:timers/promises'

async function main() {
  const directory = process.argv[2]
  if (directory === undefined) throw new Error('Missing crash-test queue directory')
  const cwd = path.resolve(directory)
  const log = {
    trace() {
      return
    },
    info() {
      return
    },
    warn() {
      return
    },
    error() {
      return
    },
  }
  const { host, api } = queuedAnswerBackend(cwd, log)
  const sessions: AgentSession[] = []
  const registries: ReturnType<typeof createRuntimeQuestionRegistry>[] = []
  const updates: acp.SessionUpdate[] = []
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.0.0-test',
    defaultCwd: cwd,
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'fake', name: 'Fake', description: 'Fake', command: 'fake', args: [] },
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    questionBundle: () => questionBundle,
    questions: (input) => {
      sessions.push(input.session)
      const registry = createRuntimeQuestionRegistry(input, directory, 'modelApi', () => {
        throw new Error('Crash fixture persistence failed')
      })
      registries.push(registry)
      return registry
    },
  })
  const client = acp
    .client({ name: 'crash-test' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params.update)
    })
  await client.connectWith(agent, async (context) => {
    await context.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
    const { sessionId } = await context.request('session/new', { cwd, mcpServers: [] })
    const session = sessions[0]!
    const queued = Promise.withResolvers<undefined>()
    const original = session.sendTurn.bind(session)
    session.sendTurn = async (...args) => {
      const submission = await original(...args)
      if (submission.disposition === 'queued') queued.resolve(undefined)
      return submission
    }
    api.script({ text: 'held', hold: Promise.withResolvers<undefined>().promise })
    await session.sendTurn([{ type: 'text', text: 'running elsewhere' }])
    await registries[0]!.queue({
      sessionId,
      userInputId: 'late',
      text: 'late: blue',
      displayText: undefined,
    })
    void context
      .request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'continue' }] })
      .catch(() => undefined)
    await queued.promise
    await nextTick()
    await registries[0]!.flush()
    await context.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: '/questions' }],
    })
    process.stdout.write(
      JSON.stringify({
        sessionId,
        isSent: JSON.stringify(updates).includes(UI_TEXT.announceLateAnswerSent),
      }) + '\n',
    )
    setInterval(() => undefined, 1000)
    await Promise.withResolvers<undefined>().promise
  })
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
