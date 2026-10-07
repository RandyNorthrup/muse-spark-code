import { describe, expect, it, vi } from 'vitest'
import {
  agentActivity,
  endedOutcome,
  agentStateText,
  type AgentEvidence,
} from '../../src/shared/agentOutcome'
import { buildAgentReceipt, agentFilesFromPatch } from '../../src/shared/agentReceipt'
import { continuationNote, recoveryRefusal, recoveryStamp } from '../../src/shared/agentRecovery'
import { finishedAgentEvidence } from '../../src/core/agent/agentEvidence'
import { agentListingText, listedAgents } from '../../src/core/agent/agentListing'
import { observeAgentItem, observeChildReceipt } from '../../src/core/agent/agentObservation'
import { agentReceiptFiles } from '../../src/core/agent/agentReceiptFiles'
import { AGENT_ACTIVITY_WINDOW_MS, AGENT_RECEIPT_MAX_CHARS } from '../../src/shared/constants'
import type { ItemSnapshot } from '../../src/shared/agentEvents'

const complete: AgentEvidence = {
  stopReason: 'normal',
  reportedComplete: true,
  unfinished: [],
  finalCheck: 'passed',
  worktree: 'clean',
}
const done = (evidence?: AgentEvidence) => ({ status: 'completed', evidence })

describe('D101 structured outcomes', () => {
  it.each([
    [complete, 'complete'],
    [{ ...complete, stopReason: 'budget' }, 'incomplete'],
    [{ ...complete, worktree: 'dirty' }, 'incomplete'],
    [{ ...complete, unfinished: ['commit the change'] }, 'incomplete'],
    [{ ...complete, checksRequired: true, finalCheck: 'missing' }, 'incomplete'],
    [{ ...complete, finalCheck: 'failed' }, 'failed'],
    [{ ...complete, stopReason: 'error' }, 'failed'],
    [{ ...complete, stopReason: 'cancelled' }, 'cancelled'],
    [{ ...complete, worktree: 'unknown' }, 'unverified'],
  ] satisfies [AgentEvidence, string][])('maps %j to %s', (evidence, outcome) => {
    expect(endedOutcome(done(evidence))).toBe(outcome)
  })
  it('never turns a clean end or a free-text claim into success', () => {
    expect(endedOutcome(done())).toBe('unverified')
    expect(
      buildAgentReceipt([], undefined, 'incomplete: failed, finished everything').stopReason,
    ).toBe('unknown')
    expect(endedOutcome({ status: 'failed' })).toBe('failed')
    expect(endedOutcome({ status: 'cancelled' })).toBe('cancelled')
  })
  it('maps the captured Muse and workflow states, and owned Model API waiting', () => {
    expect(agentActivity({ status: 'inProgress' }, 0).activity).toBe('active')
    expect(agentActivity({ status: 'inProgress', controlStatus: 'queued' }, 0)).toEqual({
      activity: 'waiting',
      reason: 'queued',
    })
    expect(agentActivity({ status: 'cancelled', controlStatus: 'interrupted' }, 0)).toEqual({
      activity: 'waiting',
      reason: 'interrupted',
    })
    expect(
      agentActivity({ status: 'inProgress', evidence: { waiting: 'approval' } }, 0).activity,
    ).toBe('waiting')
    expect(agentActivity({ status: 'inProgress', evidence: { waiting: 'input' } }, 0).reason).toBe(
      'input',
    )
    expect(agentActivity({ status: 'completed', controlStatus: 'resultReady' }, 0).activity).toBe(
      'inactive',
    )
    expect(agentStateText(done(), 0)).toBe('Inactive · Ended, unverified')
    expect(agentActivity({ status: 'future' }, 0).reason).toBe('idle')
  })
  it('bounds the recent-output window', () => {
    const agent = { status: 'future', evidence: { lastOutputAt: 100 } }
    expect(agentActivity(agent, 100 + AGENT_ACTIVITY_WINDOW_MS).activity).toBe('active')
    expect(agentActivity(agent, 101 + AGENT_ACTIVITY_WINDOW_MS).activity).toBe('waiting')
  })
  it('uses the last structured check and configured command, not its output text', () => {
    const item: ItemSnapshot = {
      itemId: 'c',
      kind: 'toolCall',
      status: 'completed',
      tool: 'powershell',
      args: '{"command":"npm test"}',
      exitCode: 1,
      visibleOutput: 'all passed',
    }
    const required = [{ name: 'tests', command: 'npm test' }]
    expect(finishedAgentEvidence([item], [], 'normal', required).finalCheck).toBe('failed')
    expect(
      finishedAgentEvidence([item, { ...item, exitCode: 0 }], [], 'normal', required).finalCheck,
    ).toBe('passed')
    expect(finishedAgentEvidence([], [], 'normal', required).finalCheck).toBe('missing')
    expect(
      finishedAgentEvidence([], [{ text: 'ship', status: 'pending' }], 'normal', []).unfinished,
    ).toEqual(['ship'])
  })
  it('lists subagents, workflow children and background tasks with the same mapping', () => {
    const items: ItemSnapshot[] = [
      {
        itemId: 'a',
        subagentId: 'child',
        kind: 'subagent',
        status: 'completed',
        agentEvidence: { stopReason: 'budget' },
      },
      {
        itemId: 'w',
        kind: 'workflow',
        status: 'completed',
        children: [{ childId: 'c', attempt: 1, status: 'completed', terminal: 'completed' }],
      },
      { itemId: 'b', kind: 'toolCall', background: true, status: 'failed' },
      { itemId: 'exit', kind: 'toolCall', background: true, status: 'completed', exitCode: 1 },
    ]
    expect(listedAgents(items)).toHaveLength(4)
    expect(agentListingText(items, 0)).toContain('Inactive · Incomplete')
    expect(agentListingText(items, 0)).toContain('w/c')
    expect(agentListingText(items, 0)).toContain('Inactive · Ended, unverified')
    expect(agentListingText(items, 0)).toContain('Inactive · Failed')
    expect(agentListingText(items, 0)).toContain('exit ·')
  })
})

describe('agent receipts and recovery', () => {
  it('keeps recovery confirmation valid as elapsed duration changes, and invalidates a new attempt', () => {
    const item: ItemSnapshot = {
      itemId: 'a',
      kind: 'subagent',
      status: 'failed',
      durationMs: 1,
      agentEvidence: { attempt: 1 },
    }
    expect(recoveryStamp({ ...item, durationMs: 100 })).toBe(recoveryStamp(item))
    expect(recoveryStamp({ ...item, agentEvidence: { attempt: 2 } })).not.toBe(recoveryStamp(item))
    expect(recoveryStamp({ ...item, status: 'inProgress' })).not.toBe(recoveryStamp(item))
  })
  it('adds captured child check evidence without certifying an unknown native stop', () => {
    const parent = observeAgentItem(
      undefined,
      { itemId: 'a', kind: 'subagent', status: 'completed' },
      0,
    )
    const tool: ItemSnapshot = {
      itemId: 't',
      kind: 'toolCall',
      status: 'completed',
      tool: 'powershell',
      args: '{"command":"npm test"}',
      exitCode: 1,
    }
    const failed = observeChildReceipt(parent, [tool], [])
    expect(endedOutcome({ status: failed.status, evidence: failed.agentEvidence })).toBe('failed')
    const replayed = observeAgentItem(
      failed,
      { itemId: 'a', kind: 'subagent', status: 'completed' },
      0,
    )
    expect(replayed.agentEvidence?.attempts?.at(-1)?.outcome).toBe('failed')
    expect(replayed.agentEvidence?.attempts?.at(-1)?.receipt.checks).toHaveLength(1)
    const passed = observeChildReceipt(
      parent,
      [{ ...tool, exitCode: 0 }],
      [{ text: 'done', status: 'completed' }],
    )
    expect(endedOutcome({ status: passed.status, evidence: passed.agentEvidence })).toBe(
      'unverified',
    )
  })
  it('keeps observed native attempts and trusts the workflow attempt number', () => {
    const first: ItemSnapshot = {
      itemId: 'a',
      kind: 'subagent',
      status: 'failed',
      result: { summary: 'first failure', text: 'first failure' },
    }
    const ended = observeAgentItem(undefined, first, 0)
    const running = observeAgentItem(
      ended,
      { itemId: 'a', kind: 'subagent', status: 'inProgress' },
      0,
    )
    const second = observeAgentItem(
      running,
      {
        itemId: 'a',
        kind: 'subagent',
        status: 'completed',
        result: { summary: 'second end', text: 'second end' },
      },
      0,
    )
    expect(
      second.agentEvidence?.attempts?.map((attempt) => [
        attempt.number,
        attempt.outcome,
        attempt.receipt.finalMessage,
      ]),
    ).toEqual([
      [1, 'failed', 'first failure'],
      [2, 'unverified', 'second end'],
    ])
    const workflow: ItemSnapshot = {
      itemId: 'w',
      kind: 'workflow',
      status: 'inProgress',
      children: [{ childId: 'c', attempt: 1, status: 'failed', terminal: 'failed' }],
    }
    const observed = observeAgentItem(undefined, workflow, 0)
    const updated = observeAgentItem(
      observed,
      { ...workflow, children: [{ childId: 'c', attempt: 2, status: 'started' }] },
      0,
    )
    const final = observeAgentItem(
      updated,
      {
        ...workflow,
        children: [{ childId: 'c', attempt: 2, status: 'completed', terminal: 'completed' }],
      },
      0,
    )
    expect(
      final.agentWorkflowEvidence?.['w/c']?.attempts?.map((attempt) => [
        attempt.number,
        attempt.outcome,
      ]),
    ).toEqual([
      [1, 'failed'],
      [2, 'unverified'],
    ])
  })
  it('reads captured patch refs locally within a hard page budget and refuses partial evidence', async () => {
    expect(agentFilesFromPatch('{}')).toBeUndefined()
    const item: ItemSnapshot = {
      itemId: 'edit',
      kind: 'toolCall',
      status: 'completed',
      patchRef: { id: 'p', byteLen: 100 },
    }
    const read = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        files: [
          {
            path: String.raw`src\a.ts`,
            hunks: [{ oldStart: 1, newStart: 1, lines: ['-old', '+new', '+more'] }],
          },
        ],
      }),
      byteLen: 100,
      eof: true,
    })
    const inspected = await agentReceiptFiles([item], read)
    expect(inspected[0]?.changedFiles).toEqual([{ path: 'src/a.ts', added: 2, removed: 1 }])
    expect(read).toHaveBeenCalledWith({
      itemId: 'edit',
      outputRef: 'p',
      offsetBytes: 0,
      lengthBytes: AGENT_RECEIPT_MAX_CHARS,
    })
    read.mockResolvedValue({ content: '{}', byteLen: AGENT_RECEIPT_MAX_CHARS, eof: false })
    const partial = await agentReceiptFiles([item, { ...item, itemId: 'edit2' }], read)
    expect(partial.every((row) => row.changedFiles === undefined)).toBe(true)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('keeps command exits, duration and Windows-normalized file counts, and redacts before clipping', () => {
    const receipt = buildAgentReceipt(
      [
        {
          itemId: 't',
          kind: 'toolCall',
          status: 'completed',
          tool: 'powershell',
          args: '{"command":"npm test"}',
          exitCode: 0,
          durationMs: 100,
          changedFiles: [{ path: String.raw`src\app.ts`, added: 2, removed: 1 }],
        },
      ],
      complete,
      'LLM|1|fake-secret',
    )
    expect(receipt.files[0]).toEqual({ path: 'src/app.ts', added: 2, removed: 1 })
    expect(receipt.checks[0]).toEqual({ command: 'npm test', exitCode: 0, durationMs: 100 })
    expect(receipt.finalMessage).toBe('[redacted]')
    const clipped = buildAgentReceipt([], undefined, 'x'.repeat(AGENT_RECEIPT_MAX_CHARS + 1))
    expect(clipped.finalMessage).toHaveLength(AGENT_RECEIPT_MAX_CHARS)
    expect(clipped.truncated).toBe(true)
  })
  it('keeps the original objective verbatim after failure context, and refuses unsupported retries', () => {
    const receipt = buildAgentReceipt([], { stopReason: 'budget', unfinished: ['run checks'] })
    const objective = 'Keep my objective\nunchanged.'
    expect(continuationNote(receipt, objective, 'Continue')).toContain('run checks')
    expect(continuationNote(receipt, objective, 'Continue').endsWith(objective)).toBe(true)
    expect(
      recoveryRefusal({ status: 'completed', evidence: { stopReason: 'budget' } }, 'continue', 0),
    ).toBeUndefined()
    expect(recoveryRefusal(done(complete), 'continue', 0)).toBeDefined()
    expect(recoveryRefusal(done(), 'retry', 0)).toContain('no isolated worktree checkpoint')
  })
})
