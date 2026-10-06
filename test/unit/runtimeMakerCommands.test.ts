import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import * as processTree from '../../src/host/processTree'
import { runMakerCommand, openMakerBrowser } from '../../src/runtime/maker/commands'
import { MachineHttp } from '../../src/core/maker/machines/http'
import type { MakerLanPolicy } from '../../src/core/maker/registry'
import { fakeMachineServer, moonrakerFrame, makerLimits } from './helpers/fakeMakerMachine'
import { fill } from '../../src/shared/l10n/text'
import { UI_TEXT } from '../../src/shared/constants'
import { makerHostMessageSchema, makerSurfaceMessageSchema } from '../../src/shared/makerProtocol'
import { randomUUID } from 'node:crypto'
import { companionAssets } from '../../src/runtime/maker/assets'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function commands(isTrusted = true, isInteractive = true, lan?: MakerLanPolicy) {
  const root = await mkdtemp(path.join(tmpdir(), 'maker-commands-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const presence = { check: vi.fn().mockResolvedValue('approved') }
  const service = await createRuntimeMakerService({
    dataDirectory: path.join(root, 'data'),
    workspace,
    ...(lan !== undefined && { lan }),
    trusted: () => isTrusted,
    flagged: () => true,
    presence,
    interactive: () => isInteractive,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    native: {
      platform: process.platform,
      env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
      packageRoot: path.resolve('.'),
    },
  })
  const distDirectory = path.join(root, 'dist')
  await mkdir(path.join(distDirectory, 'webview', 'chunks'), { recursive: true })
  await writeFile(path.join(distDirectory, 'webview', 'main.js'), 'export {}')
  await writeFile(path.join(distDirectory, 'webview', 'main.css'), '')
  const openBrowser = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  const output: string[] = []
  const readSecret = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined)
  return {
    service,
    presence,
    output,
    distDirectory,
    workspace,
    readSecret,
    openBrowser,
    send(signal: AbortSignal) {
      return service.dispatch(
        { v: 1, type: 'makerSend', id: randomUUID(), machineId: 'printer', payload: 'M104 S100' },
        signal,
      )
    },
    async run(args: readonly string[], running?: AbortController) {
      const command = parseMakerCommand(args)
      if (command === undefined) throw new Error('missing-command')
      const done = running ?? new AbortController()
      if (running === undefined) done.abort()
      try {
        return await runMakerCommand(command, {
          service,
          readSecret,
          print: (line) => {
            output.push(line)
          },
          distDirectory,
          openBrowser,
          done: done.signal,
        })
      } finally {
        await service.close()
      }
    },
  }
}
const registration = {
  machine: {
    id: 'printer',
    name: 'Bench printer',
    kind: 'moonraker',
    category: 'printer',
    endpoint: 'https://192.168.1.10',
    limits: {},
  },
  allowPlainHttp: false,
}
describe('runtime maker command execution without a credential store or device', () => {
  it.each(['machines-add', 'panel'])(
    'denied presence blocks %s before credentials or OS browser launch',
    async (action) => {
      const fixture = await commands()
      fixture.presence.check.mockResolvedValue('denied')
      const args =
        action === 'panel'
          ? ['panel', '--trust-workspace']
          : [
              'machines',
              'add',
              '--registration',
              JSON.stringify(registration),
              '--key-stdin',
              '--trust-workspace',
            ]
      await expect(fixture.run(args)).rejects.toThrow(UI_TEXT.makerPresenceDenied)
      expect(fixture.readSecret).not.toHaveBeenCalled()
      expect(fixture.openBrowser).not.toHaveBeenCalled()
      expect(await fixture.service.registry.list()).toEqual([])
    },
  )
  it('denied presence blocks surface machine registration before its registry mutates', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'bench')
    fixture.presence.check.mockResolvedValue('denied')
    const register = vi.spyOn(fixture.service.registry, 'register').mockResolvedValue(undefined)
    try {
      await expect(
        fixture.service.dispatch(
          makerSurfaceMessageSchema.parse({ v: 1, type: 'makerAddMachine', ...registration }),
          new AbortController().signal,
        ),
      ).rejects.toThrow(UI_TEXT.makerPresenceDenied)
      expect(register).not.toHaveBeenCalled()
    } finally {
      await fixture.service.close()
    }
  })

  it('runs hardware enable, status and disable against host-owned storage', async () => {
    const fixture = await commands()
    expect(
      await fixture.run([
        'hardware',
        'enable',
        '--reason',
        'supervised bench',
        '--trust-workspace',
      ]),
    ).toBe(0)
    expect(await fixture.run(['hardware', 'status'])).toBe(0)
    expect(fixture.output).toEqual([UI_TEXT.makerHardwareEnabled, UI_TEXT.makerHardwareEnabled])
    expect(await fixture.run(['hardware', 'disable'])).toBe(0)
    expect(fixture.output.at(-1)).toBe(UI_TEXT.makerHardwareDisabled)
  })
  it('runs secretless add, list and remove without a network request', async () => {
    const fixture = await commands()
    expect(
      await fixture.run([
        'machines',
        'add',
        '--registration',
        JSON.stringify(registration),
        '--trust-workspace',
      ]),
    ).toBe(0)
    expect(await fixture.run(['machines', 'list'])).toBe(0)
    expect(await fixture.service.registry.list()).toHaveLength(1)
    expect(fixture.readSecret).not.toHaveBeenCalled()
    expect(await fixture.run(['machines', 'remove', 'printer', '--trust-workspace'])).toBe(0)
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('refuses an empty key-stdin instead of registering without that key', async () => {
    const fixture = await commands()
    await expect(
      fixture.run([
        'machines',
        'add',
        '--registration',
        JSON.stringify(registration),
        '--key-stdin',
        '--trust-workspace',
      ]),
    ).rejects.toThrow()
    expect(fixture.readSecret).toHaveBeenCalledTimes(1)
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('keeps Stop available with no trust or hardware grant', async () => {
    const fixture = await commands(false)
    expect(await fixture.run(['stop-machine', '--all'])).toBe(0)
    expect(fixture.output).toEqual([UI_TEXT.makerSoftwareStopWarning])
    expect(fixture.service.tools().map((tool) => tool.name)).toEqual(['machine_stop'])
    await expect(fixture.run(['hardware', 'enable', '--reason', 'bench'])).rejects.toThrow()
  })
  it('opens the panel with OS presence and an out-of-band capability, with no stdout credential', async () => {
    const fixture = await commands(false)
    expect(await fixture.run(['panel'])).toBe(0)
    expect(fixture.output).toEqual([])
    expect(fixture.openBrowser).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})$/),
    )
    const assets = await companionAssets(fixture.distDirectory)
    expect(assets.get('/')?.body).not.toContain('maker-code')
    expect(assets.get('/bridge.js')?.body).toContain("fetch('/presence'")
  })
  it.each([
    ['hardware', 'enable', '--reason', 'bench', '--trust-workspace'],
    ['machines', 'add', '--registration', JSON.stringify(registration), '--trust-workspace'],
    ['panel', '--trust-workspace'],
  ])('refuses unattended maker privilege %j without printing a credential', async (...args) => {
    const fixture = await commands(true, false)
    await expect(fixture.run(args)).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
    expect(fixture.output).toEqual([])
    expect(fixture.openBrowser).not.toHaveBeenCalled()
    expect(fixture.readSecret).not.toHaveBeenCalled()
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('cancelling a turn while approval is pending only revokes; it sends no emergency Stop', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'bench')
    await fixture.service.registry.register({
      ...registration.machine,
      limits: makerLimits,
      allowPlainHttp: false,
    })
    const calls: string[] = []
    const http = vi.spyOn(MachineHttp.prototype, 'json').mockImplementation((_method, path) => {
      calls.push(path)
      return Promise.resolve(
        path === '/printer/info'
          ? { result: { hostname: 'virtual', software_version: 'test', state: 'ready' } }
          : moonrakerFrame(),
      )
    })
    const requested = Promise.withResolvers<undefined>()
    const off = fixture.service.host.subscribe((message) => {
      if (message.type === 'makerApproval') requested.resolve(undefined)
    })
    const controller = new AbortController()
    const sending = fixture.send(controller.signal)
    const outcome = (async () => {
      try {
        await sending
        return 'sent'
      } catch {
        return 'refused'
      }
    })()
    try {
      await requested.promise
      controller.abort()
      expect(await outcome).toBe('refused')
      expect(calls).not.toContain('/printer/emergency_stop')
      expect(calls).not.toContain('/printer/gcode/script')
    } finally {
      off()
      http.mockRestore()
      await fixture.service.close()
    }
  })
  it.each([false, true])(
    'cancelling after guarded HTTP dispatch retains controller Stop and reports failure: %s',
    async (hasStopFailure) => {
      const server = await fakeMachineServer()
      const fixture = await commands(true, true, {
        classify: () => 'private',
        resolve: () => Promise.resolve(['127.0.0.1']),
      })
      server.holdSend()
      await fixture.service.host.setHardware(true, 'fake supervised printer')
      await fixture.service.registry.register({
        ...registration.machine,
        endpoint: server.endpoint,
        limits: makerLimits,
        allowPlainHttp: true,
      })
      const notices: unknown[] = []
      const off = fixture.service.host.subscribe((message) => {
        if (message.type === 'makerNotice') notices.push(message.notice)
        else if (message.type === 'makerApproval')
          void (async () => {
            const answer = {
              id: message.request.id,
              digest: message.request.digest,
              target: message.request.target,
              decision: 'allow_once',
            }
            fixture.service.host.answer(answer, await fixture.service.host.authorize(answer))
          })()
      })
      const controller = new AbortController()
      const sending = fixture.send(controller.signal)
      const outcome = (async () => {
        try {
          await sending
        } catch {
          // Cancellation may leave the dispatched request's outcome unknown.
        }
      })()
      try {
        await vi.waitFor(
          () => {
            expect(
              server.requests.some((request) => request.path === '/printer/gcode/script'),
            ).toBe(true)
          },
          { timeout: 120_000 },
        )
        if (hasStopFailure) server.reply({ status: 500, body: 'private fake failure' })
        controller.abort()
        await vi.waitFor(() => {
          expect(
            server.requests.some((request) => request.path === '/printer/emergency_stop'),
          ).toBe(true)
        })
        if (hasStopFailure)
          await vi.waitFor(() => {
            expect(notices).toContainEqual({
              type: 'makerNotice',
              level: 'error',
              message: fill(UI_TEXT.makerStopFailed, { machine: 'Bench printer' }),
            })
          })
        await outcome
      } finally {
        off()
        server.releaseSend()
        await fixture.service.close()
        await server.close()
      }
    },
  )
  it.each(['linux', 'darwin', 'win32'] as const)(
    'opens only the OS-presence-approved capability URL with the %s OS launcher',
    async (platform) => {
      const run = vi.spyOn(processTree, 'runProgram').mockResolvedValue('')
      const url = 'http://127.0.0.1:12345/#' + 'a'.repeat(64)
      try {
        await openMakerBrowser(url, platform, { SystemRoot: String.raw`C:\Windows` })
        const [file, args] = run.mock.calls[0] ?? []
        expect(file).toBe(
          {
            win32: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
            darwin: '/usr/bin/open',
            linux: '/usr/bin/xdg-open',
          }[platform],
        )
        expect(args?.join(' ')).toContain(url)
        if (platform === 'win32') expect(args?.at(-1)).toMatch(/^Start-Process -FilePath '/)
        else expect(args).toEqual([url])
      } finally {
        run.mockRestore()
      }
    },
  )
  it.each(['#private-fake-launch', '?launch=private-fake-launch'])(
    'refuses a launcher URL carrying a capability in %s',
    async (suffix) => {
      const run = vi.spyOn(processTree, 'runProgram').mockResolvedValue('')
      try {
        await expect(
          openMakerBrowser(`http://127.0.0.1:12345/${suffix}`, 'linux', {}),
        ).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
        expect(run).not.toHaveBeenCalled()
      } finally {
        run.mockRestore()
      }
    },
  )
  it('returns correlated makerResult messages for the shared serial surface', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'supervised bench')
    const execute = vi.spyOn(fixture.service.serial, 'execute')
    const message = {
      v: 1 as const,
      type: 'makerSerial' as const,
      id: randomUUID(),
      operation: 'read' as const,
      target: { kind: 'serial' as const, port: 'COM99' },
      baud: 115_200,
      durationMs: 100,
      dtr: false,
      rts: false,
      payloadHex: '',
    }
    try {
      execute.mockResolvedValueOnce({ status: 'refused', reason: 'classification' })
      const refused = makerHostMessageSchema.parse(
        await fixture.service.dispatch(message, new AbortController().signal),
      )
      expect(refused).toMatchObject({ type: 'makerResult', id: message.id, outcome: 'refused' })
      execute.mockResolvedValueOnce({
        status: 'complete',
        capture: { bytes: Buffer.alloc(0), reason: 'stopped' },
      })
      expect(
        makerHostMessageSchema.parse(
          await fixture.service.dispatch(message, new AbortController().signal),
        ),
      ).toMatchObject({ type: 'makerResult', id: message.id, outcome: 'stopped' })
    } finally {
      await fixture.service.close()
    }
  })
  it('refuses a raw serial write before discovery when no reviewed classifier is supplied', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'supervised bench')
    try {
      expect(
        await fixture.service.serial.execute(
          {
            operation: 'write',
            identity: { port: 'COM99' },
            baud: 115_200,
            durationMs: 100,
            dtr: false,
            rts: false,
            payloadHex: '00',
          },
          new AbortController().signal,
        ),
      ).toEqual({ status: 'refused', reason: 'classification' })
    } finally {
      await fixture.service.close()
    }
  })
})
