// A conversation that could not be opened never takes a message silently
// (0.19.0 release blocker, docs/real-life/release-0.19.0-final-L.md
// "Findings and observations" 1, release-0.19.0-restart.md). Opening a
// conversation from History (or a window's restore) can fail; the failure
// is said in the panel at once, with its cause, and a message typed there
// afterwards is refused at once with the same words. Nothing typed there
// goes to a new conversation the panel does not show, and the message's
// card keeps the typed text.
//
// Driven through the same `handle` entry the webview uses, against the real
// controller, the product's own Model API host and the real file session
// store (helpers/conversationPanel.ts). Each failure is one the code path
// really produces: a conversation the host does not hold, and a model the
// host can no longer resolve, refused inside the opening after the panel
// let go of what it showed. What the panel does with the posted messages is
// the real webview reducer's.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import {
  awaitSaved,
  conversationPanel,
  loadedModelApiRig,
  panelNotices,
  type ModelApiRig,
  type PanelRig,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

// A provider model the person once picked whose provider is no longer set
// up on this computer: the host refuses to switch a conversation onto it.
const REMOVED_PROVIDER_MODEL = 'openai/gpt-oss-20b'
const TYPED = 'Carry on with the parser fix from where we stopped'

/** The real host's own refusal, read from the host itself, never written here. */
async function hostRefusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error('the host accepted what the test needs it to refuse')
}

async function savedConversation(rig: ModelApiRig, directory: string): Promise<string> {
  const live = await rig.host.startSession({
    workspaceRoot: directory,
    modelId: DEFAULT_MODEL_ID,
    approvalMode: 'promptUnmatched',
  })
  await live.rename('Parser fix')
  await awaitSaved(rig, live.sessionId)
  live.dispose()
  return live.sessionId
}

async function storedIds(rig: ModelApiRig): Promise<string[]> {
  const headers = await rig.store.list()
  return headers
    .map((header) => header.sessionId)
    .toSorted((left, right) => left.localeCompare(right))
}

/** Send with `TYPED` in the composer: the message the webview posts to the host. */
async function sendTyped(panel: PanelRig, localId: string): Promise<void> {
  await panel.controller.handle({ type: 'sendMessage', localId, text: TYPED, attachmentIds: [] })
}

/** The panel as the person sees it after the posted messages, with the typed card first. */
function shownCard(posted: readonly HostToWebviewMessage[], localId: string) {
  let state = uiReducer(initialUiState, {
    type: 'submitted',
    localId,
    text: TYPED,
    attachments: [],
    contextLabel: undefined,
  })
  for (const message of posted) {
    state = uiReducer(state, { type: 'hostMessage', message, at: 0 })
  }
  return state.transcript.find((entry) => entry.id === localId)
}

function sendFailures(posted: readonly HostToWebviewMessage[]) {
  return posted.filter((message) => message.type === 'sendFailed')
}

/** Each notice with the way on it offers (D26). */
function noticeWays(posted: readonly HostToWebviewMessage[]) {
  return posted
    .filter((message) => message.type === 'notice')
    .map((message) => ({
      level: message.level,
      text: message.text,
      actions: message.actions ?? [],
    }))
}

/**
The failed opening is said at once with a new conversation as its way on;
a message typed next is refused at once with the same words, no new
conversation takes it, and its card keeps the typed text.
*/
async function expectSaidAndRefused(
  panel: PanelRig,
  rig: ModelApiRig,
  said: string,
  localId: string,
): Promise<void> {
  expect(noticeWays(panel.posted)).toEqual([
    { level: 'error', text: said, actions: ['newConversation'] },
  ])
  const before = await storedIds(rig)
  await sendTyped(panel, localId)
  expect(sendFailures(panel.posted)).toEqual([
    { type: 'sendFailed', localId, reason: said, attachmentsKept: true },
  ])
  await rig.host.flush()
  expect(await storedIds(rig)).toEqual(before)
  expect(shownCard(panel.posted, localId)).toMatchObject({
    kind: 'user',
    text: TYPED,
    status: 'failed',
    reason: said,
  })
}

describe('a conversation that could not be opened refuses messages with its cause', () => {
  it('History open of a conversation the host does not hold: said at once, the send refused', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-resume-unknown-'))
    try {
      const rig = await loadedModelApiRig(directory)
      const panel = conversationPanel({ rig, directory })
      const missing = 'test-session-never-saved'
      const cause = await hostRefusal(() => rig.host.resumeSession(missing, DEFAULT_MODEL_ID))
      const said = `${UI_TEXT.resumeFailed}: ${cause}`

      await panel.controller.handle({
        type: 'resumeSession',
        sessionId: missing,
        attachmentEpoch: 0,
      })

      // Said at once, in the panel, with its cause: not only on the next
      // open. Nothing is open here now, so it offers a new conversation.
      await expectSaidAndRefused(panel, rig, said, 'local-unknown-1')

      // Every later message gets the same answer: nothing of ours retries.
      const before = await storedIds(rig)
      await sendTyped(panel, 'local-unknown-2')
      expect(sendFailures(panel.posted).map((message) => message.reason)).toEqual([said, said])
      expect(await storedIds(rig)).toEqual(before)
    } finally {
      await removeFolder(directory)
    }
  })

  it('a refusal inside the opening, after the panel let go: said at once, the send refused', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-resume-refused-'))
    try {
      // The conversation was saved in an earlier window; this window's host
      // revives it from the same folder.
      const sessionId = await savedConversation(await loadedModelApiRig(directory), directory)
      const rig = await loadedModelApiRig(directory)
      const panel = conversationPanel({ rig, directory, modelId: REMOVED_PROVIDER_MODEL })
      const cause = await hostRefusal(async () => {
        const window = await loadedModelApiRig(directory)
        const probe = await window.host.resumeSession(sessionId, DEFAULT_MODEL_ID)
        try {
          await probe.session.setModel(REMOVED_PROVIDER_MODEL)
        } finally {
          probe.session.dispose()
        }
      })
      const said = `${UI_TEXT.resumeFailed}: ${cause}`

      await panel.controller.handle({ type: 'resumeSession', sessionId, attachmentEpoch: 0 })

      // The opening had already let go of what the panel showed when the
      // host refused the model: the failure is still said at once.
      await expectSaidAndRefused(panel, rig, said, 'local-refused-1')
    } finally {
      await removeFolder(directory)
    }
  })

  it('New Conversation lifts the refusal: the next message starts a conversation', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-resume-cleared-'))
    try {
      const rig = await loadedModelApiRig(directory)
      const panel = conversationPanel({ rig, directory })
      await panel.controller.handle({
        type: 'resumeSession',
        sessionId: 'test-session-never-saved',
        attachmentEpoch: 0,
      })
      const said = panelNotices(panel.posted).at(-1)?.text
      expect(said?.startsWith(`${UI_TEXT.resumeFailed}: `)).toBe(true)

      await panel.controller.handle({ type: 'clearConversation' })
      const cleared = panel.posted.length
      await sendTyped(panel, 'local-cleared-1')
      await rig.host.flush()

      // The panel shows a new conversation now: the message started one
      // (whatever its turn then meets, the key it lacks stops any request
      // before it leaves), and nothing refused it with the old failure.
      const after = panel.posted.slice(cleared)
      expect(
        after.some((message) => message.type === 'sessionInfo' && message.sessionId !== undefined),
      ).toBe(true)
      expect(sendFailures(after).map((message) => message.reason)).not.toContain(said)
    } finally {
      await removeFolder(directory)
    }
  })

  it('an open that works lifts the refusal; one that fails then leaves that conversation open', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-resume-live-'))
    try {
      const sessionId = await savedConversation(await loadedModelApiRig(directory), directory)
      const rig = await loadedModelApiRig(directory)
      const panel = conversationPanel({ rig, directory })
      const missing = 'test-session-never-saved'
      const said = `${UI_TEXT.resumeFailed}: ${await hostRefusal(() =>
        rig.host.resumeSession(missing, DEFAULT_MODEL_ID),
      )}`
      await panel.controller.handle({
        type: 'resumeSession',
        sessionId: missing,
        attachmentEpoch: 0,
      })
      await sendTyped(panel, 'local-live-1')
      expect(sendFailures(panel.posted).map((message) => message.reason)).toEqual([said])

      // Opening the saved conversation works: it is this panel's now.
      await panel.controller.handle({ type: 'resumeSession', sessionId, attachmentEpoch: 0 })
      expect(panel.controller.shareSessionId()).toBe(sessionId)

      // Another open fails while it is live: said, with no way on to offer,
      // and the live conversation stays the one a message goes to.
      const opened = panel.posted.length
      await panel.controller.handle({
        type: 'resumeSession',
        sessionId: missing,
        attachmentEpoch: 0,
      })
      expect(noticeWays(panel.posted.slice(opened))).toEqual([
        { level: 'error', text: said, actions: [] },
      ])
      expect(panel.controller.shareSessionId()).toBe(sessionId)
      const failedOpen = panel.posted.length
      await sendTyped(panel, 'local-live-2')
      expect(
        sendFailures(panel.posted.slice(failedOpen)).map((message) => message.reason),
      ).not.toContain(said)
    } finally {
      await removeFolder(directory)
    }
  })
})
