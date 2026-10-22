// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { UI_TEXT } from '../../src/shared/constants'
import { MakerSurface, mountMaker } from '../../src/webview/maker/MakerSurface'
import { MachineWizard } from '../../src/webview/maker/MachineWizard'
import {
  uiApproval,
  uiBridge,
  MAKER_UI_STATE,
  MAKER_UI_MACHINE,
  installMakerBrowser,
} from './helpers/makerUi'

const visibility = { current: installMakerBrowser() }
beforeEach(() => {
  visibility.current = installMakerBrowser()
})

afterEach(() => {
  cleanup()
})
function renderMaker() {
  const result = uiBridge()
  result.store.receive(MAKER_UI_STATE)
  render(<MakerSurface store={result.store} />)
  return result
}

async function askOnce(store: ReturnType<typeof uiBridge>['store']) {
  act(() => {
    store.receive({ v: 1, type: 'makerApproval', request: uiApproval(Date.now() + 60_000) })
  })
  return await screen.findByRole('dialog', { name: UI_TEXT.makerApprovalTitle })
}

describe('shared maker views', () => {
  it('shared dialog Stop is outside the scrolling body', async () => {
    const { store, posted } = renderMaker()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle }))
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerDevicesTitle })
    const stop = within(dialog).getByRole('button', { name: UI_TEXT.makerStopAll })
    expect(stop.closest('.modal-body')).toBeNull()
    expect(stop.closest('.maker-stop-slot')?.parentElement).toBe(dialog)
    fireEvent.click(stop)
    expect(posted.at(-1)).toEqual({ v: 1, type: 'makerStop' })
    store.dispose()
  })
  it('renders exact target, payload and analysis; one click echoes the host request', async () => {
    const { store, posted } = renderMaker()
    const request = uiApproval(Date.now() + 60_000)
    act(() => {
      store.receive({ v: 1, type: 'makerApproval', request })
    })
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerApprovalTitle })
    await waitFor(() => expect(dialog).toHaveTextContent('M104 S190'))
    expect(dialog).toHaveTextContent(request.digest)
    expect(dialog).toHaveTextContent(MAKER_UI_MACHINE.registrationId)
    expect(dialog).toHaveTextContent('Klipper')
    expect(within(dialog).getByRole('button', { name: UI_TEXT.makerSendOnce })).toBeDisabled()
    act(() => {
      visibility.current()
    })
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: UI_TEXT.makerSendOnce })).toBeEnabled(),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.makerSendOnce }))
    expect(posted.at(-1)).toEqual({
      v: 1,
      type: 'makerAnswer',
      answer: {
        id: request.id,
        digest: request.digest,
        target: request.target,
        decision: 'allow_once',
      },
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    store.dispose()
  })

  it.each(['close', 'escape', 'backdrop'])('dismissal by %s rejects once', async (method) => {
    const { store, posted } = renderMaker()
    const dialog = await askOnce(store)
    if (method === 'close')
      fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.usageClose }))
    else if (method === 'escape') fireEvent.keyDown(dialog, { key: 'Escape' })
    else if (method === 'backdrop' && dialog.parentElement !== null)
      fireEvent.mouseDown(dialog.parentElement)
    expect(posted).toHaveLength(1)
    expect(posted.at(-1)).toEqual(
      expect.objectContaining({ answer: expect.objectContaining({ decision: 'reject_once' }) }),
    )
    store.dispose()
  })

  it('Stop remains operable inside approval and log dialogs, without answering approval', async () => {
    const { store, posted } = renderMaker()
    const dialog = await askOnce(store)
    const stop = await within(dialog).findByRole('button', {
      name: `${UI_TEXT.makerStopMachine}: ${MAKER_UI_MACHINE.name}`,
    })
    fireEvent.click(stop)
    expect(posted.at(-1)).toEqual({ v: 1, type: 'makerStop', machineId: 'printer' })
    expect(store.getState().approvals).toHaveLength(1)
    store.dispose()
  })

  it('serial controls request exact bytes with reset warning and no direct approval', async () => {
    const { store, posted } = renderMaker()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle }))
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerDevicesTitle })
    expect(dialog).toHaveTextContent(UI_TEXT.makerResetWarning)
    fireEvent.change(within(dialog).getByLabelText(UI_TEXT.makerPayloadHex), {
      target: { value: '00ff' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.makerWriteSerial }))
    expect(posted.at(-1)).toEqual(
      expect.objectContaining({
        type: 'makerSerial',
        operation: 'write',
        payloadHex: '00ff',
        dtr: false,
        rts: false,
        target: MAKER_UI_STATE.ports[0],
      }),
    )
    fireEvent.change(within(dialog).getByLabelText(UI_TEXT.makerPayloadHex), {
      target: { value: 'not hex' },
    })
    expect(within(dialog).getByRole('button', { name: UI_TEXT.makerWriteSerial })).toBeDisabled()
    act(() => {
      store.receive({ ...MAKER_UI_STATE, hardwareEnabled: false })
    })
    expect(within(dialog).getByRole('button', { name: UI_TEXT.makerReadSerial })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: UI_TEXT.makerStopAll })).toBeEnabled()
    store.dispose()
  })

  it('shows serial identity, exact hex and reset/unknown-identity warnings', async () => {
    const { store } = renderMaker()
    const common = uiApproval(Date.now() + 60_000)
    act(() => {
      store.receive({
        v: 1,
        type: 'makerApproval',
        request: {
          kind: 'serial',
          id: common.id,
          digest: createHash('sha256')
            .update(Uint8Array.from([0, 255]))
            .digest('hex'),
          expiresAt: common.expiresAt,
          target: {
            kind: 'serial',
            port: 'COM7',
            vid: '303a',
            pid: '1001',
            serialNumber: 'board-one',
          },
          action: 'program',
          payload: { encoding: 'hex', value: '00ff' },
          baud: 115_200,
          durationMs: 1000,
          dtr: false,
          rts: false,
          warnsAboutReset: true,
          flashIdentity: { status: 'unknown' },
          projectTarget: { idfTarget: 'esp32' },
        },
      })
    })
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerApprovalTitle })
    expect(dialog).toHaveTextContent(UI_TEXT.makerResetWarning)
    expect(dialog).toHaveTextContent(UI_TEXT.makerIdentityUnknown)
    await waitFor(() => expect(dialog).toHaveTextContent(String.raw`␀\xff`))
    expect(dialog).toHaveTextContent('board-one')
    expect(dialog).toHaveTextContent('esp32')
    store.dispose()
  })

  it('makes the chat inert behind dialogs and restores focus on close', async () => {
    const background = document.createElement('main')
    background.id = 'root'
    document.body.append(background)
    const { store } = renderMaker()
    const trigger = screen.getByRole('button', { name: UI_TEXT.makerDevicesTitle })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerDevicesTitle })
    expect(background.inert).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.usageClose }))
    expect(background.inert).toBe(false)
    expect(document.activeElement).toBe(trigger)
    background.remove()
    store.dispose()
  })

  it('logs remain a user-opened view and preserve uncertainty with payload escaped', async () => {
    const { store, posted } = renderMaker()
    act(() => {
      store.receive({
        v: 1,
        type: 'makerDeviceLog',
        entries: [
          {
            time: 1000,
            machine: 'printer',
            action: 'actuate',
            payload: '<script>bad()</script>',
            digest: 'a'.repeat(64),
            approval: null,
            outcome: 'sentOutcomeUnknown',
          },
        ],
      })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.makerOpenDeviceLog }))
    const dialog = await screen.findByRole('dialog', { name: UI_TEXT.makerOpenDeviceLog })
    expect(dialog).toHaveTextContent(UI_TEXT.makerDeviceLogPrivacy)
    expect(dialog).toHaveTextContent(UI_TEXT.makerSentOutcomeUnknown)
    expect(dialog).toHaveTextContent('<script>bad()</script>')
    expect(dialog.querySelector('script')).toBeNull()
    expect(posted.at(-1)).toEqual({ v: 1, type: 'makerOpenLog' })
    store.dispose()
  })

  it('the wizard refuses incomplete/reversed limits and requires explicit plain-HTTP consent', () => {
    const { posted, store } = uiBridge()
    store.receive(MAKER_UI_STATE)
    let closes = 0
    const close = () => {
      closes += 1
    }
    render(<MachineWizard send={store.send} onClose={close} stop={null} />)
    fireEvent.change(screen.getByLabelText(UI_TEXT.makerName), { target: { value: 'Bench' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.makerMachineId), { target: { value: 'bench' } })
    fireEvent.change(screen.getByLabelText(UI_TEXT.makerEndpoint), {
      target: { value: 'http://192.168.1.5' },
    })
    fireEvent.submit(
      screen.getByRole('button', { name: UI_TEXT.makerAddMachine }).closest('form') ??
        document.body,
    )
    expect(posted).toEqual([])
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.makerInvalidInput)
    fireEvent.click(screen.getByLabelText(UI_TEXT.makerPlainHttpWarning))
    fireEvent.change(screen.getByLabelText('Minimum x (mm)'), { target: { value: '10' } })
    fireEvent.submit(
      screen.getByRole('button', { name: UI_TEXT.makerAddMachine }).closest('form') ??
        document.body,
    )
    expect(posted).toEqual([])
    for (const axis of ['x', 'y', 'z']) {
      fireEvent.change(screen.getByLabelText(`Minimum ${axis} (mm)`), { target: { value: '0' } })
      fireEvent.change(screen.getByLabelText(`Maximum ${axis} (mm)`), { target: { value: '100' } })
    }
    fireEvent.change(screen.getByLabelText('Minimum x (mm)'), { target: { value: '200' } })
    fireEvent.submit(
      screen.getByRole('button', { name: UI_TEXT.makerAddMachine }).closest('form') ??
        document.body,
    )
    expect(posted).toEqual([])
    fireEvent.change(screen.getByLabelText('Minimum x (mm)'), { target: { value: '0' } })
    fireEvent.submit(
      screen.getByRole('button', { name: UI_TEXT.makerAddMachine }).closest('form') ??
        document.body,
    )
    expect(posted.at(-1)).toEqual({
      v: 1,
      type: 'makerAddMachine',
      allowPlainHttp: true,
      machine: {
        id: 'bench',
        name: 'Bench',
        kind: 'moonraker',
        category: 'printer',
        endpoint: 'http://192.168.1.5',
        limits: { travel: { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 100, z: 100 } } },
      },
    })
    expect(closes).toBe(1)
    store.dispose()
  })
})

it('mount resolves only after Stop is committed, so the static shell can hand over safely', async () => {
  const { host, posted, store } = uiBridge()
  const element = document.createElement('div')
  document.body.append(element)
  const surface = await mountMaker(element, host)
  try {
    const stop = within(element).getByRole('button', { name: UI_TEXT.makerStopAll })
    fireEvent.click(stop)
    expect(posted.at(-1)).toEqual({ v: 1, type: 'makerStop' })
  } finally {
    act(() => {
      surface.dispose()
    })
    store.dispose()
  }
})
