// M91 lane H: a prompt/agent hook's turn on Muse Code (PLAN.md D70). One
// turn of a hidden side session on the subscription, like M90's reviewer,
// with a notice saying so. One reused session per window, Plan mode,
// thinking off; any tool use ends the run and discards the session.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import {
  MuseCodeHookModels,
  type MuseCodeHookModelDeps,
  type MuseCodeHookModelJob,
} from '../../src/host/review/museCodeHookModels'
import { FakeAgentHost } from './helpers/fakeAgent'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

function setup() {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-hook-model-'))
  const host = new FakeAgentHost()
  const notified: string[] = []
  const deps: MuseCodeHookModelDeps = {
    root: path.join(folder, 'side'),
    log: new FakeLogOutputChannel(),
    onSideSession: () => undefined,
    describeFailure: () => 'failed',
    notify: (text) => {
      notified.push(text)
    },
  }
  const runner = new MuseCodeHookModels(deps)
  return { folder, host, notified, runner }
}

function job(
  host: FakeAgentHost,
  overrides: Partial<MuseCodeHookModelJob> = {},
): MuseCodeHookModelJob {
  return {
    host,
    modelId: 'muse-spark-1.3',
    kind: 'prompt',
    system: 'You are a hook.',
    user: 'Is this safe?\n\n{}',
    timeoutMs: 5000,
    signal: new AbortController().signal,
    ...overrides,
  }
}

function reply(turnId: string, text: string): AgentEvent {
  return {
    type: 'itemCompleted',
    item: { itemId: 'reply', kind: 'agentMessage', status: 'completed', turnId, text },
  }
}

function ended(turnId: string): AgentEvent {
  return { type: 'turnCompleted', turnId, terminal: 'completed' }
}

describe('MuseCodeHookModels (M91 D70)', () => {
  it('runs one turn of a hidden side session and returns its reply', async () => {
    const t = setup()
    try {
      const started = t.host.startSession
      const run = t.runner.runHookModelTurn(job(t.host))
      await vi.waitFor(() => {
        expect(t.host.sessions).toHaveLength(1)
      })
      const session = t.host.sessions[0]!
      await vi.waitFor(() => {
        expect(session.sendTurn).toHaveBeenCalledTimes(1)
      })
      const turnId = 'turn-1'
      session.emit(reply(turnId, '{"decision":"block","reason":"no"}'), ended(turnId))
      expect(await run).toBe('{"decision":"block","reason":"no"}')
      expect(started).toHaveBeenCalledWith({
        workspaceRoot: expect.stringContaining('side'),
        modelId: 'muse-spark-1.3',
        approvalMode: 'denyUnmatched',
      })
      expect(session.sendTurn).toHaveBeenCalledWith([
        { type: 'text', text: 'You are a hook.\n\nIs this safe?\n\n{}' },
      ])
      expect(session.setReasoningEffort).toHaveBeenCalledWith('none')
      expect(session.dispose).not.toHaveBeenCalled()
      expect(t.notified).toEqual([UI_TEXT.hookModelMuseCodeNotice])

      // A second run reuses the window's session and notices only once.
      const again = t.runner.runHookModelTurn(job(t.host, { kind: 'agent' }))
      await vi.waitFor(() => {
        expect(session.sendTurn).toHaveBeenCalledTimes(2)
      })
      session.emit(reply('turn-2', '{}'), ended('turn-2'))
      expect(await again).toBe('{}')
      expect(t.host.sessions).toHaveLength(1)
      expect(t.notified).toHaveLength(1)
    } finally {
      t.runner.dispose()
      await removeFolder(t.folder)
    }
  })

  it('fails the hook when the turn uses a tool, ends first, or runs out of time', async () => {
    const t = setup()
    try {
      const toolRun = t.runner.runHookModelTurn(job(t.host))
      await vi.waitFor(() => {
        expect(t.host.sessions).toHaveLength(1)
      })
      const used = t.host.sessions[0]!
      await vi.waitFor(() => {
        expect(used.sendTurn).toHaveBeenCalledTimes(1)
      })
      used.emit(
        {
          type: 'itemStarted',
          item: { itemId: 'tool', kind: 'toolCall', status: 'inProgress', turnId: 'turn-1' },
        },
        reply('turn-1', '{}'),
        ended('turn-1'),
      )
      expect(await toolRun).toBeUndefined()
      await vi.waitFor(() => {
        expect(used.dispose).toHaveBeenCalled()
      })
      expect(used.cancel).toHaveBeenCalled()

      const slow = t.runner.runHookModelTurn(job(t.host, { timeoutMs: 30 }))
      await vi.waitFor(() => {
        expect(t.host.sessions).toHaveLength(2)
      })
      expect(await slow).toBeUndefined()
    } finally {
      t.runner.dispose()
      await removeFolder(t.folder)
    }
  })

  it('runs nothing when already aborted', async () => {
    const t = setup()
    try {
      const controller = new AbortController()
      controller.abort()
      expect(
        await t.runner.runHookModelTurn(job(t.host, { signal: controller.signal })),
      ).toBeUndefined()
      expect(t.host.sessions).toHaveLength(0)
      expect(t.notified).toHaveLength(0)
    } finally {
      t.runner.dispose()
      await removeFolder(t.folder)
    }
  })
})
