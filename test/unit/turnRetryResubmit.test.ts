// RLF-ACPTURNS: Retry resubmits a failed turn the backend judged
// retryable, and says every refusal. Driven through the same `handle`
// entry the webview uses, against the real controller, the product's own
// Model API host and the real file session store
// (helpers/conversationPanel.ts). The retryable failure is one the code
// path really produces: the credential store failing mid-request, which
// the next attempt re-reads. What the panel does with the posted messages
// is the real webview reducer's.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { retryTurnRefusal } from '../../src/host/conversation/conversationController'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import {
  conversationPanel,
  modelApiRig,
  savedSession,
  type PanelRig,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

const TYPED = 'Shard the cache by tenant'

// The credential store failing mid-request: the next attempt re-reads it,
// so the backend judges the failed turn retryable. No key material, no
// call: the request fails where the key is read.
function failingKeyRig(directory: string) {
  return modelApiRig(directory, {
    apiKey: () => Promise.reject(new Error('the panel rig withholds the key')),
  })
}

async function panelWithSession(rig: ReturnType<typeof modelApiRig>, directory: string) {
  const live = await savedSession(rig, directory, 'Retry me')
  live.dispose()
  const panel = conversationPanel({ rig, directory, isNamespaceKnown: true })
  await panel.controller.handle({
    type: 'resumeSession',
    sessionId: live.sessionId,
    attachmentEpoch: 0,
  })
  return panel
}

async function sendFirst(panel: PanelRig): Promise<void> {
  await panel.controller.handle({
    type: 'sendMessage',
    localId: 'local-1',
    text: TYPED,
    attachmentIds: [],
  })
}

function turnCompletions(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnCompleted' ? [message.event] : [],
  )
}

async function awaitTurnEnd(panel: PanelRig, count: number): Promise<AgentEvent[]> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const completions = turnCompletions(panel.posted)
    if (completions.length >= count) {
      return completions
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `only ${String(turnCompletions(panel.posted).length)} turns ended, wanted ${String(count)}; posted: ${JSON.stringify(panel.posted).slice(0, 2000)}`,
  )
}

function shownTranscript(panel: PanelRig, sends: readonly { localId: string; text: string }[]) {
  let state = initialUiState
  for (const send of sends) {
    state = uiReducer(state, {
      type: 'submitted',
      localId: send.localId,
      text: send.text,
      attachments: [],
      contextLabel: undefined,
    })
  }
  for (const message of panel.posted) {
    state = uiReducer(state, { type: 'hostMessage', message, at: 0 })
  }
  return state.transcript
}

describe('turn retry resubmission', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-turn-retry-'))
  })
  afterEach(async () => {
    await removeFolder(directory)
  })

  it('resubmits a retryable failed turn as a new turn and keeps its work', async () => {
    const panel = await panelWithSession(failingKeyRig(directory), directory)
    await sendFirst(panel)
    const [first] = await awaitTurnEnd(panel, 1)
    expect(first?.terminal).toBe('failed')
    expect(first?.retryable).toBe(true)

    await panel.controller.handle({ type: 'retryTurn', localId: 'local-2', turnId: first.turnId })
    const [, second] = await awaitTurnEnd(panel, 2)
    expect(second?.terminal).toBe('failed')
    expect(second?.retryable).toBe(true)
    expect(second?.turnId).not.toBe(first.turnId)

    // Both user cards and both failures stay on screen: the retry takes
    // nothing back, and the resent card carries the same message.
    const transcript = shownTranscript(panel, [
      { localId: 'local-1', text: TYPED },
      { localId: 'local-2', text: TYPED },
    ])
    const userTexts: string[] = []
    for (const entry of transcript) {
      if (entry.kind === 'user') {
        userTexts.push(entry.text)
      }
    }
    expect(userTexts).toEqual([TYPED, TYPED])
    expect(transcript.filter((entry) => entry.kind === 'error')).toHaveLength(2)
    const retried = transcript.find((entry) => entry.id === 'local-2')
    expect(retried?.kind === 'user' && retried.status).toBe('sent')
  })

  it('refuses a turn that failed beyond retrying, and an unknown turn', async () => {
    const panel = await panelWithSession(modelApiRig(directory), directory)
    await sendFirst(panel)
    const [first] = await awaitTurnEnd(panel, 1)
    // No key is stored, so the turn fails on its missing sign-in: a
    // resubmit cannot clear that.
    expect(first?.terminal).toBe('failed')
    expect(first?.errorKind).toBe('authRequired')
    expect(first?.retryable).toBe(false)

    await panel.controller.handle({ type: 'retryTurn', localId: 'local-2', turnId: first.turnId })
    await panel.controller.handle({ type: 'retryTurn', localId: 'local-3', turnId: 'turn-gone' })
    const refusals = panel.posted.filter(
      (message): message is Extract<HostToWebviewMessage, { type: 'sendFailed' }> =>
        message.type === 'sendFailed' &&
        (message.localId === 'local-2' || message.localId === 'local-3'),
    )
    expect(refusals.map((refusal) => refusal.reason)).toEqual([
      UI_TEXT.turnRetryUnavailable,
      UI_TEXT.turnRetryUnavailable,
    ])
  })
})

describe('retryTurnRefusal', () => {
  const admitted = {
    sessionId: 's1',
    rememberedSessionId: 's1',
    failedRetryable: true as const,
    turnRunning: false,
  }

  it('admits a retryable failure in this conversation with no turn running', () => {
    expect(retryTurnRefusal(admitted)).toBeUndefined()
  })

  it('says unavailable without a session, a memory, or a retryable failure', () => {
    expect(retryTurnRefusal({ ...admitted, sessionId: undefined })).toBe('unavailable')
    expect(retryTurnRefusal({ ...admitted, rememberedSessionId: undefined })).toBe('unavailable')
    expect(retryTurnRefusal({ ...admitted, rememberedSessionId: 's2' })).toBe('unavailable')
    expect(retryTurnRefusal({ ...admitted, failedRetryable: false })).toBe('unavailable')
    expect(retryTurnRefusal({ ...admitted, failedRetryable: undefined })).toBe('unavailable')
  })

  it('says busy while a turn runs', () => {
    expect(retryTurnRefusal({ ...admitted, turnRunning: true })).toBe('busy')
  })
})
