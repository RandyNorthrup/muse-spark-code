// RVCX1F F1: ACP decides a dormant local command on the text the skill parser
// itself reads (slashCommandText), so no spelling of `/schedule`, `/estimate`
// or `/accounts` passes its refusal and then runs a workspace skill of that
// name or starts a model turn.
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { UI_TEXT } from '../../src/shared/constants'
import { parseSkillInvocation, slashCommandText } from '../../src/shared/mentions'
import { testAgentBase } from './helpers/acpAgentBase'
import { openHandshakeSession } from './helpers/acpWaits'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'

const WORKSPACE = process.cwd()
const RESERVED = ['schedule', 'estimate', 'accounts']
type Prompt = readonly { readonly type: 'text'; readonly text: string }[]

interface Observation {
  /** Text the agent answered with, one entry per chunk. */
  readonly replies: readonly string[]
  /** Messages of the prompts the agent refused with a request error. */
  readonly refusals: readonly string[]
  /** Turns that reached the backend session. */
  readonly backendTurns: number
  /** Calls into the unavailable schedule and estimate owners. */
  readonly ownerCalls: number
}

/**
 * Sends each prompt to one session of the production agent whose schedule and
 * estimate owners are unavailable and which has no accounts binding, while the
 * backend lists a workspace skill for each of `skills`.
 */
async function observe(
  prompts: readonly Prompt[],
  skills: readonly string[],
): Promise<Observation> {
  const host = new FakeAgentHost()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const owner = vi.fn().mockResolvedValue('an unavailable owner ran')
  const replies: string[] = []
  const refusals: string[] = []
  const counted = { backendTurns: 0 }
  const agent = createAcpAgent({
    ...testAgentBase(host),
    questions: 'decline',
    signIn: { id: 'dispatch', name: 'Dispatch', description: '', command: 'dispatch', args: [] },
    defaultCwd: WORKSPACE,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    schedules: { isAvailable: false, run: owner },
    estimate: { isAvailable: false, run: owner },
    log,
  })
  const editor = acp
    .client({ name: 'dispatch-editor' })
    .onNotification('session/update', ({ params: { update } }) => {
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
        replies.push(update.content.text)
    })
  await editor.connectWith(agent, async (connection) => {
    const { sessionId } = await openHandshakeSession(connection, WORKSPACE)
    const [session] = host.sessions
    if (session === undefined) throw new Error('the backend session did not start')
    session.skills = skills.map((selector) => ({
      selector,
      displayName: `Workspace ${selector}`,
      description: 'workspace skill',
      argumentHint: undefined,
    }))
    // A turn that does reach the backend fails at once instead of waiting for
    // a completion nothing sends, so a missed refusal is counted, not timed out.
    session.sendTurn.mockRejectedValue(new Error('a backend turn started'))
    for (const prompt of prompts) {
      try {
        await connection.request('session/prompt', { sessionId, prompt: [...prompt] })
      } catch (error: unknown) {
        refusals.push(error instanceof Error ? error.message : String(error))
      }
    }
    counted.backendTurns = session.sendTurn.mock.calls.length
  })
  return {
    replies,
    refusals,
    backendTurns: counted.backendTurns,
    ownerCalls: owner.mock.calls.length,
  }
}

const one = (text: string): Prompt => [{ type: 'text', text }]

describe.each([
  ['a workspace skill of the same name', RESERVED],
  ['no workspace skill', []],
] as const)('RVCX1F F1: dormant ACP commands with %s', (_case, skills) => {
  it.each([
    ['/schedule', 'a leading space', ' /schedule list'],
    ['/schedule', 'a leading newline', '\n/schedule list'],
    ['/schedule', 'a leading tab', '\t/schedule list'],
    ['/schedule', 'leading blank lines and a draft', ' \r\n\t /schedule add {}'],
    ['/schedule', 'trailing whitespace', '/schedule \n'],
    ['/estimate', 'a leading space', ' /estimate goal'],
    ['/estimate', 'a leading newline', '\n/estimate goal'],
    ['/estimate', 'a leading tab', '\t/estimate goal'],
  ])('refuses %s typed with %s', async (command, _spelling, text) => {
    const seen = await observe([one(text)], skills)
    expect(seen.backendTurns).toBe(0)
    expect(seen.ownerCalls).toBe(0)
    expect(seen.refusals).toEqual([])
    expect(seen.replies).toEqual([
      command === '/schedule'
        ? UI_TEXT.scheduleV2.runtime.unavailable
        : UI_TEXT.estimateRuntimeUnavailable,
    ])
  })

  it.each([
    ['a leading space', ' /accounts'],
    ['a leading newline', '\n/accounts list'],
    ['a leading tab', '\t/accounts current'],
  ])('refuses /accounts typed with %s while no accounts are bound', async (_spelling, text) => {
    const seen = await observe([one(text)], skills)
    expect(seen.backendTurns).toBe(0)
    expect(seen.replies).toEqual([])
    expect(seen.refusals).toHaveLength(1)
    expect(seen.refusals[0]).toContain(UI_TEXT.accounts.unavailable)
  })

  it('refuses a dormant command sent after an empty first text block', async () => {
    const seen = await observe(
      [
        [
          { type: 'text', text: '' },
          { type: 'text', text: '/schedule list' },
        ],
        [
          { type: 'text', text: '  ' },
          { type: 'text', text: '/estimate goal' },
        ],
      ],
      skills,
    )
    expect(seen.backendTurns).toBe(0)
    expect(seen.ownerCalls).toBe(0)
    expect(seen.replies).toEqual([
      UI_TEXT.scheduleV2.runtime.unavailable,
      UI_TEXT.estimateRuntimeUnavailable,
    ])
  })
})

describe('RVCX1F F1: one normalisation for refusals and skills', () => {
  it('the skill parser matches exactly the text slashCommandText returns', () => {
    for (const text of [' /schedule list', '\n/schedule list', '\t/schedule list ', '/schedule']) {
      const typed = slashCommandText(text)
      expect(typed.startsWith('/schedule')).toBe(true)
      expect(parseSkillInvocation(text, new Set(['schedule']))).toEqual(
        parseSkillInvocation(typed, new Set(['schedule'])),
      )
    }
  })

  it('still sends ordinary text and a bound workspace skill to the backend', async () => {
    const seen = await observe([one(' /deploy now'), one('plain words')], ['deploy'])
    // Both reach the backend (which this harness fails at once), as before.
    expect(seen.backendTurns).toBe(2)
    expect(seen.ownerCalls).toBe(0)
  })
})
