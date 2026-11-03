// M88 lane C (PLAN.md D67, item 16): the host behind the failed row's
// offers. Driven through the same `handle` entry the webview uses,
// against the real controller, the product's own Model API host and the
// real file session store (helpers/conversationPanel.ts). The budget
// failure is one the code path really produces: a positive spend cap
// below any request's estimate, refused before the HTTP try — the rig's
// dummy key never leaves, no call is made.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import {
  continueTurnRefusal,
  type ConversationDeps,
} from '../../src/host/conversation/conversationController'
import { CONVERSATION_MODEL_TEXT } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { scheduleRunContextSchema } from '../../src/shared/scheduleV2'
import { Usd } from '../../src/shared/usd'
import {
  awaitPosts,
  conversationPanel,
  endedTurn,
  modelApiRig,
  panelNotices,
  savedSession,
  shownTranscript,
  turnCompletions,
  type PanelRig,
  type TurnCompleted,
} from './helpers/conversationPanel'
import { testScheduleBridge } from './helpers/schedules/scheduleTestRig'
import { removeFolder } from './helpers/temporaryFolders'

const TYPED = 'Count the migrations'

// A spend cap below any request's estimate: every send fails naming the
// budget before the HTTP try. The dummy key resolves so the turn reaches
// the budget check; nothing is sent.
function budgetRig(directory: string) {
  return modelApiRig(directory, undefined, undefined, {
    apiKey: () => Promise.resolve('test-key'),
    sessionBudgetUsd: () => Usd.from('0.000001').toAmount(),
  })
}

// The credential store failing mid-request: the backend judges the failed
// turn retryable (and it names no budget).
function failingKeyRig(directory: string) {
  return modelApiRig(directory, undefined, undefined, {
    apiKey: () => Promise.reject(new Error('the panel rig withholds the key')),
  })
}

async function panelWithSession(
  rig: ReturnType<typeof modelApiRig>,
  directory: string,
  options?: {
    schedulesBridge?: ConversationDeps['schedulesBridge']
    runHostAction?: ConversationDeps['runHostAction']
    onSessionAttached?: ConversationDeps['onSessionAttached']
  },
) {
  const live = await savedSession(rig, directory, 'Continue me')
  live.dispose()
  const panel = conversationPanel({
    rig,
    directory,
    isNamespaceKnown: true,
    ...(options?.schedulesBridge !== undefined && { schedulesBridge: options.schedulesBridge }),
    ...(options?.runHostAction !== undefined && { runHostAction: options.runHostAction }),
    ...(options?.onSessionAttached !== undefined && {
      onSessionAttached: options.onSessionAttached,
    }),
  })
  await panel.controller.handle({
    type: 'resumeSession',
    sessionId: live.sessionId,
    attachmentEpoch: 0,
  })
  return panel
}

// The opening send, awaited to its failed end.
async function failedOpeningTurn(panel: PanelRig): Promise<TurnCompleted> {
  await panel.controller.handle({
    type: 'sendMessage',
    localId: 'local-1',
    text: TYPED,
    attachmentIds: [],
  })
  const first = await endedTurn(panel, 1, 0)
  expect(first.terminal).toBe('failed')
  return first
}

describe('resume host flow', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-turn-resume-'))
  })
  afterEach(async () => {
    await removeFolder(directory)
  })

  it('continues a budget-failed turn as a new turn, offering the budget', async () => {
    const panel = await panelWithSession(budgetRig(directory), directory)
    const first = await failedOpeningTurn(panel)
    expect(first.errorKind).toBe('budget')
    expect(first.retryable).toBe(false)

    await panel.controller.handle({
      type: 'continueTurn',
      localId: 'local-2',
      turnId: first.turnId,
    })
    const second = await endedTurn(panel, 2, 1)
    expect(second.terminal).toBe('failed')
    expect(second.errorKind).toBe('budget')
    expect(second.turnId).not.toBe(first.turnId)

    // Both failures offer the budget setting, never a timer: the row's
    // offer comes from the real reducer over the posted messages.
    const transcript = shownTranscript(panel, [
      { localId: 'local-1', text: TYPED },
      { localId: 'local-2', text: TYPED },
    ])
    const errors = transcript.filter((entry) => entry.kind === 'error')
    expect(errors).toHaveLength(2)
    for (const error of errors) {
      expect(error.resume?.kind).toBe('budget')
      expect(error.resume?.defaultAtMs).toBeUndefined()
      expect(error.retryTurnId).toBeUndefined()
    }
  })

  it('says when a turn that named no budget cannot continue', async () => {
    const panel = await panelWithSession(failingKeyRig(directory), directory)
    const first = await failedOpeningTurn(panel)
    expect(first.retryable).toBe(true)

    await panel.controller.handle({
      type: 'continueTurn',
      localId: 'local-2',
      turnId: first.turnId,
    })
    const refused = panel.posted.find(
      (message): message is Extract<HostToWebviewMessage, { type: 'sendFailed' }> =>
        message.type === 'sendFailed' && message.localId === 'local-2',
    )
    expect(refused?.reason).toBe(UI_TEXT.turnContinueUnavailable)
    expect(await awaitPosts(panel, turnCompletions, 1, 'no second turn')).toHaveLength(1)
  })

  it('opens Resume later with the fixed prompt seeded at the offer minute', async () => {
    const panel = await panelWithSession(failingKeyRig(directory), directory, {
      schedulesBridge: testScheduleBridge(directory),
    })
    const first = await failedOpeningTurn(panel)

    const defaultAtMs = Math.ceil((Date.now() + 10 * 60 * 1000) / 60_000) * 60_000
    await panel.controller.handle({ type: 'resumeLater', turnId: first.turnId, defaultAtMs })
    const surface = panel.posted.find(
      (message): message is Extract<HostToWebviewMessage, { type: 'schedulesSurface' }> =>
        message.type === 'schedulesSurface',
    )
    if (surface === undefined) throw new Error('no schedule surface was posted')
    expect(surface.initialView).toBe('editor')
    expect(surface.defaultDraft.action).toEqual({
      kind: 'prompt',
      prompt: CONVERSATION_MODEL_TEXT.resumePrompt,
    })
    expect(surface.defaultDraft.trigger).toEqual({ kind: 'once', atMs: defaultAtMs })
    expect(CONVERSATION_MODEL_TEXT.resumePrompt).toBe('Continue where you left off.')
  })

  it('says when the resume turn is gone instead of seeding', async () => {
    const panel = await panelWithSession(failingKeyRig(directory), directory, {
      schedulesBridge: testScheduleBridge(directory),
    })
    await panel.controller.handle({ type: 'resumeLater', turnId: 'no-such-turn', defaultAtMs: 1 })
    expect(panelNotices(panel.posted).map((notice) => notice.text)).toContain(
      UI_TEXT.turnResumeUnavailable,
    )
    expect(panel.posted.some((message) => message.type === 'schedulesSurface')).toBe(false)
  })

  it('seeds the composer text only for the Schedule This Prompt entry', async () => {
    const panel = await panelWithSession(failingKeyRig(directory), directory, {
      schedulesBridge: testScheduleBridge(directory),
    })
    await panel.controller.handle({ type: 'openSchedules', view: 'editor', seed: 'composer' })
    await panel.controller.handle({ type: 'openSchedules', view: 'list' })
    const surfaces = panel.posted.filter(
      (message): message is Extract<HostToWebviewMessage, { type: 'schedulesSurface' }> =>
        message.type === 'schedulesSurface',
    )
    expect(surfaces).toHaveLength(2)
    expect(surfaces[0]?.seedFromComposer).toBe(true)
    expect(surfaces[1]?.seedFromComposer).toBeUndefined()
  })

  it('marks a scheduled fire’s user card as sent on schedule', async () => {
    let live: AgentSession | undefined
    const panel = await panelWithSession(failingKeyRig(directory), directory, {
      onSessionAttached: (session) => {
        live = session
        return Promise.resolve()
      },
    })
    if (live === undefined) throw new TypeError('no session attached')
    // A real run context, parsed by the contract: only its run id names
    // the card, but an invalid shape fails here instead of standing in.
    const context = scheduleRunContextSchema.parse({
      unattended: true,
      scheduleId: 'sched-1',
      runId: 'run-1',
      grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
      creator: { kind: 'user' },
      mode: 'manual',
      depth: 0,
      allowAgentReschedule: false,
    })
    panel.controller.scheduledSubmission(live, context, 'Water the plants', {
      turnId: 't9',
      disposition: 'queued',
    })
    const brief = panel.posted.find(
      (message): message is Extract<HostToWebviewMessage, { type: 'briefSubmitted' }> =>
        message.type === 'briefSubmitted',
    )
    expect(brief?.scheduled).toBe(true)
    const card = shownTranscript(panel, []).find((entry) => entry.kind === 'user')
    if (card?.kind !== 'user') throw new TypeError('no user card in the transcript')
    expect(card.scheduled).toBe(true)
  })

  it('deep-links the budget setting through the host action query', async () => {
    const calls: { action: string; query?: string | undefined }[] = []
    const panel = await panelWithSession(failingKeyRig(directory), directory, {
      runHostAction: (action, query) => {
        calls.push({ action, query })
        return Promise.resolve()
      },
    })
    await panel.controller.handle({
      type: 'hostAction',
      action: 'openSettings',
      query: '@id:museSpark.modelApiSessionBudgetUsd',
    })
    expect(calls).toEqual([
      { action: 'openSettings', query: '@id:museSpark.modelApiSessionBudgetUsd' },
    ])
  })
})

describe('continueTurnRefusal', () => {
  it('admits only the budget-failed turn of the live session at rest', () => {
    const live = {
      sessionId: 's1',
      rememberedSessionId: 's1',
      failedBudget: true,
      turnRunning: false,
    }
    expect(continueTurnRefusal(live)).toBeUndefined()
    expect(continueTurnRefusal({ ...live, turnRunning: true })).toBe('busy')
    expect(continueTurnRefusal({ ...live, failedBudget: false })).toBe('unavailable')
    expect(continueTurnRefusal({ ...live, failedBudget: undefined })).toBe('unavailable')
    expect(continueTurnRefusal({ ...live, rememberedSessionId: 's2' })).toBe('unavailable')
    expect(continueTurnRefusal({ ...live, sessionId: undefined })).toBe('unavailable')
  })
})
