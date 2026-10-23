// RLF-M47: the workflow card's owner controls, wired to M127's wraps. Every
// frame below is a recorded exchange with Muse Code 1.4.11 (1.4.11-R6667.1)
// over stdio MSP on 2026-10-23 (test/fixtures/m47/provenance.json): three
// live rounds on muse-spark-1.3-contributor, 22 model attempts, an accepted
// workflow/cancel, workflow/childControl skip and retry, workflow/pause and
// workflow/resume, each with its outcome, plus the scheduled-child and
// settled-run refusals.

import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workflowChildAttempt } from '../../src/host/conversation/conversationController'
import type { ConversationMessage } from '../../src/host/views/chatSurface'
import {
  workflowControlResultSchema,
  workflowResumeResultSchema,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { itemSnapshotSchema, type ItemSnapshot } from '../../src/shared/agentEvents'
import { workflowChildSchema } from '../../src/shared/workflowChild'
import { DEFAULT_MODEL_ID, UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'
import { transcriptEntrySchema } from '../../src/webview/state/transcriptEntries'
import {
  awaitSaved,
  conversationPanel,
  modelApiRig,
  panelNotices,
} from './helpers/conversationPanel'
import { closeLiveHosts, refuseUnscripted, startLiveSession } from './helpers/museReplay'
import { removeFolder } from './helpers/temporaryFolders'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m47/${name}`, import.meta.url), 'utf8'))
}

interface CommandFrame {
  method: string
  commandId: string
  params: Record<string, unknown>
  ack: unknown
  outcome: Record<string, { note: string; at: string; item: unknown }>
}

interface RefusalFrame {
  method: string
  commandId: string
  params: Record<string, unknown>
  error: { message: string; code: number; kind: string; data: Record<string, unknown> }
}

function commandOf(name: string): CommandFrame {
  return fixture(name) as CommandFrame
}

function itemOf(frame: CommandFrame, key: string): ItemSnapshot {
  return itemSnapshotSchema.parse(frame.outcome[key]?.item)
}

function childRows(item: ItemSnapshot, childId: string): { attempt: number; status: string }[] {
  const rows: { attempt: number; status: string }[] = []
  const children = item.children ?? []
  for (const raw of children) {
    const child = workflowChildSchema.safeParse(raw).data
    if (child?.childId !== childId) continue
    rows.push({
      attempt: child.attempt,
      status: typeof child.terminal === 'string' ? child.terminal : child.status,
    })
  }
  return rows
}

afterEach(async () => {
  await closeLiveHosts()
})

describe('accepted workflow controls and their outcomes', () => {
  it('pairs the recorded cancel ack with its cancelled settlement by commandId', () => {
    const frame = commandOf('workflow-cancel-accepted.json')
    expect(frame.method).toBe('workflow/cancel')
    const ack = workflowControlResultSchema.parse(frame.ack)
    expect(ack).toEqual({ commandId: frame.commandId, status: 'accepted' })
    const terminal = itemOf(frame, 'terminal')
    expect(frame.outcome['terminal']?.note).toBe('item/completed')
    expect(terminal.status).toBe('cancelled')
    // The drain ends every attempt; the reconciled message carries no summary.
    const drained = terminal.children ?? []
    for (const raw of drained) {
      expect(raw).toMatchObject({ status: 'terminal', terminal: 'cancelled' })
    }
    expect(terminal.message).toContain('"final_summary":null')
  })

  it('ends the skipped attempt with no new one', () => {
    const frame = commandOf('workflow-childControl-skip.json')
    expect(frame.params).toMatchObject({ action: 'skip', attempt: 1 })
    const ack = workflowControlResultSchema.parse(frame.ack)
    expect(ack).toEqual({ commandId: frame.commandId, status: 'accepted' })
    const childId = frame.params['childId'] as string
    // The attempt was in flight when the control landed.
    expect(childRows(itemOf(frame, 'before'), childId)).toEqual([{ attempt: 1, status: 'started' }])
    expect(childRows(itemOf(frame, 'settled'), childId)).toEqual([
      { attempt: 1, status: 'cancelled' },
    ])
    // Terminal, and no rescheduled attempt beside it (unlike a retry).
    expect(childRows(itemOf(frame, 'terminal'), childId)).toEqual([
      { attempt: 1, status: 'cancelled' },
    ])
  })

  it('reschedules the retried child under the same id', () => {
    const frame = commandOf('workflow-childControl-retry.json')
    expect(frame.params).toMatchObject({ action: 'retry', attempt: 1 })
    const ack = workflowControlResultSchema.parse(frame.ack)
    expect(ack).toEqual({ commandId: frame.commandId, status: 'accepted' })
    const childId = frame.params['childId'] as string
    expect(childRows(itemOf(frame, 'attemptCancelled'), childId)).toEqual([
      { attempt: 1, status: 'cancelled' },
    ])
    expect(childRows(itemOf(frame, 'attemptRescheduled'), childId)).toEqual([
      { attempt: 1, status: 'cancelled' },
      { attempt: 2, status: 'scheduled' },
    ])
    expect(childRows(itemOf(frame, 'attemptRunning'), childId)).toContainEqual({
      attempt: 2,
      status: 'usage',
    })
  })

  it('holds the paused run inProgress with no paused status', () => {
    const frame = commandOf('workflow-pause-accepted.json')
    expect(frame.method).toBe('workflow/pause')
    const ack = workflowControlResultSchema.parse(frame.ack)
    expect(ack).toEqual({ commandId: frame.commandId, status: 'accepted' })
    for (const key of ['before', 'draining', 'settled'] as const) {
      expect(itemOf(frame, key).status).toBe('inProgress')
    }
    // Every in-flight attempt drains to terminal/cancelled; the scheduled
    // child stays scheduled. The launching turn had already completed, so
    // the pause is the only cause (provenance.json).
    const settled = itemOf(frame, 'settled')
    const children = settled.children ?? []
    for (const raw of children) {
      const row = workflowChildSchema.safeParse(raw).data
      if (row?.label === 'delta') {
        expect(row.status).toBe('scheduled')
      } else {
        expect(raw).toMatchObject({ status: 'terminal', terminal: 'cancelled' })
      }
    }
  })

  it('drives a turn on resume and re-emits the run under it', () => {
    const frame = commandOf('workflow-resume-accepted.json')
    expect(frame.method).toBe('workflow/resume')
    const ack = workflowResumeResultSchema.parse(frame.ack)
    expect(ack.status).toBe('accepted')
    expect(ack.commandId).toBe(frame.commandId)
    expect(itemOf(frame, 'reemitted').turnId).toBe(ack.turnId)
    const reconciled = itemOf(frame, 'reconciled')
    expect(reconciled.status).toBe('completed')
    expect(reconciled.message).toContain('latest_failure')
  })

  it('refuses a scheduled child and a settled run with the documented kinds', () => {
    const scheduled = fixture('workflow-childControl-scheduled-refused.json') as RefusalFrame
    expect(scheduled.error).toMatchObject({
      code: -32_030,
      kind: 'commandRejected',
      data: { kind: 'commandRejected', reason: 'invalid_target' },
    })
    expect(scheduled.error.data['commandId']).toBe(scheduled.commandId)
    const settled = fixture('workflow-cancel-settled-refused.json') as RefusalFrame
    expect(settled.error).toMatchObject({
      code: -32_030,
      kind: 'commandRejected',
      data: { kind: 'commandRejected', reason: 'missing_run' },
    })
    expect(settled.error.data['commandId']).toBe(settled.commandId)
  })
})

describe('the wraps send the recorded commands and say refusals in words', () => {
  it('drives pause, cancel, skip and retry through the recorded acks', async () => {
    const pause = commandOf('workflow-pause-accepted.json')
    const cancel = commandOf('workflow-cancel-accepted.json')
    const skip = commandOf('workflow-childControl-skip.json')
    const retry = commandOf('workflow-childControl-retry.json')
    const sent: { method: string; params: Record<string, unknown> }[] = []
    const live = await startLiveSession((method, params) => {
      sent.push({ method, params })
      if (method === 'workflow/pause') return { result: pause.ack }
      if (method === 'workflow/cancel') return { result: cancel.ack }
      if (method === 'workflow/childControl') {
        return { result: params['action'] === 'skip' ? skip.ack : retry.ack }
      }
      return refuseUnscripted(method)
    })
    const runId = pause.params['workflowRunId'] as string
    await expect(live.session.pauseWorkflowRun(runId)).resolves.toBe('accepted')
    await expect(live.session.cancelWorkflowRun(runId)).resolves.toBe('accepted')
    await expect(
      live.session.controlWorkflowChild({
        workflowRunId: runId,
        childId: skip.params['childId'] as string,
        attempt: skip.params['attempt'] as number,
        action: 'skip',
      }),
    ).resolves.toBe('accepted')
    await expect(
      live.session.controlWorkflowChild({
        workflowRunId: runId,
        childId: retry.params['childId'] as string,
        attempt: retry.params['attempt'] as number,
        action: 'retry',
      }),
    ).resolves.toBe('accepted')
    expect(sent.filter((row) => row.method === 'workflow/pause')).toHaveLength(1)
    expect(sent.filter((row) => row.method === 'workflow/cancel')).toHaveLength(1)
    const controls = sent.filter((row) => row.method === 'workflow/childControl')
    expect(controls).toHaveLength(2)
    expect(controls[0]?.params).toMatchObject({
      workflowRunId: runId,
      childId: skip.params['childId'],
      attempt: 1,
      action: 'skip',
    })
    expect(controls[1]?.params).toMatchObject({ action: 'retry', attempt: 1 })
  })

  it('names the driven turn on resume', async () => {
    const resume = commandOf('workflow-resume-accepted.json')
    const live = await startLiveSession((method) =>
      method === 'workflow/resume' ? { result: resume.ack } : refuseUnscripted(method),
    )
    await expect(
      live.session.resumeWorkflowRun(resume.params['workflowRunId'] as string),
    ).resolves.toEqual({
      status: 'accepted',
      turnId: (resume.ack as { turnId: string }).turnId,
    })
  })

  it('says the recorded refusals in words', async () => {
    const scheduled = fixture('workflow-childControl-scheduled-refused.json') as RefusalFrame
    const settled = fixture('workflow-cancel-settled-refused.json') as RefusalFrame
    const live = await startLiveSession((method) => {
      if (method === 'workflow/childControl') return { error: scheduled.error }
      return method === 'workflow/cancel' ? { error: settled.error } : refuseUnscripted(method)
    })
    await expect(
      live.session.controlWorkflowChild({
        workflowRunId: scheduled.params['workflowRunId'] as string,
        childId: scheduled.params['childId'] as string,
        attempt: scheduled.params['attempt'] as number,
        action: 'skip',
      }),
    ).rejects.toThrow(UI_TEXT.workflowChildNotRunning)
    await expect(
      live.session.cancelWorkflowRun(settled.params['workflowRunId'] as string),
    ).rejects.toThrow(UI_TEXT.workflowRunEnded)
  })
})

describe('the host re-keys the in-flight attempt from the recorded runs', () => {
  it('reads the retry across its attempts and refuses the rest', () => {
    const retry = commandOf('workflow-childControl-retry.json')
    const runId = retry.params['workflowRunId'] as string
    const childId = retry.params['childId'] as string
    const cancelled = itemOf(retry, 'attemptCancelled')
    const rescheduled = itemOf(retry, 'attemptRescheduled')
    const running = itemOf(retry, 'attemptRunning')
    // Attempt 1 alone is terminal: nothing to drive.
    expect(workflowChildAttempt([cancelled], runId, childId)).toBe('idle')
    // Attempt 2 scheduled beside it: still nothing in flight.
    expect(workflowChildAttempt([cancelled, rescheduled], runId, childId)).toBe('idle')
    // Attempt 2 running: the retry's key.
    expect(workflowChildAttempt([cancelled, rescheduled, running], runId, childId)).toBe(2)
    expect(workflowChildAttempt([cancelled, rescheduled, running], runId, 'no-such-child')).toBe(
      'gone',
    )
  })

  it('refuses a scheduled child: the pause fixture holds one', () => {
    const pause = commandOf('workflow-pause-accepted.json')
    const runId = pause.params['workflowRunId'] as string
    const settled = itemOf(pause, 'settled')
    const delta = (settled.children ?? []).find(
      (raw) => (raw as Record<string, unknown>)['label'] === 'delta',
    ) as Record<string, unknown>
    expect(workflowChildAttempt([settled], runId, delta['childId'] as string)).toBe('idle')
  })
})

describe('the card state follows the host’s pause word', () => {
  const start: UiState = { ...initialUiState, sessionId: 'session-1' }
  function host(message: HostToWebviewMessage, state: UiState = start): UiState {
    return uiReducer(state, { type: 'hostMessage', message, at: 1000 })
  }
  function withRun(): UiState {
    const pause = commandOf('workflow-pause-accepted.json')
    return host({
      type: 'agentEvent',
      event: { type: 'itemStarted', item: itemOf(pause, 'before') },
    })
  }

  it('marks every entry of the run paused and unmarks on resume', () => {
    const pause = commandOf('workflow-pause-accepted.json')
    const runId = pause.params['workflowRunId'] as string
    const marked = host({ type: 'workflowPaused', workflowRunId: runId, paused: true }, withRun())
    const entries = marked.transcript.filter(
      (entry) => entry.kind === 'workflow' && entry.workflowRunId === runId,
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry).toMatchObject({ pausedByUser: true })
      expect(transcriptEntrySchema.safeParse(entry).success).toBe(true)
    }
    const resumed = host({ type: 'workflowPaused', workflowRunId: runId, paused: false }, marked)
    for (const entry of resumed.transcript) {
      expect(entry).not.toMatchObject({ pausedByUser: true })
    }
  })

  it('drops the mark once the run settles', () => {
    const frame = commandOf('workflow-cancel-accepted.json')
    const runId = frame.params['workflowRunId'] as string
    const live = host({
      type: 'agentEvent',
      event: { type: 'itemStarted', item: itemOf(frame, 'draining') },
    })
    const marked = host({ type: 'workflowPaused', workflowRunId: runId, paused: true }, live)
    expect(marked.transcript).toContainEqual(expect.objectContaining({ pausedByUser: true }))
    const settled = host(
      {
        type: 'agentEvent',
        event: { type: 'itemCompleted', item: itemOf(frame, 'terminal') },
      },
      marked,
    )
    for (const entry of settled.transcript) {
      expect(entry).not.toMatchObject({ pausedByUser: true })
    }
  })
})

describe('the panel refuses where the backend runs no workflows', () => {
  it('says so on a Model API conversation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-panel-workflow-refusal-'))
    try {
      const rig = modelApiRig(directory)
      const live = await rig.host.startSession({
        workspaceRoot: directory,
        modelId: DEFAULT_MODEL_ID,
        approvalMode: 'promptUnmatched',
      })
      await live.rename('Parser fix')
      await awaitSaved(rig, live.sessionId)
      const sessionId = live.sessionId
      live.dispose()
      const panel = conversationPanel({ rig, directory })
      await panel.controller.handle({ type: 'resumeSession', sessionId, attachmentEpoch: 0 })
      const control: ConversationMessage = {
        type: 'workflowControl',
        workflowRunId: 'run-1',
        control: 'cancel',
      }
      await panel.controller.handle(control)
      await rig.host.flush()
      const notices = panelNotices(panel.posted)
      expect(notices.at(-1)).toEqual({
        level: 'error',
        text: `${UI_TEXT.workflowControlFailed}: ${UI_TEXT.workflowUnsupported}`,
      })
      expect(panel.posted.some((message) => message.type === 'workflowPaused')).toBe(false)
    } finally {
      await removeFolder(directory)
    }
  })
})
