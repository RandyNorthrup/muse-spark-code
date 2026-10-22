import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makePrivateFolder, makerTempRoot, runtimeMakerNative } from './helpers/makerTemp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import { runMakerCommand, openMakerBrowser } from '../../src/runtime/maker/commands'
import type { MakerLanPolicy } from '../../src/core/maker/registry'
import { machineSimulator, makerLimits } from './helpers/makerMachineSimulator'
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
  const root = await mkdtemp(path.join(makerTempRoot(), 'maker-commands-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const presenceState = { result: 'approved' as 'approved' | 'denied' | 'unavailable' }
  const presence = { check: () => Promise.resolve(presenceState.result) }
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
    native: runtimeMakerNative(),
  })
  // A host's inherited folder ACL is not under test: the lease folder is private everywhere.
  await makePrivateFolder(path.join(root, 'data', 'maker', 'leases'))
  const distDirectory = path.join(root, 'dist')
  await mkdir(path.join(distDirectory, 'webview', 'chunks'), { recursive: true })
  await writeFile(path.join(distDirectory, 'webview', 'main.js'), 'export {}')
  await writeFile(path.join(distDirectory, 'webview', 'main.css'), '')
  const opened: string[] = []
  const openBrowser = (url: string) => {
    opened.push(url)
    return Promise.resolve()
  }
  const output: string[] = []
  const secretReads = { count: 0 }
  const readSecret = () => {
    secretReads.count += 1
    return Promise.resolve(undefined)
  }
  return {
    service,
    presence,
    presenceState,
    opened,
    secretReads,
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
      fixture.presenceState.result = 'denied'
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
      expect(fixture.secretReads.count).toBe(0)
      expect(fixture.opened).toEqual([])
      expect(await fixture.service.registry.list()).toEqual([])
    },
  )
  it('denied presence blocks surface machine registration before its registry mutates', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'bench')
    fixture.presenceState.result = 'denied'
    try {
      await expect(
        fixture.service.dispatch(
          makerSurfaceMessageSchema.parse({ v: 1, type: 'makerAddMachine', ...registration }),
          new AbortController().signal,
        ),
      ).rejects.toThrow(UI_TEXT.makerPresenceDenied)
      expect(await fixture.service.registry.list()).toEqual([])
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
    expect(fixture.secretReads.count).toBe(0)
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
    expect(fixture.secretReads.count).toBe(1)
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
    expect(fixture.opened).toHaveLength(1)
    expect(fixture.opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    const assets = await companionAssets(fixture.distDirectory)
    expect(assets.get('/')?.body).not.toContain('maker-code')
    expect(assets.get('/bridge.js')?.body).toContain("fetch('/presence'")
    expect(assets.get('/bridge.js')?.body).toContain("fetch('/launch-code'")
    expect(assets.get('/bridge.js')?.body).not.toContain('location.hash')
  })
  it.each([false, true])(
    'delivers /events approvals and notices after the HTTP makerReady, parsed by the deferred schemas (reloaded: %s)',
    async (isReload) => {
      const fixture = await commands(false)
      const assets = await companionAssets(fixture.distDirectory)
      const bridge = String(assets.get('/bridge.js')?.body)
      // The startup bundle is the only module the bridge imports; everything else is a fake transport.
      const entry = "import('/assets/main.js')"
      expect(bridge.split(entry)).toHaveLength(2)
      const v = 1
      const state = {
        v,
        type: 'makerState',
        isTrusted: false,
        hardwareEnabled: false,
        isInteractive: true,
        machines: [],
        ports: [],
      }
      const approval = {
        v,
        type: 'makerApproval',
        request: {
          kind: 'command',
          id: randomUUID(),
          digest: 'a'.repeat(64),
          target: { kind: 'serial', port: '/dev/ttyACM0' },
          expiresAt: Date.now() + 1000,
          action: 'program',
          payload: 'firmware bytes',
        },
      }
      const closed = { v, type: 'makerApprovalClosed', id: approval.request.id }
      const notice = { v, type: 'makerNotice', notice: 'physicalStopRequired' }
      // A reload resumes the cookie session; its spent launch code is refused.
      const fetched: string[] = []
      const fetch = (url: string) => {
        fetched.push(url)
        return Promise.resolve(
          url === (isReload ? '/launch-code' : '/session')
            ? new Response(null, { status: 401 })
            : Response.json(
                {
                  '/session': {},
                  '/launch-code': { launch: 'b'.repeat(64) },
                  '/launch': {},
                  '/message': state,
                }[url],
              ),
        )
      }
      const surface = new EventTarget() as EventTarget & {
        acquireVsCodeApi: () => { postMessage: (message: unknown) => void }
      }
      const delivered: unknown[] = []
      const errors: unknown[] = []
      surface.addEventListener('message', (event) => {
        delivered.push((event as MessageEvent).data)
      })
      surface.addEventListener('error', (event) => {
        errors.push((event as Event & { error: unknown }).error)
      })
      class ErrorEvent extends Event {
        constructor(
          type: string,
          readonly init: { error: unknown },
        ) {
          super(type)
        }
        get error() {
          return this.init.error
        }
      }
      const streams: { onmessage?: (event: { data: string }) => void }[] = []
      class EventSource {
        onmessage?: (event: { data: string }) => void
        constructor(url: string) {
          expect(url).toBe('/events')
          streams.push(this)
        }
      }
      const schemasLoaded = Promise.withResolvers<undefined>()
      const main = {
        ...(await import('../../src/shared/companionProtocol')),
        async makerBoundarySchemas() {
          await schemasLoaded.promise
          return await import('../../src/webview/maker/boundaries')
        },
      }
      // The bridge is a module body with top-level await: run it as an async function body.
      const AsyncFunction = main.makerBoundarySchemas.constructor as new (
        ...parameters: string[]
      ) => (...values: unknown[]) => Promise<void>
      const running = new AsyncFunction(
        'window',
        'fetch',
        'EventSource',
        'MessageEvent',
        'ErrorEvent',
        'importMain',
        bridge.replace(entry, 'importMain()'),
      )(surface, fetch, EventSource, MessageEvent, ErrorEvent, () => Promise.resolve(main))
      surface.acquireVsCodeApi().postMessage({ v, type: 'makerReady' })
      // /events stays closed until the maker schemas have loaded: no frame arrives unparsed.
      await vi.waitFor(() => {
        expect(fetched).toContain(isReload ? '/session' : '/launch')
      })
      expect(streams).toEqual([])
      schemasLoaded.resolve(undefined)
      await running
      await vi.waitFor(() => {
        expect(delivered).toEqual([state])
      })
      const [stream] = streams
      expect(streams).toHaveLength(1)
      for (const frame of [approval, notice, closed])
        stream?.onmessage?.({ data: JSON.stringify(frame) })
      expect(delivered).toEqual([state, approval, notice, closed])
      // A frame the schema refuses throws instead of reaching the shared UI.
      expect(() =>
        stream?.onmessage?.({ data: JSON.stringify({ ...notice, notice: 'invented' }) }),
      ).toThrow()
      expect(delivered).toHaveLength(4)
      expect(errors).toEqual([])
      expect(fetched).toEqual(
        isReload ? ['/session', '/message'] : ['/session', '/launch-code', '/launch', '/message'],
      )
    },
  )
  it.each([
    ['hardware', 'enable', '--reason', 'bench', '--trust-workspace'],
    ['machines', 'add', '--registration', JSON.stringify(registration), '--trust-workspace'],
    ['panel', '--trust-workspace'],
  ])('refuses unattended maker privilege %j without printing a credential', async (...args) => {
    const fixture = await commands(true, false)
    await expect(fixture.run(args)).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
    expect(fixture.output).toEqual([])
    expect(fixture.opened).toEqual([])
    expect(fixture.secretReads.count).toBe(0)
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('cancelling a turn while approval is pending only revokes; it sends no emergency Stop', async () => {
    const server = await machineSimulator()
    const fixture = await commands(true, true, {
      classify: () => 'private',
      resolve: () => Promise.resolve(['127.0.0.1']),
    })
    await fixture.service.host.setHardware(true, 'bench')
    await fixture.service.registry.register({
      ...registration.machine,
      endpoint: server.endpoint,
      limits: makerLimits,
      allowPlainHttp: true,
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
      const paths = server.requests.map((request) => request.path)
      expect(paths).not.toContain('/printer/emergency_stop')
      expect(paths).not.toContain('/printer/gcode/script')
    } finally {
      off()
      await fixture.service.close()
      await server.close()
    }
  })
  it.each([false, true])(
    'cancelling after guarded HTTP dispatch retains controller Stop and reports failure: %s',
    async (hasStopFailure) => {
      const server = await machineSimulator()
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
      // The shared surface completes its payload review before answering, as
      // production does: it dispatches the exact makerPayloadReviewed message
      // through the service, and an answer without it is refused.
      let reviews = 0
      const notices: unknown[] = []
      const off = fixture.service.host.subscribe((message) => {
        if (message.type === 'makerNotice') notices.push(message.notice)
        else if (message.type === 'makerApproval')
          void (async () => {
            const reviewed = await fixture.service.dispatch(
              {
                v: 1,
                type: 'makerPayloadReviewed',
                id: message.request.id,
                digest: message.request.digest,
                isComplete: true,
              },
              new AbortController().signal,
            )
            expect(reviewed).toBe(true)
            reviews += 1
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
        expect(reviews).toBe(1)
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
  it.each(['#private-fake-launch', '#' + 'a'.repeat(64), '?launch=private-fake-launch'])(
    'refuses a launcher URL carrying a capability in %s',
    async (suffix) => {
      await expect(
        openMakerBrowser(`http://127.0.0.1:12345/${suffix}`, 'linux', {}),
      ).rejects.toThrow(UI_TEXT.makerUnattendedDenied)
    },
  )
  it('returns correlated makerResult messages for the shared serial surface', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'supervised bench')
    const message = {
      v: 1 as const,
      type: 'makerSerial' as const,
      id: randomUUID(),
      operation: 'write' as const,
      target: { kind: 'serial' as const, port: 'COM99' },
      baud: 115_200,
      durationMs: 100,
      dtr: false,
      rts: false,
      payloadHex: '00',
    }
    try {
      const refused = makerHostMessageSchema.parse(
        await fixture.service.dispatch(message, new AbortController().signal),
      )
      expect(refused).toMatchObject({ type: 'makerResult', id: message.id, outcome: 'refused' })
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
