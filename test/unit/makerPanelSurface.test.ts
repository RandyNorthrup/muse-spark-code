// RLF-DEVICES: the panel path. The executor asks through the panel
// surface, the Devices snapshot carries the waiting prompt, and the
// document's echoed answer settles it. The round trip below runs the
// real panel, the real request parser, the real surface, the real
// printer executor and the printer simulator: send approves the exact
// bytes, reject sends nothing.
import { describe, expect, it } from 'vitest'
import { DevicePanel } from '../../src/core/devices/devicePanel'
import { MakerService, PanelMakerSurface } from '../../src/host/devices/makerService'
import type { MakerApprovalPrompt } from '../../src/shared/maker'
import {
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DevicesPanelState,
} from '../../src/shared/devicesPanel'

const VIEW_ID = 'a'.repeat(32)
const REQUEST_ID = 'b'.repeat(32)

function testPrompt(requestId: string): MakerApprovalPrompt {
  return {
    requestId,
    digest: 'e'.repeat(64),
    target: { kind: 'printer', name: 'sim', endpoint: 'sim', simulated: true },
    operation: 'connect',
    preview: [],
  }
}

describe('panel maker surface', () => {
  it('queues prompts and shows the head', async () => {
    let published = 0
    let revealed = 0
    const surface = new PanelMakerSurface({
      publish: () => {
        published += 1
      },
      reveal: () => {
        revealed += 1
      },
    })
    const signal = new AbortController().signal
    const first = testPrompt('c'.repeat(32))
    const second = testPrompt('d'.repeat(32))
    const firstFlight = surface.ask(first, signal)
    const secondFlight = surface.ask(second, signal)
    expect(surface.pendingPrompt()).toBe(first)
    expect(revealed).toBe(1)
    expect(published).toBe(1)
    surface.answer({
      kind: 'answerMakerApproval',
      requestId: first.requestId,
      decision: 'send',
      digest: 'e'.repeat(64),
    })
    expect(await firstFlight).toMatchObject({ decision: 'send' })
    expect(surface.pendingPrompt()).toBe(second)
    surface.answer({
      kind: 'answerMakerApproval',
      requestId: second.requestId,
      decision: 'reject',
      digest: 'e'.repeat(64),
    })
    expect(await secondFlight).toMatchObject({ decision: 'reject' })
    expect(surface.pendingPrompt()).toBeUndefined()
    expect(published).toBe(4)
    surface.dispose()
  })

  it('ignores an answer for another request', async () => {
    const surface = new PanelMakerSurface({ publish: () => undefined, reveal: () => undefined })
    const prompt = testPrompt('f'.repeat(32))
    let didSettle = false
    const flight = surface.ask(prompt, new AbortController().signal)
    const watch = (async (): Promise<void> => {
      await flight
      didSettle = true
    })()
    surface.answer({
      kind: 'answerMakerApproval',
      requestId: '0'.repeat(32),
      decision: 'send',
      digest: 'e'.repeat(64),
    })
    await Promise.resolve()
    expect(didSettle).toBe(false)
    expect(surface.pendingPrompt()).toBe(prompt)
    surface.answer({
      kind: 'answerMakerApproval',
      requestId: prompt.requestId,
      decision: 'send',
      digest: 'e'.repeat(64),
    })
    expect(await flight).toMatchObject({ decision: 'send' })
    await watch
    expect(didSettle).toBe(true)
    surface.dispose()
  })

  it('settles waiting prompts on abort and dispose', async () => {
    const surface = new PanelMakerSurface({ publish: () => undefined, reveal: () => undefined })
    const controller = new AbortController()
    const flight = surface.ask(testPrompt('c'.repeat(32)), controller.signal)
    const queued = surface.ask(testPrompt('d'.repeat(32)), new AbortController().signal)
    controller.abort()
    expect(await flight).toBeNull()
    surface.dispose()
    expect(await queued).toBeNull()
    expect(surface.pendingPrompt()).toBeUndefined()
    expect(await surface.ask(testPrompt('e'.repeat(32)), new AbortController().signal)).toBeNull()
  })
})

function harness(): {
  service: MakerService
  panel: DevicePanel
  published: DeviceHostMessage[]
} {
  const service = new MakerService({ publish: () => undefined, reveal: () => undefined })
  const published: DeviceHostMessage[] = []
  const panel = new DevicePanel({
    perform: (request) => {
      if (request.action.kind === 'answerMakerApproval') {
        service.surface.answer(request.action)
        return Promise.resolve({ viewId: request.viewId, requestId: request.requestId })
      }
      throw new Error('unexpected panel action')
    },
    snapshot: (): Promise<DevicesPanelState> => {
      const makerApproval = service.surface.pendingPrompt()
      return Promise.resolve(
        makerApproval === undefined
          ? { enabled: false as const }
          : { enabled: false as const, makerApproval },
      )
    },
    publish: (message) => {
      published.push(message)
    },
  })
  return { service, panel, published }
}

async function answerThroughPanel(
  panel: DevicePanel,
  prompt: MakerApprovalPrompt,
  decision: 'send' | 'reject',
): Promise<void> {
  const parsed = parseDeviceWebviewRequest({
    type: 'deviceRequest',
    viewId: VIEW_ID,
    requestId: REQUEST_ID,
    revision: 0,
    action: {
      kind: 'answerMakerApproval',
      requestId: prompt.requestId,
      decision,
      digest: prompt.digest,
    },
  })
  if (!parsed.ok) throw new Error('test answer rejected by the parser')
  await panel.request(parsed.message)
}

function pendingPrompt(service: MakerService, what: string): MakerApprovalPrompt {
  const prompt = service.surface.pendingPrompt()
  if (prompt === undefined) throw new Error(`${what} asked nothing`)
  return prompt
}

async function connectAndHome(
  service: MakerService,
  panel: DevicePanel,
  signal: AbortSignal,
): Promise<void> {
  const printer = service.simulators.printer
  const connectFlight = service.printer.connect(printer, service.asker(), {}, signal)
  await answerThroughPanel(panel, pendingPrompt(service, 'connect'), 'send')
  const connected = await connectFlight
  expect(connected.ok).toBe(true)
  const homeFlight = service.printer.send(
    printer,
    service.asker(),
    new TextEncoder().encode('G28\n'),
    {},
    signal,
  )
  await answerThroughPanel(panel, pendingPrompt(service, 'home'), 'send')
  const homed = await homeFlight
  expect(homed.ok).toBe(true)
}

describe('panel approval round trip', () => {
  it('sends the exact bytes after the panel approves', async () => {
    const { service, panel } = harness()
    const signal = new AbortController().signal
    const printer = service.simulators.printer
    await connectAndHome(service, panel, signal)

    const payload = new TextEncoder().encode('G1 X10 Y10\n')
    const sendFlight = service.printer.send(printer, service.asker(), payload, {}, signal)
    const prompt = pendingPrompt(service, 'send')
    // The snapshot carries the waiting prompt for the document.
    const observed = await panel.observe()
    expect(observed.state).toMatchObject({ makerApproval: { requestId: prompt.requestId } })
    expect(prompt.preview).toEqual([{ kind: 'text', text: 'G1 X10 Y10' }])
    await answerThroughPanel(panel, prompt, 'send')
    const result = await sendFlight
    expect(result.ok).toBe(true)
    const after = await panel.observe()
    expect(after.state).not.toHaveProperty('makerApproval')
    service.dispose()
  })

  it('sends nothing when the panel rejects', async () => {
    const { service, panel } = harness()
    const signal = new AbortController().signal
    const printer = service.simulators.printer
    await connectAndHome(service, panel, signal)

    const before = printer.readState().fingerprint
    const sendFlight = service.printer.send(
      printer,
      service.asker(),
      new TextEncoder().encode('G1 X10\n'),
      {},
      signal,
    )
    const prompt = pendingPrompt(service, 'send')
    await answerThroughPanel(panel, prompt, 'reject')
    const result = await sendFlight
    expect(result).toMatchObject({ ok: false, reason: 'approval-rejected' })
    expect(printer.readState().fingerprint).toBe(before)
    service.dispose()
  })
})
