import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { createFileScheduleStore } from '../../src/host/backend/fileScheduleStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'

const hosts: ModelApiHost[] = []
const roots: string[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function harness() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  const shell = vi.spyOn(io, 'runShell')
  const root = mkdtempSync(path.join(tmpdir(), 'envfence-origin-'))
  roots.push(root)
  let now = 1_000_000
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: '/ws',
      io,
      log,
    }),
    now: () => now,
    store: memorySessionStore(),
    scheduleStore: createFileScheduleStore({ directory: root, now: () => now, log }),
    isPaidFeatureOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    verify: {
      isDiagnosticsOn: () => false,
      isFormatOnEdit: () => false,
      checkCommands: () => [{ name: 'probe', command: 'echo verify' }],
      formatAfterEdit: () => Promise.resolve(undefined),
      diagnosticsAfterEdit: () => Promise.resolve([]),
    },
  })
  hosts.push(host)
  return {
    api,
    io,
    shell,
    host,
    advance: () => {
      now += 60_001
    },
  }
}

const SHELL = {
  name: 'bash',
  arguments: JSON.stringify({ command: 'echo probe', description: 'probe' }),
  callId: 'shell',
}

describe('D89.5 command origins cannot widen unattended environments', () => {
  it('marks top-level model shells and the user’s ! command interactive', async () => {
    const t = harness()
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.api.script({ calls: [SHELL] }, { text: 'done' })
    const done = turnDone()
    await session.sendTurn([{ type: 'text', text: 'run' }])
    await done
    expect(t.shell.mock.calls[0]?.[6]).toBe(true)
    await session.runUserShell('echo user')
    expect(t.shell.mock.calls[1]?.[6]).toBe(true)
  })

  it('keeps then_run and verification unattended', async () => {
    const t = harness()
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.api.script(
      {
        calls: [
          {
            name: 'write_file',
            arguments: JSON.stringify({
              path: 'new.txt',
              content: 'hello',
              then_run: 'echo check',
            }),
            callId: 'edit',
          },
        ],
      },
      { text: 'done' },
    )
    const done = turnDone()
    await session.sendTurn([{ type: 'text', text: 'edit' }])
    await done
    expect(t.shell.mock.calls.map((call) => call[0])).toEqual(['echo check', 'echo verify'])
    expect(t.shell.mock.calls.every((call) => call[6] !== true)).toBe(true)
  })

  it('keeps a confirmed schedule’s model shell unattended', async () => {
    const t = harness()
    const { session, turnDone } = await startWatchedSession(t.host, '/ws', 'allowAll')
    session.onEvent((event) => {
      if (event.type === 'approvalRequested') {
        void session.decideApproval({
          approvalId: event.approvalId,
          requirementId: event.requirementId,
          choiceId: 'allow_once',
        })
      }
    })
    const schedules = session.schedules
    if (schedules === undefined) throw new Error('expected schedules')
    const job = await schedules.create({ kind: 'interval', everyMs: 60_000 }, 'probe')
    t.advance()
    t.api.script({ calls: [SHELL] }, { text: 'done' })
    const done = turnDone()
    await schedules.run(job.id, job.nextFireAtMs, {
      sessionId: session.sessionId,
      modelId: session.modelId,
      prompt: job.prompt,
    })
    await done
    expect(t.shell).toHaveBeenCalled()
    expect(t.shell.mock.calls[0]?.[6]).toBe(false)
  })

  it('keeps a child/team worker’s model shell unattended', async () => {
    const t = harness()
    const { session } = await startWatchedSession(t.host, '/ws', 'allowAll')
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: JSON.stringify({ role: 'explorer', objective: 'probe' }),
            callId: 'spawn',
          },
        ],
      },
      { text: 'done' },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'delegate' }])
    await session.settled()
    await vi.waitFor(() => {
      expect(session.history().items.find((item) => item.kind === 'subagent')).toMatchObject({
        controlStatus: 'resultReady',
      })
    })
    t.api.script({ calls: [SHELL] }, { text: 'done' })
    await session.messageSubagent('subagent-1', 'probe', true)
    await vi.waitFor(() => {
      expect(t.shell).toHaveBeenCalled()
    })
    expect(t.shell.mock.calls.every((call) => call[6] === false)).toBe(true)
  })
})
