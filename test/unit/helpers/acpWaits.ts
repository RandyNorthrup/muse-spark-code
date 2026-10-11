// Shared by the ACP agent's suites: waiting on a condition the agent reaches
// asynchronously, a command approval as the backend raises it, and one local
// text prompt answered without a model turn.

import type * as acp from '@agentclientprotocol/sdk'
import type { AgentEvent, ApprovalChoice } from '../../../src/shared/agentEvents'

const POLL_MS = 5
const WAIT_MS = 2000

/** Resolves once `isMet` holds, polling; fails the test after two seconds. */
export async function until(isMet: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!isMet()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** Send one local text prompt (`/help`, `/vault status`) and return its reply. */
export async function promptLocalText(
  run: <T>(work: (client: acp.ClientContext) => Promise<T>) => Promise<T>,
  start: (client: acp.ClientContext) => Promise<{ sessionId: string }>,
  text: string,
): Promise<unknown> {
  return await run(async (client) => {
    const { sessionId } = await start(client)
    return await client.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    })
  })
}

/** A shell command's approval (`npm test`) offering `choices`. */
export function commandApproval(
  choices: ApprovalChoice[],
  overrides: Partial<Extract<AgentEvent, { type: 'approvalRequested' }>> = {},
): Extract<AgentEvent, { type: 'approvalRequested' }> {
  return {
    type: 'approvalRequested',
    approvalId: 'approval-1',
    itemId: 'tool-1',
    toolName: 'powershell',
    rawArgs: JSON.stringify({ command: 'npm test' }),
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: { kind: 'command', command: 'npm test' },
    availableChoices: choices,
    isJudgeEscalated: false,
    isProtectedWrite: false,
    ...overrides,
  }
}
