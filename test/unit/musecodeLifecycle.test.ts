// RLF-ACPHONEST B5 (RLF-HARVEST H10): the session lifecycle reader. The
// real MuseCodeHost runs over the replay wire with the native reader
// bound; every frame is recorded live with zero model calls
// (test/fixtures/m127/note-session-started-1.4.9.json,
// test/fixtures/acphonest/note-session-started-1.4.11.json). A started
// notice reaches the session-list listeners as the record it carries,
// without a re-list; the delete terminal has no served capture and refuses
// by name; deleteSession refuses without sending while the admission
// parser is absent.
import { readFileSync } from 'node:fs'
import { Connection } from '@muse-code/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionListEvent } from '../../src/core/agent/agentBackend'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import {
  isDeleteCapableReader,
  LifecycleDeleteUnreadableError,
  NATIVE_LIFECYCLE_READER,
  parseLifecycleNotification,
} from '../../src/core/backends/musecode/lifecycle'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import { type Answer, refuseUnscripted, ReplayWire } from './helpers/museReplay'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'

function acpFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/acphonest/${name}`, import.meta.url), 'utf8'))
}

function m127Fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/m127/${name}`, import.meta.url), 'utf8'))
}

function noteParams(fixture: unknown): Record<string, unknown> {
  return (fixture as Record<string, unknown>[])[0]!
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

/** The real host over the replay wire, with the native reader bound. */
function lifecycleHost(): { host: MuseCodeHost; wire: ReplayWire } {
  const wire = new ReplayWire()
  wire.answer = (method): Answer => {
    switch (method) {
      case 'model/list': {
        return { result: acpFixture('model-list-1.4.11.json') }
      }
      case 'session/start': {
        return { result: acpFixture('session-start-1.4.11.json') }
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
      initializeResult: acpFixture('initialize-1.4.11.json'),
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    log,
    undefined,
    { lifecycle: NATIVE_LIFECYCLE_READER },
  )
  hosts.push({ host, wire })
  return { host, wire }
}

/** A released broadcast is answered in order, so a backend round trip after it proves it was handled. */
async function flushBackend(host: MuseCodeHost): Promise<void> {
  await host.listModels()
}

describe('MuseCode lifecycle reader', () => {
  it('reads the 1.4.9 started notice as the session it carries', () => {
    const event = parseLifecycleNotification({
      method: 'session/started',
      params: noteParams(m127Fixture('note-session-started-1.4.9.json')),
    })
    expect(event.type).toBe('started')
    if (event.type !== 'started') return
    expect(event.record.sessionId).toBe('01a14b18-a6b1-70b1-98d7-305e708aac00')
    expect(event.record.workspaceRoot).toBe('/home/randy/lanes/MUSEUPDATE')
    expect(event.record.status).toBe('idle')
  })

  it('reads the 1.4.11 started notice as the session it carries', () => {
    const event = parseLifecycleNotification({
      method: 'session/started',
      params: noteParams(acpFixture('note-session-started-1.4.11.json')),
    })
    expect(event.type).toBe('started')
    if (event.type !== 'started') return
    expect(event.record.sessionId).toBe('01a18e6a-7b16-7910-81f2-0158d565c3ae')
    expect(event.record.workspaceRoot).toBe('<capture-workspace>')
    expect(event.record.status).toBe('idle')
  })

  it('refuses a malformed started notice instead of inventing the record', () => {
    expect(() =>
      parseLifecycleNotification({ method: 'session/started', params: { session: null } }),
    ).toThrow()
  })

  it('refuses the delete terminal by name: no served capture exists', () => {
    expect(() =>
      parseLifecycleNotification({ method: 'session/deleteCompleted', params: {} }),
    ).toThrow(LifecycleDeleteUnreadableError)
  })

  it('omits the delete admission parser while no receipt is captured', () => {
    expect(NATIVE_LIFECYCLE_READER.parseDeleteAdmission).toBeUndefined()
    expect(isDeleteCapableReader(NATIVE_LIFECYCLE_READER)).toBe(false)
    expect(isDeleteCapableReader(undefined)).toBe(false)
  })

  it('delivers a started session to the list without a re-list', async () => {
    const { host, wire } = lifecycleHost()
    const seen: SessionListEvent[] = []
    host.onSessionListEvent((event) => {
      seen.push(event)
    })
    wire.release({
      jsonrpc: '2.0',
      method: 'session/started',
      params: noteParams(acpFixture('note-session-started-1.4.11.json')),
    })
    await flushBackend(host)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.type).toBe('changed')
    if (seen[0]?.type !== 'changed') return
    expect(seen[0].record.sessionId).toBe('01a18e6a-7b16-7910-81f2-0158d565c3ae')
    // No re-list, and the notice is shown now, not "not shown".
    expect(wire.sentCount('session/list')).toBe(0)
    expect(logged.filter((entry) => entry.message.includes('session/started'))).toEqual([])
    wire.finish()
    await host.close()
    hosts.pop()
  })

  it('reports an unreadable delete terminal by name and delivers nothing', async () => {
    const { host, wire } = lifecycleHost()
    const seen: SessionListEvent[] = []
    host.onSessionListEvent((event) => {
      seen.push(event)
    })
    wire.release({ jsonrpc: '2.0', method: 'session/deleteCompleted', params: {} })
    await flushBackend(host)
    expect(seen).toEqual([])
    const errors = logged.filter((entry) => entry.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('LifecycleDeleteUnreadableError')
    await host.close()
    hosts.pop()
  })

  it('refuses deleteSession without sending while the admission parser is absent', async () => {
    const { host, wire } = lifecycleHost()
    const initialize = acpFixture('initialize-1.4.11.json') as {
      serverInfo: { version: string }
    }
    await expect(host.deleteSession('01a18e6a-7b16-7910-81f2-0158d565c3ae')).rejects.toThrow(
      fill(EN.sessionDeleteUnsupported, { version: initialize.serverInfo.version }),
    )
    expect(wire.sentCount('session/delete')).toBe(0)
    await host.close()
    hosts.pop()
  })
})
