// M88 lane A: the panel's sequence messages against the real controller,
// the real sequence store on disk, and the product's own Model API host
// (helpers/conversationPanel.ts). Every posted message parses, and the
// webview reducer reads the library and the run from them. The runner's
// advance on a completed turn needs a live turn, which the rig runs
// none of; the machine proves every transition (promptSequence.test.ts).
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SequencePort } from '../../src/host/conversation/featurePorts'
import { SequenceRunner } from '../../src/host/prompts/sequenceRunner'
import { SequenceStore } from '../../src/core/prompts/sequenceStore'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { parseHostToWebviewMessage, type HostToWebviewMessage } from '../../src/shared/protocol'
import type { SavedSequence, SequenceRunView } from '../../src/shared/sequences'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import {
  awaitSaved,
  conversationPanel,
  modelApiRig,
  panelNotices,
} from './helpers/conversationPanel'
import { removeFolder } from './helpers/temporaryFolders'

function sequence(overrides: Partial<SavedSequence> = {}): SavedSequence {
  return {
    schemaVersion: 1,
    id: 'seq-1',
    name: 'Morning review',
    steps: ['First', 'Second'],
    scope: 'user',
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    ...overrides,
  }
}

function storePort(store: SequenceStore, hasWorkspace: boolean): SequencePort {
  return {
    hasWorkspace,
    library: () => store.library(),
    save: (input) => store.save(input),
    remove: (scope, id) => store.remove(scope, id),
  }
}

function shownState(posted: readonly HostToWebviewMessage[]) {
  let state = initialUiState
  for (const raw of posted) {
    const parsed = parseHostToWebviewMessage(raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) state = uiReducer(state, { type: 'hostMessage', message: parsed.message, at: 0 })
  }
  return state
}

function runStates(posted: readonly HostToWebviewMessage[]): (SequenceRunView | undefined)[] {
  return posted.flatMap((message) => (message.type === 'sequenceState' ? [message.run] : []))
}

/** The runner's chain drains on microtasks and the refused send; bound the wait. */
async function awaitRunEnd(posted: readonly HostToWebviewMessage[], before: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (runStates(posted.slice(before)).includes(undefined)) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('sequence messages through the panel', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'muse-sequence-panel-'))
  })
  afterEach(async () => {
    await removeFolder(directory)
  })

  it('saves, lists and deletes sequences, and the panel reads the library', async () => {
    const store = new SequenceStore(directory, directory)
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, sequences: storePort(store, true) })

    await panel.controller.handle({ type: 'sequenceSave', sequence: sequence() })
    await panel.controller.handle({
      type: 'sequenceSave',
      sequence: sequence({ id: 'seq-2', name: 'Workspace sweep', scope: 'workspace' }),
    })
    let state = shownState(panel.posted)
    expect(state.sequences?.map((row) => row.name)).toEqual(['Morning review', 'Workspace sweep'])
    expect(state.sequenceHasWorkspace).toBe(true)

    await panel.controller.handle({ type: 'sequenceDelete', scope: 'user', id: 'seq-1' })
    state = shownState(panel.posted)
    expect(state.sequences?.map((row) => row.name)).toEqual(['Workspace sweep'])
    expect(panelNotices(panel.posted)).toEqual([])
  })

  it('says the workspace scope is missing without a folder', async () => {
    const store = new SequenceStore(directory)
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, sequences: storePort(store, false) })
    await panel.controller.handle({ type: 'requestSequences' })
    const state = shownState(panel.posted)
    expect(state.sequences).toEqual([])
    expect(state.sequenceHasWorkspace).toBe(false)
  })

  it('refuses a blank name in words and saves nothing', async () => {
    const store = new SequenceStore(directory, directory)
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, sequences: storePort(store, true) })
    await panel.controller.handle({
      type: 'sequenceSave',
      sequence: sequence({ id: 'blank', name: '  ' }),
    })
    expect(panelNotices(panel.posted)).toEqual([
      { level: 'warning', text: UI_TEXT.promptTitleRequired },
    ])
    expect(await store.library()).toEqual([])
  })

  it('refuses with an explicit error while the port is missing', async () => {
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory })
    await panel.controller.handle({ type: 'requestSequences' })
    await panel.controller.handle({ type: 'sequenceSave', sequence: sequence() })
    await panel.controller.handle({ type: 'sequenceDelete', scope: 'user', id: 'seq-1' })
    expect(panelNotices(panel.posted)).toEqual([
      { level: 'error', text: UI_TEXT.sequencesUnavailable },
      { level: 'error', text: UI_TEXT.sequencesUnavailable },
      { level: 'error', text: UI_TEXT.sequencesUnavailable },
    ])
  })

  it('refuses a run with no conversation, and a run of a removed sequence', async () => {
    const store = new SequenceStore(directory, directory)
    await store.save(sequence())
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, sequences: storePort(store, true) })
    await panel.controller.handle({ type: 'sequenceStart', scope: 'user', id: 'seq-1' })
    expect(panelNotices(panel.posted)).toEqual([
      { level: 'warning', text: UI_TEXT.sequenceNoSession },
    ])

    const live = await rig.host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    await live.rename('Parser fix')
    await awaitSaved(rig, live.sessionId)
    live.dispose()
    await panel.controller.handle({
      type: 'resumeSession',
      sessionId: live.sessionId,
      attachmentEpoch: 0,
    })
    await panel.controller.handle({ type: 'sequenceStart', scope: 'user', id: 'gone' })
    expect(panelNotices(panel.posted)).toContainEqual({
      level: 'warning',
      text: UI_TEXT.sequencesUnavailable,
    })
    expect(shownState(panel.posted).sequences?.map((row) => row.id)).toEqual(['seq-1'])
  })

  it('attempts the first step on start and ends silent when the send refuses', async () => {
    const store = new SequenceStore(directory, directory)
    await store.save(sequence())
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory, sequences: storePort(store, true) })
    const live = await rig.host.startSession({
      workspaceRoot: directory,
      modelId: DEFAULT_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    await live.rename('Parser fix')
    await awaitSaved(rig, live.sessionId)
    live.dispose()
    await panel.controller.handle({
      type: 'resumeSession',
      sessionId: live.sessionId,
      attachmentEpoch: 0,
    })
    const before = panel.posted.length
    await panel.controller.handle({ type: 'sequenceStart', scope: 'user', id: 'seq-1' })
    // The run, the step's own card, the send's refusal, the cleared run.
    await awaitRunEnd(panel.posted, before)
    const posted = panel.posted.slice(before)
    const states = runStates(posted)
    expect(states).toEqual([
      { sequenceId: 'seq-1', scope: 'user', name: 'Morning review', step: 1, total: 2 },
      undefined,
    ])
    expect(posted.some((message) => message.type === 'briefSubmitted')).toBe(true)
    // The send's own refusal spoke; the run ends without a second notice.
    expect(panelNotices(posted).every((notice) => !notice.text.includes('Sequence'))).toBe(true)
    expect(shownState(panel.posted).sequenceRun).toBeUndefined()
  })

  it('refuses a second run while one is going, and stops silent with none', async () => {
    const rig = modelApiRig(directory)
    const panel = conversationPanel({ rig, directory })
    const runs: (SequenceRunView | undefined)[] = []
    const notices: string[] = []
    const logged: string[] = []
    const runner = new SequenceRunner({
      deferred: panel.controller,
      postState: (run) => {
        runs.push(run)
      },
      notice: (_level, text) => {
        notices.push(text)
      },
      log: (failure) => {
        logged.push(failure)
      },
    })
    runner.start(sequence(), 's1')
    expect(() => {
      runner.start(sequence(), 's1')
    }).toThrow(UI_TEXT.sequenceAlreadyRunning)
    expect(runs).toEqual([
      { sequenceId: 'seq-1', scope: 'user', name: 'Morning review', step: 1, total: 2 },
    ])
    // No session is attached, so the first send refuses before a card and
    // the run ends silent on microtasks; drain them before disposing.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runs).toEqual([
      { sequenceId: 'seq-1', scope: 'user', name: 'Morning review', step: 1, total: 2 },
      undefined,
    ])
    runner.dispose()
    // With no run, a stop and a stray end say nothing.
    runner.stop()
    runner.onTurnSettled({ turnId: 'turn-1', terminal: 'completed' })
    expect(notices).toEqual([])
    expect(logged).toEqual([])
  })
})
