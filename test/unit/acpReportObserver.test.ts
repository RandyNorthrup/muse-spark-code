// Report a problem, lane A (M93, PLAN.md D72): the ACP error-observer
// region in src/acp/agent.ts. Errors are observed into the recorder as
// fixed kind-plus-code facts — never messages, stacks, paths, prompts or
// session ids — without changing ACP stdout: the client sees exactly the
// frames it would see with no observer at all.

import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { type AcpAgentDeps, type AcpErrorFact, createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import type { AgentEvent, ApprovalChoice } from '../../src/shared/agentEvents'
import { FakeAgentHost, type FakeAgentSession } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { commandApproval, until } from './helpers/acpWaits'

const CWD = process.platform === 'win32' ? String.raw`C:\\work\\app` : '/work/app'

const CHOICES: ApprovalChoice[] = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
]

interface ObserverHarness {
  readonly host: FakeAgentHost
  readonly facts: AcpErrorFact[]
  readonly updates: acp.SessionUpdate[]
  readonly warn: ReturnType<typeof vi.fn>
  run<T>(op: (client: acp.ClientContext) => Promise<T>): Promise<T>
}

/**
 * The agent against a scripted backend. `'collect'` observes facts into
 * `facts`; a function is wired as the observer; undefined wires none. The
 * test client's permission answers always fail, so the denial path observes.
 */
function observerHarness(reportError?: AcpAgentDeps['reportError'] | 'collect'): ObserverHarness {
  const host = new FakeAgentHost()
  const facts: AcpErrorFact[] = []
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const paid = new AcpPaidUse({
    flagged: [],
    canRemember: () => false,
    grants: memoryPaidGrants(),
    log,
  })
  const deps: AcpAgentDeps = {
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.0.0-test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'muse-code-login',
      name: 'Sign in',
      description: 'Sign in to Muse Code',
      args: ['login'],
      command: 'muse-spark-code-acp login',
    },
    defaultCwd: CWD,
    paid,
    log,
    ...(reportError !== undefined && {
      reportError:
        reportError === 'collect'
          ? (fact: AcpErrorFact) => {
              facts.push(fact)
            }
          : reportError,
    }),
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: 'test-client' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', () => {
      throw new Error('the editor exploded: hunter2-secret')
    })
  return {
    host,
    facts,
    updates,
    warn: log.warn,
    run: (op) => client.connectWith(agent, op),
  }
}

/**
 * One prompt that runs `prepare` once the session exists (before the turn
 * starts, so a failing skills read is armed in time), plays `events` once
 * the turn starts, then completes it.
 */
async function promptedTurn(
  h: ObserverHarness,
  client: acp.ClientContext,
  options: {
    prepare?: (session: FakeAgentSession) => void
    events?: (session: FakeAgentSession) => Promise<void> | void
  } = {},
): Promise<unknown> {
  await client.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  const { sessionId } = await client.request('session/new', { cwd: CWD, mcpServers: [] })
  const session = h.host.sessions.at(-1)
  if (session === undefined) {
    throw new Error('no session')
  }
  options.prepare?.(session)
  const calls = session.sendTurn.mock.calls.length
  const response = client.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'hello' }],
  })
  await until(() => session.sendTurn.mock.calls.length > calls)
  await options.events?.(session)
  session.emit({
    type: 'turnCompleted',
    turnId: `turn-${String(calls + 1)}`,
    terminal: 'completed',
  })
  return await response
}

function approval(): Extract<AgentEvent, { type: 'approvalRequested' }> {
  return commandApproval(CHOICES)
}

describe('the ACP error observer (M93 lane A)', () => {
  it('observes a failed skills read as facts only, and ACP stdout is unchanged', async () => {
    const observed = observerHarness('collect')
    const plain = observerHarness()
    const answers: unknown[] = []
    for (const h of [observed, plain]) {
      await h.run(async (client) => {
        const answer = await promptedTurn(h, client, {
          prepare: (session) => {
            session.listSkills.mockRejectedValueOnce(
              new Error('the skill index exploded: hunter2-secret'),
            )
          },
        })
        answers.push(answer)
      })
    }

    // Facts only: the fixed kind and code, never the error's message.
    expect(observed.facts).toEqual([{ kind: 'errorNotice', code: 'skillsUnavailable' }])
    expect(JSON.stringify(observed.facts)).not.toContain('exploded')
    expect(JSON.stringify(observed.facts)).not.toContain('hunter2')
    // The client saw the same answer and the same frames either way.
    expect(answers[0]).toEqual(answers[1])
    expect(observed.updates).toEqual(plain.updates)
    expect(observed.warn).toHaveBeenCalled()
  })

  it('observes a failed permission request as facts only, and the turn is still denied', async () => {
    const h = observerHarness('collect')
    await h.run(async (client) => {
      await promptedTurn(h, client, {
        events: async (session) => {
          session.emit(approval())
          await until(() => session.decideApproval.mock.calls.length === 1)
        },
      })
    })
    expect(h.facts).toEqual([{ kind: 'errorNotice', code: 'permissionRequestFailed' }])
    expect(JSON.stringify(h.facts)).not.toContain('exploded')
    // A request the editor could not answer is denied, as without the observer.
    expect(h.host.sessions[0]?.decideApproval.mock.calls[0]?.[0]).toMatchObject({
      approvalId: 'approval-1',
    })
  })

  it('a throwing observer never breaks the session, and none is needed', async () => {
    for (const reportError of [
      () => {
        throw new Error('the journal is on fire')
      },
      undefined,
    ] as const) {
      const h = observerHarness(reportError)
      await h.run(async (client) => {
        await promptedTurn(h, client, {
          prepare: (session) => {
            session.listSkills.mockRejectedValueOnce(new Error('unavailable'))
          },
        })
      })
      expect(h.facts).toEqual([])
    }
  })
})
