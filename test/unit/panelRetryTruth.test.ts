// TRUTHPANEL: the panel's confirmed Agent-map continue/retry says the real
// cause. A missing agent says the agent is gone — only a backend without a
// checkpoint may blame the checkpoint — and anything else proceeds so the
// backend's own failure carries its own cause.
import { describe, expect, it } from 'vitest'
import { panelRecoveryRefusal } from '../../src/shared/agentRecovery'
import { UI_TEXT } from '../../src/shared/constants'
import type { ItemSnapshot } from '../../src/shared/agentEvents'

function agentRow(status: string): ItemSnapshot {
  return { itemId: 'item-1', kind: 'subagent', status, subagentId: 'agent-1' }
}

describe('the panel retry/continue pre-flight', () => {
  it('says the agent is gone when its row is missing, never the checkpoint', () => {
    expect(panelRecoveryRefusal(undefined, undefined)).toBe(UI_TEXT.agentGone)
    expect(UI_TEXT.agentGone).not.toBe(UI_TEXT.agentRetryUnavailable)
    expect(UI_TEXT.agentGone).not.toBe(UI_TEXT.agentContinueUnavailable)
    expect(UI_TEXT.agentGone.toLowerCase()).not.toContain('checkpoint')
    expect(UI_TEXT.agentGone.toLowerCase()).not.toContain('worktree')
  })

  it('refuses a live update under the dialog with the stale-state message', () => {
    expect(panelRecoveryRefusal(agentRow('done'), agentRow('running'))).toBe(
      UI_TEXT.agentContinueUnavailable,
    )
  })

  it('proceeds when the agent is unchanged, so the backend carries the cause', () => {
    const agent = agentRow('done')
    expect(panelRecoveryRefusal(agent, agent)).toBeUndefined()
  })
})
