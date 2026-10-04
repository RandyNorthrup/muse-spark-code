// The Auto reviewer on Muse Code's own bundle (M90, PLAN.md D6, D69):
// src/host/review/museCodeReviewerEntry.ts built as scripts/build.mjs builds
// it, then required through the window's port with Node's own `require`, as
// the first review requires dist/museCodeReviewer.js. Nothing loads before
// then; a bundle that cannot load leaves the review to the user in their
// words, and the next review tries again.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { requireFile } from '../../src/host/lazyBundle'
import {
  isMuseCodeReviewerBundle,
  museCodeReviewerPort,
} from '../../src/host/review/museCodeReviewerBundle'
import { MUSE_CODE_REVIEWER_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { FakeAgentSession } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost } from './helpers/fakeMsp'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import {
  CAPTURED_REPLY,
  reviewReplyFrames,
  reviewTurnCompleted,
  reviewTurnStarted,
  sideSessionStarted,
} from './helpers/reviewerCapture'
import { removeFolder } from './helpers/temporaryFolders'

const built = builtForTests(
  'src/host/review/museCodeReviewerEntry.ts',
  MUSE_CODE_REVIEWER_BUNDLE_FILE,
)
const folder = mkdtempSync(path.join(tmpdir(), 'muse-reviewer-bundle-'))
const root = path.join(folder, 'museCodeReviewer')

afterAll(() => removeFolder(folder))

describe('isMuseCodeReviewerBundle', () => {
  it('accepts a module that exports the factory, and nothing else', () => {
    expect(isMuseCodeReviewerBundle({ createMuseCodeReviewer: vi.fn() })).toBe(true)
    expect(isMuseCodeReviewerBundle({ createMuseCodeReviewer: 1 })).toBe(false)
    expect(isMuseCodeReviewerBundle({})).toBe(false)
    expect(isMuseCodeReviewerBundle(null)).toBe(false)
  })
})

describe('museCodeReviewerPort', () => {
  lazyLoaderCases(
    (deps) => {
      const port = museCodeReviewerPort({ ...deps, root, isOn: () => true })
      return () => port.reviewer()
    },
    built,
    () => UI_TEXT.autoReviewerFailed,
  )

  it('loads nothing until the first review, then reviews with the shipped bundle', async () => {
    const load = vi.fn(requireFile)
    const log = new FakeLogOutputChannel()
    const port = museCodeReviewerPort({
      bundlePath: built.file,
      root,
      isOn: () => true,
      log,
      loadBundle: load,
    })
    expect(load).not.toHaveBeenCalled()
    expect(port.isSideSession('side-1')).toBe(false)
    const handle = fakeMspHost()
    handle.server.handle('session/start', (params) =>
      sideSessionStarted('side-1', params['workspaceRoot'], params['modelId']),
    )
    handle.server.handle('session/setReasoningEffort', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    handle.server.handle('turn/start', (params) => reviewTurnStarted(params['commandId'], 'rt-1'))
    handle.server.handle('task/stopAll', (params) => ({
      commandId: params['commandId'],
      status: 'accepted',
    }))
    const host = new MuseCodeHost(handle.host, log)
    const conversation = new FakeAgentSession('s1', 'muse-spark-1.3-contributor')
    const showCard = vi.fn()
    port
      .reviewer()
      .conversation({
        showCard,
        notice: vi.fn(),
        mayAllow: () => true,
        log,
        describeFailure: failureForLog,
      })
      .hold(
        {
          type: 'approvalRequested',
          approvalId: 'a1',
          itemId: 'i1',
          toolName: 'powershell',
          rawArgs: '{"command":"Get-Content notes.md | Measure-Object -Line"}',
          requirementId: { approvalId: 'a1', sourceIndex: 0 },
          subject: { kind: 'shell', command: 'Get-Content notes.md | Measure-Object -Line' },
          availableChoices: [
            { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
            { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
          ],
          isJudgeEscalated: false,
          isProtectedWrite: false,
          turnId: 't1',
        },
        {
          session: conversation,
          host: () => Promise.resolve(host),
          modelId: 'muse-spark-1.3-contributor',
          request: {
            userRequest: 'Count the lines in notes.md',
            recentCalls: [],
            tool: 'powershell',
            action: 'Get-Content notes.md | Measure-Object -Line',
            workspaceRoot: '/ws',
            platform: 'win32',
          },
        },
      )
    expect(load).toHaveBeenCalledExactlyOnceWith(built.file)
    await vi.waitFor(() => {
      expect(handle.server.requestsFor('turn/start')).toHaveLength(1)
    })
    // The side session's id is the port's to hide from History.
    expect(port.isSideSession('side-1')).toBe(true)
    for (const frame of reviewReplyFrames('side-1', 'rt-1', CAPTURED_REPLY)) {
      handle.server.notify(frame.method, frame.params)
    }
    handle.server.notify('turn/completed', reviewTurnCompleted('side-1', 'rt-1'))
    await vi.waitFor(() => {
      expect(conversation.decideApproval).toHaveBeenCalledExactlyOnceWith({
        approvalId: 'a1',
        choiceId: 'allow_once',
        requirementId: { approvalId: 'a1', sourceIndex: 0 },
      })
    })
    expect(showCard).not.toHaveBeenCalled()
    port.dispose()
    await vi.waitFor(() => {
      expect(handle.server.requestsFor('task/stopAll')).toHaveLength(1)
    })
  })
})
