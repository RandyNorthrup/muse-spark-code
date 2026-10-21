// A prompt/agent hook's model turn on Muse Code
// (src/host/review/museCodeHookModels.ts): a turn nobody waits on ends
// silently; a turn the queue drops after the window closed, a turn whose
// ask fails and a side turn that will not stop are recorded by kind only,
// never with the failure's own words. The host and session are the
// product's own MuseCodeHost/MuseSession over the SDK's real Connection,
// fed by the recorded 1.4.7 capture (see helpers/museReplay.ts): refused
// methods fail through the real host code, and the wire itself proves a
// turn that must not start never sends its start.
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentHost } from '../../src/core/agent/agentBackend'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import type { CoreLogger } from '../../src/core/logging'
import {
  MuseCodeHookModels,
  type MuseCodeHookModelJob,
} from '../../src/host/review/museCodeHookModels'
import { recordLog } from './helpers/recordLog'
import { usingTempDir } from './helpers/temporaryFolders'
import {
  closeLiveHosts,
  refuseUnscripted,
  startLiveHost,
  startResult,
  type Answer,
} from './helpers/museReplay'

afterEach(async () => {
  await closeLiveHosts()
})

/** Fresh models for one root; the caller disposes them. */
function turnModels(root: string, log: CoreLogger): MuseCodeHookModels {
  return new MuseCodeHookModels({
    root,
    log,
    onSideSession: () => undefined,
    describeFailure: failureForLog,
    notify: () => undefined,
  })
}

/** One turn through fresh models, disposed after. */
async function runTurn(root: string, log: CoreLogger, host: AgentHost): Promise<void> {
  const models = turnModels(root, log)
  try {
    const answer = await models.runHookModelTurn(job(host, new AbortController().signal))
    expect(answer).toBe(undefined)
  } finally {
    models.dispose()
  }
}

function job(host: AgentHost, signal: AbortSignal, timeoutMs = 5000): MuseCodeHookModelJob {
  return {
    host,
    modelId: 'model',
    kind: 'prompt',
    system: 'system',
    user: 'user',
    timeoutMs,
    signal,
  }
}

function unexpected(method: string): Answer {
  throw new Error(`unexpected ${method}`)
}

describe('MuseCodeHookModels', () => {
  it('ends a turn nobody waits on silently', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings, infos } = recordLog()
      // The refused start never reaches the CLI: the turn is already unwanted.
      const { host, wire } = startLiveHost(unexpected)
      const aborted = new AbortController()
      const models = turnModels(root, log)
      aborted.abort()
      try {
        const answer = await models.runHookModelTurn(job(host, aborted.signal))
        expect(answer).toBe(undefined)
      } finally {
        models.dispose()
      }
      expect(wire.sentCount('session/start')).toBe(0)
      expect(warnings).toEqual([])
      expect(infos).toEqual([])
    })
  })

  it('fails a turn whose ask fails, recorded by kind only', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings } = recordLog()
      // The side session is refused through the real host.
      const { host } = startLiveHost((method) => {
        if (method === 'session/start') return refuseUnscripted(method)
        throw new Error(`unexpected ${method}`)
      })
      await runTurn(root, log, host)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('harnessGap')
      expect(warnings[0]).not.toContain('/secret/path')
    })
  })

  it('lets a started turn go when its send fails, stopping it loudly', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings } = recordLog()
      // The side session starts, its turn is refused, and stopping that
      // turn is refused too: every refusal travels the real host code.
      const live = startLiveHost((method) => {
        if (method === 'session/start') return { result: startResult }
        if (method === 'session/setReasoningEffort') return { result: {} }
        if (method === 'turn/start') return refuseUnscripted(method)
        if (method === 'turn/cancel') return refuseUnscripted(method)
        if (method === 'task/stopAll') return { result: {} }
        throw new Error(`unexpected ${method}`)
      })
      await runTurn(root, log, live.host)
      for (let waited = 0; waited < 100 && live.host.sessionCount > 0; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(live.host.sessionCount).toBe(0)
      expect(warnings).toHaveLength(2)
      for (const warning of warnings) {
        expect(warning).toContain('harnessGap')
        expect(warning).not.toContain('/secret/path')
      }
    })
  })

  it('drops a queued turn nobody waits on silently', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings, infos } = recordLog()
      // The first turn's send never answers, like a hung CLI; the queue
      // drops the second turn once its run stops waiting.
      const live = startLiveHost((method) => {
        if (method === 'session/start') return { result: startResult }
        if (method === 'session/setReasoningEffort') return { result: {} }
        if (method === 'turn/start') return new Promise<Answer>(() => undefined)
        if (method === 'turn/cancel') return { result: {} }
        if (method === 'task/stopAll') return { result: {} }
        throw new Error(`unexpected ${method}`)
      })
      const models = turnModels(root, log)
      try {
        const first = models.runHookModelTurn(job(live.host, new AbortController().signal, 400))
        const stop = new AbortController()
        const second = models.runHookModelTurn(job(live.host, stop.signal))
        stop.abort()
        expect(await second).toBe(undefined)
        expect(await first).toBe(undefined)
      } finally {
        models.dispose()
      }
      for (const line of [...warnings, ...infos]) {
        expect(line).not.toContain('in its queue')
      }
    })
  })
})
