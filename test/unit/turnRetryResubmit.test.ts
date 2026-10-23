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
import { describeExit } from '../../src/core/backends/musecode/MuseCodeHost'
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

// The credential store never answering: the turn stays running, so the
// test kills its host mid-turn deterministically. No key material, no
// call: the request waits where the key is read.
function hangingKeyRig(directory: string) {
  return modelApiRig(directory, {
    apiKey: () =>
      new Promise<string>(() => {
        // The key never comes: the turn stays running until its host dies.
      }),
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

async function pressRetry(panel: PanelRig, localId: string, turnId: string): Promise<void> {
  await panel.controller.handle({ type: 'retryTurn', localId, turnId })
}

// A first send that fails retryably on its withheld key.
async function failedFirstTurn(
  directory: string,
): Promise<{ panel: PanelRig; first: TurnCompleted }> {
  const panel = await panelWithSession(failingKeyRig(directory), directory)
  await sendFirst(panel)
  const [first] = await awaitTurnEnd(panel, 1)
  expect(first?.terminal).toBe('failed')
  expect(first?.retryable).toBe(true)
  if (first === undefined) throw new Error('the first turn never ended')
  return { panel, first }
}

// The turn a resubmit starts, waited for where the key stays withheld so
// it fails again instead of hanging the file.
async function retriedTurn(panel: PanelRig, turnId: string): Promise<TurnCompleted> {
  await pressRetry(panel, 'local-2', turnId)
  const [, second] = await awaitTurnEnd(panel, 2)
  if (second === undefined) throw new Error('the retried turn never ended')
  return second
}

function retryRefusals(panel: PanelRig): string[] {
  return panel.posted
    .filter(
      (message): message is Extract<HostToWebviewMessage, { type: 'sendFailed' }> =>
        message.type === 'sendFailed' &&
        (message.localId === 'local-2' || message.localId === 'local-3'),
    )
    .map((refusal) => refusal.reason)
}

function turnCompletions(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) =>
    message.type === 'agentEvent' && message.event.type === 'turnCompleted' ? [message.event] : [],
  )
}

function turnAcceptances(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) => (message.type === 'turnAccepted' ? [message] : []))
}

function sessionInfos(posted: readonly HostToWebviewMessage[]) {
  return posted.flatMap((message) => (message.type === 'sessionInfo' ? [message] : []))
}

async function awaitPosts<T>(
  panel: PanelRig,
  collect: (posted: readonly HostToWebviewMessage[]) => readonly T[],
  count: number,
  what: string,
): Promise<readonly T[]> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const found = collect(panel.posted)
    if (found.length >= count) {
      return found
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(
    `only ${String(collect(panel.posted).length)} ${what}, wanted ${String(count)}; posted: ${JSON.stringify(panel.posted).slice(0, 2000)}`,
  )
}

type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>

async function awaitTurnEnd(panel: PanelRig, count: number): Promise<readonly TurnCompleted[]> {
  return await awaitPosts(panel, turnCompletions, count, 'turns ended')
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
    const { panel, first } = await failedFirstTurn(directory)
    const second = await retriedTurn(panel, first.turnId)
    expect(second.terminal).toBe('failed')
    expect(second.retryable).toBe(true)
    expect(second.turnId).not.toBe(first.turnId)

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

  it('resubmits a turn that died with its host, on the resumed session', async () => {
    const panel = await panelWithSession(hangingKeyRig(directory), directory)
    await sendFirst(panel)
    // The exit is the product's own reading of a signal death, not a
    // hand-built value: `describeExit` maps it, `hostExited` ends the turn.
    panel.controller.hostExited(describeExit({ code: null, signal: 'SIGKILL' }, false))
    const [first] = await awaitTurnEnd(panel, 1)
    expect(first?.terminal).toBe('failed')
    expect(first?.retryable).toBe(true)
    if (first === undefined) throw new Error('the first turn never ended')

    const sessionsBefore = sessionInfos(panel.posted).length
    await pressRetry(panel, 'local-2', first.turnId)
    const accepted = await awaitPosts(
      panel,
      (posted) => turnAcceptances(posted).filter((message) => message.localId === 'local-2'),
      1,
      'retry turns accepted',
    )
    expect(accepted[0]?.turnId).not.toBe(first.turnId)
    // The resubmit re-established the dropped session, like any send.
    expect(sessionInfos(panel.posted).length).toBeGreaterThan(sessionsBefore)

    // The dead turn's error row offers Retry; both user cards stay.
    const transcript = shownTranscript(panel, [
      { localId: 'local-1', text: TYPED },
      { localId: 'local-2', text: TYPED },
    ])
    const error = transcript.find((entry) => entry.id === `error:${first.turnId}`)
    expect(error?.kind).toBe('error')
    expect(error?.kind === 'error' && error.retryTurnId).toBe(first.turnId)
  })

  it('keeps an older retryable turn resubmittable across an idle host death', async () => {
    const { panel, first } = await failedFirstTurn(directory)
    // The host dies with no turn running: nothing new fails, and the old
    // failure's Retry survives the drop because the conversation resumes.
    panel.controller.hostExited(describeExit({ code: null, signal: 'SIGKILL' }, false))
    expect(turnCompletions(panel.posted)).toHaveLength(1)
    const second = await retriedTurn(panel, first.turnId)
    expect(second.terminal).toBe('failed')
    expect(second.turnId).not.toBe(first.turnId)
  })

  it('offers no Retry when the host refuses to run, and restarts nothing for an unknown turn', async () => {
    const panel = await panelWithSession(hangingKeyRig(directory), directory)
    await sendFirst(panel)
    // Exit code 2 is one of the product's own persistent codes: the host
    // refuses to run as configured, so no resubmit could help.
    panel.controller.hostExited(describeExit({ code: 2, signal: null }, false))
    const [first] = await awaitTurnEnd(panel, 1)
    expect(first?.terminal).toBe('failed')
    expect(first?.retryable).toBeUndefined()
    if (first === undefined) throw new Error('the first turn never ended')

    const sessionsBefore = sessionInfos(panel.posted).length
    await pressRetry(panel, 'local-2', first.turnId)
    await pressRetry(panel, 'local-3', 'turn-gone')
    expect(retryRefusals(panel)).toEqual([
      UI_TEXT.turnRetryUnavailable,
      UI_TEXT.turnRetryUnavailable,
    ])
    // Neither press re-established the dropped session, and the refusal
    // to run reached the sign-in gate instead.
    expect(sessionInfos(panel.posted)).toHaveLength(sessionsBefore)
    expect(panel.backendErrors).toHaveLength(1)
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
    if (first === undefined) throw new Error('the first turn never ended')

    await pressRetry(panel, 'local-2', first.turnId)
    await pressRetry(panel, 'local-3', 'turn-gone')
    expect(retryRefusals(panel)).toEqual([
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
