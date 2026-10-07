import { mkdtempSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelApiHost, type ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ShellResult } from '../../src/core/backends/modelapi/tools'
import { createToolIo } from '../../src/host/backend/toolIo'
import { createFileScheduleStore } from '../../src/host/backend/fileScheduleStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', { spy: true })

const hosts: ModelApiHost[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) await removeFolder(root)
})

function harness(isNativeShell = false) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const root = mkdtempSync(path.join(tmpdir(), 'envfence-origin-'))
  roots.push(root)
  const workspaceRoot = isNativeShell ? root : '/ws'
  const io = memoryToolIo({}, workspaceRoot)
  const shellResults: ShellResult[] = []
  if (isNativeShell) {
    const native = createToolIo({
      platform: process.platform,
      systemRoot: process.env['SystemRoot'],
      env: () => process.env,
      passEnvironmentVariables: () => ['OPENAI_API_KEY'],
      listFiles: () => Promise.resolve([]),
      searchWorkerPath: 'unused',
      log: () => undefined,
      unsavedFiles: () => [],
    })
    io.runShell = async (...args) => {
      const result = await native.runShell(...args)
      shellResults.push(result)
      return result
    }
  }
  const shell = vi.spyOn(io, 'runShell')
  let now = 1_000_000
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot,
      io,
      log,
    }),
    now: () => now,
    store: memorySessionStore(),
    scheduleStore: createFileScheduleStore({ directory: root, now: () => now, log }),
    isPaidFeatureOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    ...(isNativeShell && {
      platform: process.platform,
      shellKeepsDirectory: () => true,
      shellSidecarDir: path.join(root, 'sidecars'),
    }),
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
    shellResults,
    host,
    workspaceRoot,
    sidecarDir: path.join(root, 'sidecars'),
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

async function scheduledProbe(session: ModelApiSession) {
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
  return { schedules, job }
}

describe('D89.5 command origins cannot widen unattended environments', () => {
  it.each([
    { origin: 'scheduled', isScheduled: true, startsAnotherTurn: false },
    {
      origin: 'scheduled with a later interactive turn',
      isScheduled: true,
      startsAnotherTurn: true,
    },
    { origin: 'interactive', isScheduled: false, startsAnotherTurn: false },
  ])(
    'retains the $origin origin through directory preparation after backgrounding',
    async (test) => {
      vi.stubEnv('OPENAI_API_KEY', 'envfence-fake-delayed')
      const t = harness(true)
      const { session, events, turnDone } = await startWatchedSession(
        t.host,
        t.workspaceRoot,
        'allowAll',
      )
      const { schedules, job } = await scheduledProbe(session)
      t.advance()
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const actual = await vi.importActual<typeof fs>('node:fs/promises')
      vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
        if (args[0] === t.sidecarDir) {
          entered.resolve(undefined)
          await release.promise
        }
        return await actual.mkdir(...args)
      })
      const nextRequested = Promise.withResolvers<undefined>()
      const nextRelease = Promise.withResolvers<undefined>()
      const command = process.platform === 'win32' ? 'Get-ChildItem Env:' : 'env'
      t.api.script(
        {
          calls: [
            {
              ...SHELL,
              name: process.platform === 'win32' ? 'powershell' : 'bash',
              arguments: JSON.stringify({ command, description: 'probe' }),
            },
          ],
        },
        { text: 'done' },
        {
          text: 'next',
          hold: nextRelease.promise,
          onRequest: () => {
            nextRequested.resolve(undefined)
          },
        },
      )
      const done = turnDone()
      try {
        if (test.isScheduled) {
          await schedules.run(job.id, job.nextFireAtMs, {
            sessionId: session.sessionId,
            modelId: session.modelId,
            prompt: job.prompt,
          })
        } else {
          await session.sendTurn([{ type: 'text', text: 'run' }])
        }
        await entered.promise
        const row = session
          .history()
          .items.find((item) => item.tool === 'bash' || item.tool === 'powershell')
        if (row === undefined) throw new Error('expected shell row')
        await session.moveToBackground(row.itemId)
        await done
        expect(t.shell).not.toHaveBeenCalled()
        if (test.startsAnotherTurn) {
          await session.sendTurn([{ type: 'text', text: 'another interactive turn' }])
          await nextRequested.promise
        }
        const completed = Promise.withResolvers<undefined>()
        const unwatch = session.onEvent((event) => {
          if (event.type === 'itemCompleted' && event.item.itemId === row.itemId)
            completed.resolve(undefined)
        })
        try {
          release.resolve(undefined)
          await completed.promise
        } finally {
          unwatch()
        }
        expect(
          events.some(
            (event) => event.type === 'itemCompleted' && event.item.itemId === row.itemId,
          ),
        ).toBe(true)
        const result = t.shellResults[0]
        expect(result?.exitCode).toBe(0)
        expect(result?.stdout.includes('envfence-fake-delayed')).toBe(!test.isScheduled)
        expect(t.shell.mock.calls[0]?.[6]).toBe(!test.isScheduled)
      } finally {
        release.resolve(undefined)
        nextRelease.resolve(undefined)
        await session.settled()
      }
    },
  )

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
    const { schedules, job } = await scheduledProbe(session)
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
