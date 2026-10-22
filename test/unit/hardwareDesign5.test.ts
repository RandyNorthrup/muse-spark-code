import * as childProcess from 'node:child_process'
import * as fsPromises from 'node:fs/promises'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fakeStopServer, stopUnconfirmedNotice } from './helpers/fakeMakerMachine'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionHardwareGuard } from '../../src/core/maker/sessionGuard'
import type { HardwareContext } from '../../src/core/maker/guard/httpCommands'
import type { HardwareStop } from '../../src/core/maker/guard/hardwareCommands'
import { isHardwareStop } from '../../src/core/maker/guard/hardwareCommands'
import { approvalHardwareAction } from '../../src/core/agent/approvalHardware'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { shellOutcome } from '../../src/core/backends/modelapi/tools'
import { runCommand, createToolIo, createHardwareStopRunner } from '../../src/host/backend/toolIo'
import { MAKER_STOP_DEADLINE_MS, UI_TEXT } from '../../src/shared/constants'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { fakeMspHost } from './helpers/fakeMsp'
import { FakeLogOutputChannel } from './helpers/fakes'
import { raceRequested } from './helpers/stageRaceCapture'
import { acpResumeEnvelope } from './helpers/acpMsp'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'

vi.mock('node:child_process', { spy: true })
vi.mock('node:fs/promises', { spy: true })

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function workspace(marker?: string, content = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-guard5-'))
  roots.push(root)
  if (marker !== undefined) {
    mkdirSync(path.dirname(path.join(root, marker)), { recursive: true })
    writeFileSync(path.join(root, marker), content)
  }
  return root
}
function host(
  root: string,
  source?: () => HardwareContext,
  shouldFailStop = false,
  runStop: (stop: HardwareStop) => Promise<void> = () => Promise.resolve(),
) {
  const h = fakeMspHost()
  const stops: HardwareStop[] = []
  const owner = new MuseCodeHost(
    h.host,
    new FakeLogOutputChannel(),
    { normalMs: 2000, longMs: 2000 },
    undefined,
    undefined,
    undefined,
    source,
    (stop) => {
      stops.push(stop)
      if (shouldFailStop) throw new Error('simulated uncertain delivery')
      return runStop(stop)
    },
  )
  h.server.handle('session/start', () => ({
    session: { sessionId: 'old-1', modelId: 'muse-spark-1.3' },
  }))
  h.server.handle('session/resume', () => ({
    ...acpResumeEnvelope(),
    session: { ...acpResumeEnvelope().session, workspaceRoot: root },
  }))
  for (const method of [
    'session/setApprovalMode',
    'approval/decide',
    'turn/cancel',
    'task/stopAll',
  ])
    h.server.handle(method, (params) => ({ commandId: params['commandId'], terminal: true }))
  h.server.handle('view/page', () => ({ events: [], nextCursor: null }))
  h.server.handle('turn/start', () => ({ turnId: 't1', disposition: 'started' }))
  return { ...h, owner, stops, root }
}
async function watchedSession(h: ReturnType<typeof host>) {
  const session = await h.owner.startSession({
    workspaceRoot: h.root,
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return { session, events }
}

function captured(command: string) {
  const capture = raceRequested('old-1')
  const subject = capture['subject']
  if (typeof subject !== 'object' || subject === null) throw new Error('Missing captured subject')
  return { ...capture, subject: { ...subject, command } }
}

function expectLatched(root: string) {
  const guard = new SessionHardwareGuard(
    () => ({ workspaceRoot: root }),
    () => undefined,
    () => undefined,
  )
  try {
    expect(guard.current().hardwareSessionLatched).toBe(true)
  } finally {
    guard.dispose()
  }
}

describe('Design 5 guard4 regressions', () => {
  it.each([
    ['printer.cfg', ''],
    ['Marlin/Configuration.h', ''],
    ['app/prj.conf', ''],
    ['west.yml', ''],
    ['device.yaml', 'esphome:\n  name: fixture'],
    ['code.py', ''],
    ['boot.py', ''],
    ['robot/package.xml', '<package/>'],
    ['boards/pico_sdk_import.cmake', ''],
  ])('P1.4 detects planned marker %s before opaque shell admission', (marker, content) => {
    const root = workspace(marker, content)
    expectLatched(root)
  })
  it('P1.4 missing workspace fails closed', () => {
    const root = path.join(workspace(), 'missing')
    expectLatched(root)
  })
  it('P1.3 new Muse session latches caller workspace before Bypass reaches wire', async () => {
    const root = workspace('platformio.ini')
    const h = host(root)
    try {
      await expect(
        h.owner.startSession({
          workspaceRoot: root,
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        }),
      ).rejects.toThrow()
      expect(h.server.requestsFor('session/start')).toHaveLength(0)
    } finally {
      await h.owner.close()
    }
  })
  it('P2.1 Model API rejects Bypass at start from the project owner', async () => {
    const root = workspace('platformio.ini')
    const api = fakeModelApi()
    const io = memoryToolIo({}, root)
    const client = fakeModelApiClient(api, new FakeLogOutputChannel())
    const deps = fakeModelApiHostDeps({
      client,
      workspaceRoot: root,
      io,
      log: new FakeLogOutputChannel(),
    })
    const { hardwareContext: _fakeInventory, ...production } = deps
    const owner = new ModelApiHost(production)
    try {
      await expect(
        owner.startSession({
          workspaceRoot: root,
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareBypassNotice)
    } finally {
      await owner.close()
    }
  })
  it('P1.2 CLI cannot accept or start hardware without a process-start contract', async () => {
    const root = workspace('platformio.ini')
    const h = host(root)
    try {
      const { session, events } = await watchedSession(h)
      h.server.notify('approval/requested', captured('python move.py'))
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
      })
      const event = events.find((event) => event.type === 'approvalRequested')
      if (event?.type !== 'approvalRequested') throw new Error('Missing approval')
      expect(event.availableChoices.every((choice) => choice.decision !== 'approved')).toBe(true)
      await expect(
        session.decideApproval({
          approvalId: event.approvalId,
          requirementId: event.requirementId,
          choiceId: 'allow_once',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareBindingUnavailable)
      await expect(session.sendTurn([{ type: 'text', text: 'move' }])).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(h.server.requestsFor('turn/start')).toHaveLength(0)
      expect(h.server.requestsFor('approval/decide')).toHaveLength(0)
    } finally {
      await h.owner.close()
    }
  })
  it.each([false, true])(
    'P1.1/P2.3 captured stages do not gate trusted Stop, unattended=%s',
    async (isUnattended) => {
      const root = workspace()
      const targets = [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }]
      const h = host(root, () => ({ workspaceRoot: root, targets, isUnattended }))
      try {
        const session = await h.owner.startSession({
          workspaceRoot: root,
          modelId: 'muse-spark-1.3',
          approvalMode: 'onRequest',
        })
        const events: AgentEvent[] = []
        session.onEvent((event) => {
          events.push(event)
        })
        const frame = captured('curl -X POST https://printer.local/printer/emergency_stop')
        expect(JSON.stringify(frame)).toContain('stages')
        h.server.notify('approval/requested', frame)
        await vi.waitFor(() => {
          expect(h.stops).toHaveLength(1)
        })
        expect(h.stops[0]).toEqual({
          kind: 'http',
          address: 'https://printer.local/printer/emergency_stop',
        })
        expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
        await vi.waitFor(() => {
          expect(h.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
        })
      } finally {
        await h.owner.close()
      }
    },
  )
  it('uncertain Stop delivery never claims nothing was sent', async () => {
    const root = workspace()
    const h = host(
      root,
      () => ({ targets: [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }] }),
      true,
    )
    try {
      const { events } = await watchedSession(h)
      h.server.notify(
        'approval/requested',
        captured('curl -X POST https://printer.local/printer/emergency_stop'),
      )
      await vi.waitFor(() => {
        expect(events).toContainEqual({
          type: 'backendNotice',
          level: 'error',
          text: UI_TEXT.hardwareStopUnconfirmed,
        })
      })
      expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    } finally {
      await h.owner.close()
    }
  })

  it.each([302, 500, 204])(
    'RVM103W2 P2 the Muse Code adapter confirms a loopback Stop answered %i only on 2xx',
    async (status) => {
      const { address, requests, close } = await fakeStopServer(status)
      const runner = createHardwareStopRunner({
        platform: process.platform,
        systemRoot: process.env['SystemRoot'],
        log: () => undefined,
      })
      const root = workspace()
      // The extension's and the runtime's Muse Code adapters: any nonzero exit is unconfirmed.
      const h = host(
        root,
        () => ({ targets: [{ address, stop: '/printer/emergency_stop' }] }),
        false,
        async (stop) => {
          const result = await runner(stop)
          if (result.exitCode !== 0) throw new Error(UI_TEXT.hardwareRefused)
        },
      )
      try {
        const { events } = await watchedSession(h)
        h.server.notify(
          'approval/requested',
          captured(`curl -X POST ${address}/printer/emergency_stop`),
        )
        await vi.waitFor(() => {
          expect(h.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
        })
        expect(requests).toEqual(['POST /printer/emergency_stop'])
        if (status === 204) expect(events).not.toContainEqual(stopUnconfirmedNotice)
        else expect(events).toContainEqual(stopUnconfirmedNotice)
      } finally {
        await h.owner.close()
        await close()
      }
    },
  )

  it('P1.1 Stop classification ignores extra subject stages', () => {
    const command = 'curl -X POST https://printer.local/printer/emergency_stop'
    const frame = captured(command)
    const subject = frame.subject
    expect(
      approvalHardwareAction(
        { ...subject, kind: 'shell', command },
        { targets: [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }] },
      ),
    ).toBeUndefined()
    expect(
      approvalHardwareAction(
        { ...subject, kind: 'shell', command, toolName: 'mcp__moonraker__send_gcode' },
        { targets: [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }] },
      ),
    ).toBeUndefined()
  })
  it('P2.5 hardware resume refuses before pending request presentation or CLI attachment', async () => {
    const root = workspace('platformio.ini')
    const h = host(root)
    h.server.handle('session/resume', () => ({
      ...acpResumeEnvelope(),
      session: { ...acpResumeEnvelope().session, workspaceRoot: root },
      pendingRequests: [{ kind: 'approval', approvalId: 'pending' }],
    }))
    h.server.handle('approval/listPending', () => ({ approvals: [], userInputs: [] }))
    try {
      await expect(h.owner.resumeSession('old-1', 'muse-spark-1.3')).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(h.server.requestsFor('session/resume')).toHaveLength(0)
      expect(h.server.requestsFor('approval/listPending')).toHaveLength(0)
    } finally {
      await h.owner.close()
    }
  })
  it('P2.2 final entry refusal preserves reason instead of user-stop outcome', async () => {
    const result = await runCommand({
      file: '/unused',
      args: [],
      cwd: workspace(),
      env: {},
      timeoutMs: 1,
      signal: undefined,
      tree: { platform: 'linux', systemRoot: undefined, log: () => undefined },
      assertCanStart: () => {
        throw new Error('Hardware identity changed')
      },
    })
    expect(shellOutcome(result, 1)).toMatchObject({ failureReason: 'Hardware identity changed' })
    expect(shellOutcome(result, 1).output).not.toContain('stopped by the user')
  })
  it('P2.6 trusted Stop transport cannot use shell profile or PATH', async () => {
    const spawn = vi.mocked(childProcess.spawn)
    spawn.mockImplementation(() => {
      throw new Error('simulated native no-entry')
    })
    const io = createToolIo({
      platform: 'linux',
      systemRoot: undefined,
      hardwareContext: () => ({
        isHardwareWorkspace: true,
        targets: [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }],
      }),
      env: () => ({
        PATH: process.env['PATH'],
        BASH_ENV: '/malicious/profile',
        CURL_HOME: '/malicious',
      }),
      listFiles: () => Promise.resolve([]),
      searchWorkerPath: '',
      unsavedFiles: () => [],
      log: () => undefined,
    })
    if (io.runHardwareStop === undefined) {
      await io.runShell('curl -X POST https://printer.local/printer/emergency_stop', workspace(), 1)
    } else {
      await io.runHardwareStop({
        kind: 'http',
        address: 'https://printer.local/printer/emergency_stop',
      })
    }
    await io.runShell(
      'curl -X POST https://printer.local/printer/emergency_stop',
      workspace(),
      1,
      AbortSignal.abort(),
      undefined,
      () => {
        throw new Error('Stop cannot require entry approval')
      },
    )
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/curl',
      [
        '-q',
        '--config',
        '/dev/null',
        '--noproxy',
        '*',
        '--fail',
        '--output',
        '/dev/null',
        '--write-out',
        '%{http_code}',
        '-X',
        'POST',
        'https://printer.local/printer/emergency_stop',
      ],
      expect.objectContaining({ env: {}, cwd: undefined }),
    )
  })
  it('P3 printf hexadecimal Stop compares emitted byte, not quoted argv spelling', () => {
    expect(
      isHardwareStop(String.raw`printf '\x18' > /dev/ttyUSB0`, 'bash', {
        targets: [{ address: '/dev/ttyUSB0', stop: '\u{18}' }],
      }),
    ).toBe(true)
    expect(
      isHardwareStop('echo M112 > /dev/ttyUSB0', 'bash', {
        targets: [{ address: '/dev/ttyUSB0', stop: 'M112' }],
      }),
    ).toBe(false)
    expect(
      isHardwareStop('echo M112 > /dev/ttyUSB0', 'bash', {
        targets: [{ address: '/dev/ttyUSB0', stop: 'M112\n' }],
      }),
    ).toBe(true)
  })
  it('RVM103W P2 a serial Stop whose port never opens settles unconfirmed at its deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const opening = Promise.withResolvers<fsPromises.FileHandle>()
      vi.mocked(fsPromises.open).mockImplementationOnce(() => opening.promise)
      const runner = createHardwareStopRunner({
        platform: process.platform,
        systemRoot: undefined,
        log: () => undefined,
      })
      let settled: unknown
      void runner({ kind: 'serial', address: '/dev/ttyUSB0', payload: 'M112\n' }).then((result) => {
        settled = result
      })
      await vi.advanceTimersByTimeAsync(MAKER_STOP_DEADLINE_MS - 1)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toMatchObject({ exitCode: null, isTimedOut: true })
      // The late port still receives Stop and is closed, never leaked.
      const port = path.join(workspace(), 'port')
      const late = await fsPromises.open(port, 'w')
      opening.resolve(late)
      await vi.waitFor(() => {
        expect(late.fd).toBe(-1)
      })
      expect(readFileSync(port, 'latin1')).toBe('M112\n')
    } finally {
      vi.useRealTimers()
    }
  })
})
