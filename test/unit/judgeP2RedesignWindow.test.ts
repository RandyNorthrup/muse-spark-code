// The production-built window never replaces the working phase-1 same-model
// judge with a side-less phase-2 runtime (RVM98P2BF finding 2). Built
// through `createWindowJudge`'s own production path (separate id, evidence
// root and the real `dist/judgeP2.js` sibling), with a fake Muse Code side
// session. No live, paid or local-model call.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createWindowJudge } from '../../src/host/judge/judgeEntry'
import type { JudgeWindowDeps } from '../../src/host/judge/judgeBundle'
import { JUDGE_EVIDENCE_DIRNAME } from '../../src/shared/constants'
import type { JudgeStatus } from '../../src/shared/judge'
import { EN } from '../../src/shared/l10n/en'
import { FakeAgentSession } from './helpers/fakeAgent'
import { bindingWindowBase } from './helpers/judgeBinding'
import { builtJudgeFactories } from './helpers/judgeFactoryBundles'
import { JUDGE_ACTION } from './helpers/judgeUseRig'

const built = builtJudgeFactories()
const storage = mkdtempSync(path.join(tmpdir(), 'muse-p2r-window-'))
afterAll(() => {
  rmSync(storage, { recursive: true, force: true })
})

function productionWindow(separateId: string) {
  const sessions: FakeAgentSession[] = []
  const statuses: JudgeStatus[] = []
  const opened = (session: FakeAgentSession) => {
    sessions.push(session)
    return session
  }
  const deps: JudgeWindowDeps = {
    ...bindingWindowBase(),
    engine: () => 'auto',
    context: () => ({
      backend: 'museCode',
      modelId: 'muse-spark-1.3',
      ownerId: 'window',
      contextLimit: 100_000,
      confidential: false,
    }),
    // The three plain production inputs extension.ts passes.
    separateId: () => separateId,
    evidenceRoot: path.join(storage, JUDGE_EVIDENCE_DIRNAME),
    judgeP2BundlePath: path.join(built.folder, 'judgeP2.js'),
    // No M95 record is stored for any provider in this window.
    readStoredCredential: () => Promise.resolve(undefined),
    startSession: vi.fn<JudgeWindowDeps['startSession']>((options) =>
      Promise.resolve(
        opened(new FakeAgentSession(`side-${String(sessions.length)}`, options.modelId)),
      ),
    ),
    status: (_action, status) => {
      statuses.push(status)
    },
  }
  return { judge: createWindowJudge(deps, EN, 'en'), sessions, statuses }
}

describe('the production window keeps phase-1 when no phase-2 side can be built', () => {
  it.each([
    ['', undefined],
    ['fixture-source', 'unknown'],
    ['openrouter-jev:typesafe/jev-1.13', 'key'],
    ['acme-provider:some-model', 'capture'],
    ['local:tev1:4b', 'install'],
  ])(
    'separate id %j: the same-model judge sends once and its caution reaches the fence',
    async (separateId, gap) => {
      const rig = productionWindow(separateId)
      const fence = rig.judge.start({ ...JUDGE_ACTION, backend: 'museCode' }, 'state')
      await vi.waitFor(
        () => {
          expect(rig.sessions[0]?.sendTurn).toHaveBeenCalledTimes(1)
        },
        { timeout: 4000 },
      )
      const session = rig.sessions[0]
      if (session === undefined) throw new Error('side session absent')
      session.emit(
        {
          type: 'itemCompleted',
          item: {
            itemId: 'reply',
            turnId: 'turn-1',
            kind: 'agentMessage',
            status: 'completed',
            text: JSON.stringify({ answer: 'yes', confidence: 99 }),
          },
        },
        { type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' },
      )
      await vi.waitFor(() => {
        expect(session.dispose).toHaveBeenCalled()
      })
      expect(fence?.read()).toBe('caution')
      expect(rig.sessions).toHaveLength(1)
      expect(rig.statuses.at(-1)).toMatchObject({ mode: 'same', reason: 'auto-same' })
      // A configured id with no buildable side names its exact gap; a key
      // found missing after the first action refreshes the status itself.
      await vi.waitFor(() => {
        expect(rig.statuses.at(-1)?.separateGap).toBe(gap)
      })
      if (separateId !== '' && gap !== 'key')
        expect(rig.statuses.at(-1)).toMatchObject({ autoSameReason: 'source-unavailable' })
      rig.judge.dispose()
    },
  )
})
