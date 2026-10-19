// A prompt/agent hook's model turn on Muse Code
// (src/host/review/museCodeHookModels.ts): a turn nobody waits on ends
// silently; a turn the queue drops after the window closed, a turn whose
// ask fails and a side turn that will not stop are recorded by kind only,
// never with the failure's own words.
import { describe, expect, it } from 'vitest'
import type { AgentHost, AgentSession } from '../../src/core/agent/agentBackend'
import { failureForLog } from '../../src/core/backends/musecode/logText'
import type { CoreLogger } from '../../src/core/logging'
import {
  MuseCodeHookModels,
  type MuseCodeHookModelJob,
} from '../../src/host/review/museCodeHookModels'
import { recordLog } from './helpers/recordLog'
import { usingTempDir } from './helpers/temporaryFolders'

function noUnsubscribe(): void {
  return undefined
}

const neverSend: AgentSession['sendTurn'] = () => new Promise<never>(() => undefined)

/** A side session whose turn send fails, or never answers, and whose stop fails. */
function sideSession(send: AgentSession['sendTurn']) {
  let disposed = 0
  const session = {
    sessionId: 'side-session',
    dispose: () => {
      disposed += 1
    },
    cancel: () => Promise.reject(new Error('stop refused at /secret/side')),
    onEvent: () => noUnsubscribe,
    sendTurn: send,
    setReasoningEffort: () => Promise.resolve(),
  } as unknown as AgentSession
  return { session, disposed: () => disposed }
}

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

describe('MuseCodeHookModels', () => {
  it('ends a turn nobody waits on silently', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings, infos } = recordLog()
      let started = 0
      // The refused start never reaches the CLI: the turn is already unwanted.
      const host = {
        startSession: () => {
          started += 1
          return Promise.reject(new Error('must not start'))
        },
      } as unknown as AgentHost
      const aborted = new AbortController()
      const models = turnModels(root, log)
      aborted.abort()
      try {
        const answer = await models.runHookModelTurn(job(host, aborted.signal))
        expect(answer).toBe(undefined)
      } finally {
        models.dispose()
      }
      expect(started).toBe(0)
      expect(warnings).toEqual([])
      expect(infos).toEqual([])
    })
  })

  it('fails a turn whose ask fails, recorded by kind only', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings } = recordLog()
      const startFailure = new Error('side session refused at /secret/path')
      const host = {
        startSession: () => Promise.reject(startFailure),
      } as unknown as AgentHost
      await runTurn(root, log, host)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('Error')
      expect(warnings[0]).not.toContain('/secret/path')
    })
  })

  it('lets a started turn go when its send fails, stopping it loudly', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings } = recordLog()
      const sendFailure = new Error('turn was not taken at /secret/path')
      const { session, disposed } = sideSession(() => Promise.reject(sendFailure))
      const host = {
        startSession: () => Promise.resolve(session),
      } as unknown as AgentHost
      await runTurn(root, log, host)
      expect(disposed()).toBeGreaterThan(0)
      expect(warnings).toHaveLength(2)
      for (const warning of warnings) {
        expect(warning).toContain('Error')
        expect(warning).not.toContain('/secret/path')
      }
    })
  })

  it('drops a queued turn nobody waits on silently', async () => {
    await usingTempDir('hook-models-', async (root) => {
      const { log, warnings, infos } = recordLog()
      const { session } = sideSession(neverSend)
      const host = {
        startSession: () => Promise.resolve(session),
      } as unknown as AgentHost
      const models = turnModels(root, log)
      try {
        const first = models.runHookModelTurn(job(host, new AbortController().signal, 400))
        const stop = new AbortController()
        const second = models.runHookModelTurn(job(host, stop.signal))
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
