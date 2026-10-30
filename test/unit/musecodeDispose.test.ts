// RLF-ACPHONEST B3 (RLF-HARVEST H7): shutdown honesty. Releasing the last
// hold on a session settles its background-task stop before the handle is
// forgotten; a release on a dead or closing host says so once at info and
// sends nothing; a failed stop names the failure's kind; closing the host
// says the abandonment once. The real MuseCodeHost runs over the replay
// wire; every frame is the recorded 1.4.11 echo capture
// (test/fixtures/acphonest/), zero model calls.
import { readFileSync } from 'node:fs'
import { Connection } from '@muse-code/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { type Answer, refuseUnscripted, ReplayWire } from './helpers/museReplay'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/acphonest/${name}`, import.meta.url), 'utf8'))
}

const logged: LoggedMessage[] = []
const log = levelLogger(logged)
const hosts: { host: MuseCodeHost; wire: ReplayWire }[] = []
afterEach(async () => {
  for (const { host, wire } of hosts.splice(0)) {
    wire.finish()
    await host.close()
  }
  logged.length = 0
})

interface Rigged {
  host: MuseCodeHost
  wire: ReplayWire
  connection: Connection
  stopAllGate: PromiseWithResolvers<Answer>
}

/** The real host over the replay wire; the stop's answer is held by the test. */
function replayHost(): Rigged {
  const wire = new ReplayWire()
  const stopAllGate = Promise.withResolvers<Answer>()
  wire.answer = (method): Answer | Promise<Answer> => {
    switch (method) {
      case 'model/list': {
        return { result: fixture('model-list-1.4.11.json') }
      }
      case 'session/start': {
        return { result: fixture('session-start-1.4.11.json') }
      }
      case 'session/resume': {
        return { result: fixture('session-resume-1.4.11.json') }
      }
      case 'task/stopAll': {
        return stopAllGate.promise
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult: fixture('initialize-1.4.11.json'),
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    log,
  )
  const live = { host, wire, connection, stopAllGate }
  hosts.push({ host, wire })
  return live
}

const START = {
  workspaceRoot: '<capture-workspace>',
  modelId: 'muse-spark-1.3',
  approvalMode: 'promptUnmatched',
} as const

function stopWarns(): LoggedMessage[] {
  return logged.filter((entry) => entry.message.includes('task/stopAll before releasing'))
}

function abandonInfos(): LoggedMessage[] {
  return logged.filter((entry) => entry.message.includes('without stopping'))
}

/** The SDK submits writes on microtasks; one macrotask drains them all. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('MuseCode session release is orderly', () => {
  it('settles the stop before the handle is forgotten', async () => {
    const { host, wire, stopAllGate } = replayHost()
    const session = await host.startSession({ ...START })
    session.dispose()
    session.dispose()
    await tick()
    // One stop for any number of releases; a surface adopted in the window
    // gets a fresh handle, never the dying one.
    expect(wire.sentCount('task/stopAll')).toBe(1)
    const resumed = await host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.session).not.toBe(session)
    stopAllGate.resolve({ result: fixture('task-stopAll-1.4.11.json') })
    await host.listModels()
    // Settled: the map holds the new handle, the old one is gone exactly once.
    const again = await host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(again.session).toBe(resumed.session)
    expect(stopWarns()).toEqual([])
    wire.finish()
    await host.close()
    hosts.pop()
  })

  it('a failed stop names its kind and still forgets the handle', async () => {
    const { host, wire, stopAllGate } = replayHost()
    const session = await host.startSession({ ...START })
    session.dispose()
    await tick()
    expect(wire.sentCount('task/stopAll')).toBe(1)
    const refused = fixture('task-stopAll-unknown-session-1.4.11.json') as {
      refused: { code: number; message: string; data: Record<string, unknown> }
    }
    stopAllGate.resolve({ error: refused.refused })
    await host.listModels()
    const warns = stopWarns()
    expect(warns).toHaveLength(1)
    expect(warns[0]?.message).toContain('sessionNotFound')
    expect(warns[0]?.message).toContain('-32020')
    const resumed = await host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(resumed.session).not.toBe(session)
    wire.finish()
    await host.close()
    hosts.pop()
  })

  it('a release on a dead host says so once and sends nothing', async () => {
    const { host, wire } = replayHost()
    const session = await host.startSession({ ...START })
    wire.finish()
    // The connection's EOF aborts the channel first and warns after, in one
    // sync block: the warn proves the release will see the abort.
    for (let attempt = 0; ; attempt += 1) {
      if (
        logged.some((entry) =>
          entry.message.includes('The MSP connection closed while muse serve was running'),
        )
      )
        break
      if (attempt === 199) throw new Error('the channel never aborted')
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    session.dispose()
    expect(wire.sentCount('task/stopAll')).toBe(0)
    expect(stopWarns()).toEqual([])
    expect(
      abandonInfos().filter(
        (entry) =>
          entry.level === 'info' && entry.message.includes('released with its closing host'),
      ),
    ).toHaveLength(1)
    // Already untracked: the close says nothing about held sessions.
    await host.close()
    expect(abandonInfos()).toHaveLength(1)
    hosts.pop()
  })

  it('closing the host says the abandonment once and sends no stop', async () => {
    const { host, wire } = replayHost()
    await host.startSession({ ...START })
    await host.close()
    expect(wire.sentCount('task/stopAll')).toBe(0)
    expect(stopWarns()).toEqual([])
    expect(abandonInfos()).toHaveLength(1)
    hosts.pop()
  })

  it('a close during the settling stop stays quiet', async () => {
    const { host, wire } = replayHost()
    const session = await host.startSession({ ...START })
    session.dispose()
    await tick()
    expect(wire.sentCount('task/stopAll')).toBe(1)
    await host.close()
    expect(stopWarns()).toEqual([])
    expect(abandonInfos()).toHaveLength(1)
    hosts.pop()
  })

  it('a second surface still shares the live handle', async () => {
    const { host, wire } = replayHost()
    const session = await host.startSession({ ...START })
    const second = await host.resumeSession(session.sessionId, 'muse-spark-1.3')
    expect(second.session).toBe(session)
    session.dispose()
    await tick()
    expect(wire.sentCount('task/stopAll')).toBe(0)
    second.session.dispose()
    await tick()
    expect(wire.sentCount('task/stopAll')).toBe(1)
    wire.finish()
    await host.close()
    hosts.pop()
  })
})
