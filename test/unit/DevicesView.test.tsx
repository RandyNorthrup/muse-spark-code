// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { EN } from '../../src/shared/l10n/en'
import { deviceObservationText } from '../../src/webview/models/sections/agents/devicePresentation'
import * as l10nText from '../../src/shared/l10n/text'
import { setUiText } from '../../src/shared/l10n/text'
import { DEVICE_FAILURES, deviceInvitationSchema } from '../../src/shared/devices'
import {
  DEVICE_STATUSES,
  type DevicesPanelState,
  type DeviceHostMessage,
  type DevicesPanelPort,
  type DeviceWebviewRequest,
} from '../../src/shared/modelsPanel'
import { DeviceCard } from '../../src/webview/models/sections/agents/DeviceCard'
import { DevicePairing } from '../../src/webview/models/sections/agents/DevicePairing'
import { DevicesView } from '../../src/webview/models/sections/agents/DevicesView'
import {
  DeviceTaskDetails,
  type DeviceTaskView,
} from '../../src/webview/models/sections/agents/DeviceTaskDetails'
import {
  expectRejectedDeviceInvitation,
  uiUncertainMessage,
  expireDeviceUiWait,
  resolveDeviceUiReply,
  uiDeferredPort,
  UI_BOARD_ID,
  UI_PAIR_ID,
  uiDevice,
  uiConfirmation,
  uiInvitation,
  uiMessage,
  uiOffer,
  uiPort,
} from './helpers/deviceUiFakes'

const expectedStatuses = {
  local: EN.devices.local,
  connected: EN.devices.connected,
  paused: EN.devices.paused,
  offline: EN.devices.offline,
  uncertain: EN.devices.uncertain,
  incompatible: EN.devices.incompatible,
  'blocked-or-unreachable': EN.devices.blocked,
}
const expectedFailures = {
  'blocked-or-unreachable': EN.devices.blocked,
  incompatible: EN.devices.protocolMismatch,
  'unsupported-host': EN.devices.unsupportedHost,
  storage: EN.devices.storageUnavailable,
  'reconcile-required': EN.devices.unresolvedHelp,
  uncertain: EN.devices.unresolvedHelp,
  'approval-required': EN.devices.localApprovalHelp,
  'paid-consent-required': EN.devices.localApprovalHelp,
  revoked: EN.devices.revokedHelp,
  unpaired: EN.devices.unpairedHelp,
  capacity: EN.devices.capacityHelp,
  grant: EN.devices.grantHelp,
  'invalid-frame': EN.devices.invalidMessage,
  'payload-changed': EN.devices.invalidMessage,
}
function LiveView({
  initial = uiMessage(),
  port = uiPort(),
}: {
  readonly initial?: DeviceHostMessage
  readonly port?: DevicesPanelPort
}) {
  const [message, setMessage] = useState(initial)
  return (
    <DevicesView
      message={message}
      onState={(reply) => {
        setMessage(reply)
        return true
      }}
      port={port}
      explicitSetup
      boards={[{ pairId: UI_PAIR_ID, boardId: UI_BOARD_ID, canResume: true }]}
    />
  )
}
function offerForm(): HTMLFormElement {
  const button = screen.getByRole('button', { name: EN.devices.saveOffer })
  const form = button.closest('form')
  if (form === null) throw new Error('missing offer form')
  return form
}
function importInvitationText(text: string): void {
  fireEvent.change(screen.getByLabelText(EN.devices.scan), { target: { value: text } })
  fireEvent.submit(
    screen.getByRole('button', { name: EN.devices.importInvitation }).closest('form')!,
  )
}
function importConfirmationText(text: string): void {
  fireEvent.change(screen.getByLabelText(EN.devices.scan), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: EN.devices.importConfirmation }))
}
afterEach(() => {
  setUiText(EN, 'en')
  vi.useRealTimers()
})

describe('M100 U shared Devices view', () => {
  it('returns no pairing data when the surviving parent refuses snapshot acceptance', async () => {
    const onState = vi.fn(() => false)
    const port = uiPort({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
    })
    render(<DevicesView message={uiMessage()} port={port} onState={onState} explicitSetup />)
    importInvitationText(JSON.stringify(uiInvitation))
    await screen.findByText(EN.devices.invalidMessage)
    expect(onState).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: EN.devices.confirmFingerprint })).toBeNull()
  })

  it('carries the live view, distinct request id and current revision on every action', async () => {
    const port = uiPort()
    const { unmount } = render(<LiveView port={port} />)
    for (const count of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled(),
      )
      expect(port.request).toHaveBeenCalledTimes(count)
    }
    const first = port.request.mock.calls[0]![0]
    const second = port.request.mock.calls[1]![0]
    expect(first.viewId).toMatch(/^[a-f0-9]{32}$/)
    expect(second.viewId).toBe(first.viewId)
    expect(second.requestId).not.toBe(first.requestId)
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    unmount()
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(port.request.mock.calls[2]![0].viewId).not.toBe(first.viewId)
  })
  it('rejects a reply for a foreign view before exposing its pairing data', async () => {
    const port = uiPort()
    port.request.mockImplementation((request) =>
      Promise.resolve({
        ...uiMessage(),
        revision: 2,
        setup: { viewId: UI_PAIR_ID, requestId: request.requestId, invitation: uiInvitation },
      }),
    )
    const onState = vi.fn(() => true)
    render(<DevicesView message={uiMessage()} port={port} onState={onState} explicitSetup />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await screen.findByText(EN.devices.invalidMessage)
    expect(screen.queryByLabelText(EN.devices.copyInvitation)).toBeNull()
    expect(onState).not.toHaveBeenCalled()
  })

  it.each(['pair', 'importInvitation'] as const)(
    'rejects stale %s invitation data before pairing can consume it',
    async (kind) => {
      const onState = vi.fn(() => true)
      const port = uiPort({
        ...uiMessage(),
        setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
      })
      render(
        <DevicesView
          message={{
            ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
            revision: 3,
          }}
          port={port}
          onState={onState}
          explicitSetup
        />,
      )
      if (kind === 'pair') fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      else importInvitationText(JSON.stringify(uiInvitation))
      await expectRejectedDeviceInvitation()
      expect(onState).not.toHaveBeenCalled()
      expect(port.request).toHaveBeenCalledOnce()
    },
  )
  it('aborts an unmounted embedded view and drops its late reply into a surviving parent', async () => {
    vi.useFakeTimers()
    const held = Promise.withResolvers<DeviceHostMessage>()
    const port = {
      request: vi.fn((_request: DeviceWebviewRequest, _signal?: AbortSignal) => held.promise),
    }
    const published = vi.fn()
    function Parent() {
      const [open, setOpen] = useState(true)
      const [message, setMessage] = useState(uiMessage())
      return (
        <>
          <button
            onClick={() => {
              setOpen(!open)
            }}
          >
            Toggle Devices
          </button>
          <button
            onClick={() => {
              setMessage({
                ...uiMessage({
                  status: 'uncertain',
                  unresolvedAttempts: 1,
                  retainedLiabilityUsd: 3,
                }),
                revision: 3,
              })
            }}
          >
            Observe uncertainty
          </button>
          {open && (
            <DevicesView
              message={message}
              port={port}
              explicitSetup
              onState={(reply) => {
                published(reply)
                setMessage(reply)
                return true
              }}
            />
          )}
        </>
      )
    }
    const { unmount } = render(<Parent />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const request = port.request.mock.calls[0]?.[0]
    const signal = port.request.mock.calls[0]?.[1]
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Devices' }))
    const wasAborted = signal?.aborted
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const remainingTimers = vi.getTimerCount()
    fireEvent.click(screen.getByRole('button', { name: 'Observe uncertainty' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Devices' }))
    await act(() => resolveDeviceUiReply(held, request, { ...uiMessage(), revision: 2 }))
    expect(published).not.toHaveBeenCalled()
    expect(wasAborted).toBe(true)
    expect(remainingTimers).toBe(0)
    expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    unmount()
  })

  it('Retry restores action focus and requires a fresh guarded choice', async () => {
    const port = uiPort()
    port.request.mockRejectedValue(new Error('fixture failure'))
    render(<LiveView port={port} />)
    const pair = screen.getByRole('button', { name: EN.devices.pair })
    pair.focus()
    fireEvent.click(pair)
    await screen.findByText(EN.devices.invalidMessage)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    expect(document.activeElement).toBe(pair)
    expect(port.request).toHaveBeenCalledOnce()
    fireEvent.click(pair)
    expect(port.request).toHaveBeenCalledTimes(2)
  })
  it('Retry never replays Resume after uncertainty disables its original control', async () => {
    const port = uiPort()
    port.request.mockRejectedValue(new Error('fixture failure'))
    const props = {
      port,
      onState: vi.fn(() => true),
      explicitSetup: true,
      boards: [{ pairId: UI_PAIR_ID, boardId: UI_BOARD_ID, canResume: true }],
    }
    const { rerender } = render(<DevicesView {...props} message={uiMessage()} />)
    const resume = screen.getByRole('button', { name: /Resume queue/ })
    resume.focus()
    fireEvent.click(resume)
    await screen.findByText(EN.devices.invalidMessage)
    rerender(
      <DevicesView
        {...props}
        message={{
          ...uiMessage({ status: 'uncertain', unresolvedAttempts: 1, retainedLiabilityUsd: 3 }),
          revision: 2,
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    expect(resume).toBeDisabled()
    expect(port.request).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(screen.getByRole('region', { name: EN.devices.title }))
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('Retry never replays Unlink after Cancel withdraws its confirmation', async () => {
    const port = uiPort()
    port.request.mockRejectedValue(new Error('fixture failure'))
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.unlink }))
    const confirm = screen.getByRole('button', { name: EN.devices.confirmUnlink })
    confirm.focus()
    fireEvent.click(confirm)
    await screen.findByText(EN.devices.invalidMessage)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.cancel }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    expect(port.request).toHaveBeenCalledOnce()
    expect(screen.queryByText(EN.devices.unlinkHelp)).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('region', { name: EN.devices.title }))
  })
  it('Retry never replays fingerprint confirmation after comparison is unchecked', async () => {
    const port = uiPort({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
    })
    render(<LiveView port={port} />)
    importInvitationText(JSON.stringify(uiInvitation))
    const confirm = await screen.findByRole('button', { name: EN.devices.confirmFingerprint })
    const compared = screen.getByLabelText(EN.devices.fingerprintMatches)
    fireEvent.click(compared)
    port.request.mockRejectedValueOnce(new Error('fixture failure'))
    confirm.focus()
    fireEvent.click(confirm)
    await screen.findByText(EN.devices.invalidMessage)
    fireEvent.click(compared)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
    expect(confirm).toBeDisabled()
    expect(port.request).toHaveBeenCalledTimes(2)
  })
  it('does not publish an older correlated action snapshot from an embedded view', async () => {
    const message = uiUncertainMessage()
    const onState = vi.fn(() => true)
    render(<DevicesView message={message} onState={onState} port={uiPort()} explicitSetup />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await waitFor(() => expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled())
    expect(onState).not.toHaveBeenCalled()
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
  })
  it('orders embedded snapshots and late action replies by revision, preserving Uncertain/$3', async () => {
    const held = Promise.withResolvers<DeviceHostMessage>()
    const port = { request: vi.fn((_request: DeviceWebviewRequest) => held.promise) }
    const props = { port, onState: vi.fn(() => true), explicitSetup: true }
    const { rerender } = render(<DevicesView {...props} message={uiMessage()} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const { requestId, viewId } = port.request.mock.calls[0]![0]
    const newer = {
      ...uiMessage({
        status: 'uncertain',
        unresolvedAttempts: 1,
        retainedLiabilityUsd: 3,
        lastObservedAt: 2000,
      }),
      revision: 3,
    }
    rerender(<DevicesView {...props} message={newer} />)
    await act(async () => {
      held.resolve({
        ...uiMessage({ lastObservedAt: 1000 }),
        revision: 2,
        setup: { viewId, requestId },
      })
      await held.promise
    })
    rerender(<DevicesView {...props} message={uiMessage()} />)
    expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    expect(screen.getByText(EN.devices.uncertain, { exact: true })).toBeVisible()
    expect(props.onState).not.toHaveBeenCalled()
  })
  it.each(['deadline', 'new observation'])(
    'keeps a retry busy after %s releases its previous wait',
    async (trigger) => {
      if (trigger === 'deadline') vi.useFakeTimers()
      const { port, first, second } = uiDeferredPort()
      const initial = uiMessage({
        status: 'uncertain',
        unresolvedAttempts: 1,
        retainedLiabilityUsd: 3,
      })
      const props = { port, onState: vi.fn(() => true), explicitSetup: true }
      const { rerender } = render(<DevicesView {...props} message={initial} />)
      fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      if (trigger === 'deadline') await act(expireDeviceUiWait)
      else rerender(<DevicesView {...props} message={{ ...initial, revision: 3 }} />)
      expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
      expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
      fireEvent.click(screen.getByRole('button', { name: EN.devices.retry }))
      fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      await act(() =>
        resolveDeviceUiReply(first, port.request.mock.calls[0]?.[0], {
          ...uiMessage(),
          revision: 2,
        }),
      )
      expect(screen.getByRole('button', { name: EN.devices.pair })).toBeDisabled()
      expect(props.onState).not.toHaveBeenCalled()
      await act(() =>
        resolveDeviceUiReply(second, port.request.mock.calls[1]?.[0], {
          ...initial,
          revision: 4,
        }),
      )
      expect(screen.getByRole('button', { name: EN.devices.pair })).toBeEnabled()
      expect(screen.getByText('Retained spending liability: $3.00')).toBeVisible()
    },
  )
  it('groups both fingerprints and announces the full peer value on heading focus', async () => {
    const fingerprint = '0123456789abcdef'.repeat(4)
    const invitation = { ...uiInvitation, fingerprint }
    const port = uiPort({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation },
    })
    render(<LiveView initial={uiMessage({ offers: [] })} port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await screen.findByLabelText(EN.devices.copyInvitation)
    importInvitationText(JSON.stringify(invitation))
    const peerHeading = await screen.findByRole('heading', { name: EN.devices.peerFingerprint })
    const grouped = '0123 4567 89ab cdef '.repeat(4).trim()
    expect(peerHeading).toHaveAccessibleDescription(grouped)
    await waitFor(() => {
      expect(document.activeElement).toBe(peerHeading)
    })
    const values = screen.getAllByRole('group', { name: grouped })
    expect(values).toHaveLength(2)
    for (const value of values) {
      expect(value).toHaveClass('device-fingerprint')
      expect(
        [...value.querySelectorAll(':scope > span > span')].map((group) => group.textContent),
      ).toEqual(grouped.split(' '))
    }
    const confirm = screen.getByRole('button', { name: EN.devices.confirmFingerprint })
    const cancel = within(confirm.parentElement!).getByRole('button', { name: EN.devices.cancel })
    expect(confirm.parentElement).toHaveClass('device-decisions')
    fireEvent.click(cancel)
    expect(screen.queryByRole('heading', { name: EN.devices.peerFingerprint })).toBeNull()
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: EN.devices.importInvitation }),
    )
  })
  it('rejects MAX_SAFE_INTEGER observations and keeps formatting safe even outside the schema', () => {
    render(<LiveView initial={uiMessage({ lastObservedAt: Number.MAX_SAFE_INTEGER })} />)
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    expect(deviceObservationText(Number.MAX_SAFE_INTEGER)).toBe(EN.devices.unknown)
    const formatter = vi.spyOn(l10nText, 'formatDateTime').mockImplementation(() => {
      throw new RangeError('bad date')
    })
    try {
      expect(deviceObservationText(1000)).toBe(EN.devices.unknown)
    } finally {
      formatter.mockRestore()
    }
  })
  it.each<DevicesPanelState>([
    { enabled: false },
    { enabled: true, discoveryEnabled: false, devices: [] },
  ])('keeps ordinary chat empty without an approved offer: %j', (state) => {
    const port = uiPort()
    const message: DeviceHostMessage = { type: 'deviceState', revision: 1, state }
    const { container } = render(
      <DevicesView message={message} port={port} onState={vi.fn(() => true)} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(port.request).not.toHaveBeenCalled()
  })
  it('hides a paired but unoffered device and its discovery control', () => {
    const port = uiPort()
    const { container } = render(
      <DevicesView message={uiMessage({ offers: [] })} port={port} onState={vi.fn(() => true)} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(port.request).not.toHaveBeenCalled()
  })
  it('rejects malformed observations before rendering controls or invoking a port', () => {
    const malformed = { ...uiMessage(), privatePath: 'peer-sentinel' }
    const port = uiPort()
    render(
      <DevicesView message={malformed} port={port} onState={vi.fn(() => true)} explicitSetup />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    expect(screen.queryByText('Mac receiver')).toBeNull()
    expect(port.request).not.toHaveBeenCalled()
  })
  it('plainly shows off in explicit setup and does no activity until Pair', async () => {
    const port = uiPort({ type: 'deviceState', revision: 1, state: { enabled: false } })
    render(
      <LiveView
        initial={{ type: 'deviceState', revision: 1, state: { enabled: false } }}
        port={port}
      />,
    )
    expect(screen.getByText(EN.devices.offHelp)).toBeVisible()
    expect(screen.queryByLabelText(EN.devices.discovery)).toBeNull()
    expect(port.request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledOnce()
    })
    expect(port.request.mock.calls[0]?.[0].action).toEqual({ kind: 'pair' })
  })
  it('pairs by keyboard text, focuses comparison and requires the full explicit fingerprint check', async () => {
    const peer = { ...uiInvitation, invitationId: '6'.repeat(32), fingerprint: '7'.repeat(64) }
    const port = uiPort()
    let revision = 1
    port.request.mockImplementation((request) => {
      const setup: NonNullable<DeviceHostMessage['setup']> = {
        viewId: request.viewId,
        requestId: request.requestId,
      }
      if (request.action.kind === 'pair') setup.invitation = uiInvitation
      else if (request.action.kind === 'importInvitation') setup.invitation = peer
      else setup.confirmation = uiConfirmation
      return Promise.resolve({ ...uiMessage(), revision: ++revision, setup })
    })
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation)
    expect(field).toHaveAccessibleName(EN.devices.copyInvitation)
    expect(field.labels[0]?.textContent).toBe(EN.devices.copyInvitation)
    fireEvent.focus(field)
    expect(deviceInvitationSchema.parse(JSON.parse(field.value))).toEqual(uiInvitation)
    importInvitationText(JSON.stringify(peer))
    const confirm = await screen.findByRole('button', { name: EN.devices.confirmFingerprint })
    expect(confirm).toBeDisabled()
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: EN.devices.peerFingerprint }),
    )
    fireEvent.click(confirm)
    expect(port.request).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByLabelText(EN.devices.fingerprintMatches))
    fireEvent.click(confirm)
    await screen.findByLabelText(EN.devices.copyConfirmation)
    expect(port.request.mock.calls[2]?.[0].action).toEqual({
      kind: 'confirmFingerprint',
      invitationId: peer.invitationId,
      fingerprint: peer.fingerprint,
    })
  })
  it('does not advance pairing when the local host reports a failure', async () => {
    const port = uiPort({
      ...uiMessage(),
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        invitation: uiInvitation,
        confirmation: uiConfirmation,
        failure: 'storage',
      },
    })
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await screen.findByText(EN.devices.storageUnavailable)
    expect(screen.queryByLabelText(EN.devices.copyConfirmation)).toBeNull()
    expect(screen.queryByLabelText(EN.devices.copyInvitation)).toBeNull()
  })
  it('keeps the invitation input label independent of pasted public bytes', () => {
    render(<LiveView />)
    const input = screen.getByLabelText<HTMLTextAreaElement>(EN.devices.scan)
    fireEvent.change(input, { target: { value: JSON.stringify(uiInvitation) } })
    expect(input).toHaveAccessibleName(EN.devices.scan)
    expect(input.labels[0]?.textContent).toBe(EN.devices.scan)
  })
  it('selects public text when copying is unavailable and sends validated confirmation only', async () => {
    const port = uiPort({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
    })
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const text = await screen.findByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.copyInvitation }))
    expect(document.activeElement).toBe(text)
    expect(text.selectionStart).toBe(0)
    expect(text.selectionEnd).toBe(text.value.length)
    importConfirmationText(JSON.stringify({ ...uiConfirmation, paidConsent: true }))
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    expect(port.request).toHaveBeenCalledOnce()
    importConfirmationText(JSON.stringify(uiConfirmation))
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledTimes(2)
    })
    expect(port.request.mock.calls[1]?.[0].action).toEqual({
      kind: 'importConfirmation',
      confirmation: uiConfirmation,
    })
  })
  it.each(DEVICE_STATUSES)('renders observed %s status without a liveness claim', (status) => {
    render(
      <LiveView
        initial={uiMessage({
          status,
          lastObservedAt: 1000,
          unresolvedAttempts: 1,
          retainedLiabilityUsd: 1,
          waitingApprovals: 1,
        })}
      />,
    )
    expect(screen.getByText(expectedStatuses[status], { exact: true })).toBeVisible()
    expect(screen.getByText(EN.devices.observationHelp)).toBeVisible()
    expect(screen.getByText('Waiting for approval on Mac receiver')).toBeVisible()
    expect(screen.queryByRole('button', { name: /allow|approve|hand off/i })).toBeNull()
    expect(screen.getByRole('button', { name: /Resume queue/ })).toBeDisabled()
  })
  it.each(DEVICE_FAILURES)('maps %s to fixed local recovery text', (failure) => {
    render(
      <LiveView
        initial={{ ...uiMessage(), setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, failure } }}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(expectedFailures[failure])
  })
  it('shows the actual listener, interface and endpoint from the correlated setup reply with usable OS/admin recovery', async () => {
    const message = uiMessage({
      status: 'blocked-or-unreachable',
      unresolvedAttempts: 1,
      retainedLiabilityUsd: 2,
    })
    const port = uiPort({
      ...message,
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        listenerApplication: 'Editor host',
        interfaceLabel: 'LAN en0',
      },
    })
    render(<LiveView initial={message} port={port} />)
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    expect(
      await screen.findByText(/Check Editor host on LAN en0 at 10.2.3.4:32,123/),
    ).toHaveTextContent('Ask an administrator for scoped access')
    expect(screen.getByText(/A timeout does not prove/)).toBeVisible()
    expect(screen.getByText('Retained spending liability: $2.00')).toBeVisible()
    expect(screen.getByText(EN.devices.unresolvedHelp)).toBeVisible()
  })
  it('never attributes one pair’s listener or interface facts to another pair', async () => {
    const message: DeviceHostMessage = {
      type: 'deviceState',
      revision: 1,
      state: {
        enabled: true,
        discoveryEnabled: false,
        devices: [
          { ...uiDevice, status: 'blocked-or-unreachable' },
          {
            ...uiDevice,
            pairId: '7'.repeat(32),
            deviceId: '8'.repeat(32),
            label: 'Linux receiver',
            status: 'blocked-or-unreachable',
            offers: [],
          },
        ],
      },
    }
    const port = uiPort({
      ...message,
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        listenerApplication: 'Editor host',
        interfaceLabel: 'LAN en0',
      },
    })
    render(<LiveView initial={message} port={port} />)
    const target = screen.getByRole('article', { name: 'Mac receiver' })
    const other = screen.getByRole('article', { name: 'Linux receiver' })
    fireEvent.submit(
      within(target).getByRole('button', { name: EN.devices.retryAddress }).closest('form')!,
    )
    await within(target).findByText(/Check Editor host on LAN en0/)
    expect(within(other).queryByText(/Editor host|LAN en0/)).toBeNull()
    expect(within(other).getByText(/Check Unknown on Unknown/)).toBeVisible()
  })
  it('does not reuse a prior action’s binding for a foreign setup request id', async () => {
    const initial = uiMessage({ status: 'blocked-or-unreachable' })
    const port = uiPort({
      ...initial,
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        listenerApplication: 'Verified listener',
      },
    })
    const onState = vi.fn<(message: DeviceHostMessage) => boolean>(() => true)
    const props = { port, onState, explicitSetup: true }
    const { rerender } = render(<DevicesView {...props} message={initial} />)
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    await waitFor(() => {
      expect(onState).toHaveBeenCalledOnce()
    })
    const response = onState.mock.calls[0]?.[0]
    if (response === undefined) throw new Error('missing correlated response')
    rerender(<DevicesView {...props} message={response} />)
    expect(screen.getByText(/Check Verified listener on Unknown/)).toBeVisible()
    rerender(
      <DevicesView
        {...props}
        message={{
          ...response,
          revision: response.revision + 1,
          setup: {
            viewId: UI_PAIR_ID,
            requestId: '8'.repeat(32),
            listenerApplication: 'Foreign listener',
          },
        }}
      />,
    )
    expect(screen.queryByText(/Foreign listener/)).toBeNull()
    expect(screen.getByText(/Check Unknown on Unknown/)).toBeVisible()
  })
  it('refuses public/manual address mutations and retains debt through an unsuccessful paired retry', async () => {
    const message = uiMessage({
      status: 'uncertain',
      unresolvedAttempts: 1,
      retainedLiabilityUsd: 2,
    })
    const port = uiPort({
      ...message,
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, failure: 'blocked-or-unreachable' },
    })
    render(<LiveView initial={message} port={port} />)
    fireEvent.change(screen.getByLabelText(EN.devices.address), { target: { value: '8.8.8.8' } })
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    expect(port.request).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(EN.devices.address), { target: { value: '10.2.3.4' } })
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledOnce()
    })
    expect(port.request.mock.calls[0]?.[0].action).toEqual({
      kind: 'setAddress',
      pairId: UI_PAIR_ID,
      endpoint: uiInvitation.endpoint,
    })
    expect(screen.getByText('Retained spending liability: $2.00')).toBeVisible()
    expect(screen.getByRole('button', { name: /Resume queue/ })).toBeDisabled()
  })
  it('edits caps locally, requires a nonempty offer and lets the host select the repository', async () => {
    const port = uiPort()
    render(<LiveView port={port} />)
    fireEvent.submit(offerForm())
    expect(port.request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(EN.devices.offer))
    fireEvent.change(screen.getByLabelText(EN.devices.workers), { target: { value: '0' } })
    fireEvent.submit(offerForm())
    expect(port.request).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(EN.devices.workers), { target: { value: '2' } })
    fireEvent.submit(offerForm())
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledOnce()
    })
    expect(port.request.mock.calls[0]?.[0].action).toEqual({
      kind: 'offer',
      pairId: UI_PAIR_ID,
      lanes: true,
      checks: false,
      caps: { ...uiOffer.caps, workers: 2 },
    })
    expect(screen.getByText(EN.devices.capHelp)).toBeVisible()
  })
  it('shows each model entry cap as well as the offered window cap', () => {
    const entry = uiOffer.entries[0]!
    render(
      <LiveView
        initial={uiMessage({
          offers: [
            {
              ...uiOffer,
              caps: { ...uiOffer.caps, workers: 2 },
              entries: [{ ...entry, caps: { ...entry.caps, workers: 1 } }],
            },
          ],
        })}
      />,
    )
    const row = screen
      .getByText(`${entry.roleId} · ${entry.model.providerId}/${entry.model.modelId}`)
      .closest('li')
    if (row === null) throw new Error('missing model entry')
    const worker = within(row).getByText(EN.devices.workers).closest('div')
    if (worker === null) throw new Error('missing worker cap')
    expect(within(worker).getByText('1', { exact: true })).toBeVisible()
  })
  it('refuses Offer lanes on an unsupported host', () => {
    render(
      <LiveView
        initial={{
          ...uiMessage(),
          setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, failure: 'unsupported-host' },
        }}
      />,
    )
    expect(screen.getByLabelText(EN.devices.offer)).toBeDisabled()
    expect(screen.getByRole('button', { name: EN.devices.saveOffer })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.unsupportedHost)
  })
  it('requires the saved reconciled board and never resumes offline or uncertain work', async () => {
    const port = uiPort()
    const props = { message: uiMessage(), port, onState: vi.fn(() => true), explicitSetup: true }
    const { rerender } = render(<DevicesView {...props} />)
    expect(screen.queryByRole('button', { name: /Resume queue/ })).toBeNull()
    const boards = [{ pairId: UI_PAIR_ID, boardId: UI_BOARD_ID, canResume: false }]
    rerender(<DevicesView {...props} boards={boards} />)
    expect(screen.getByRole('button', { name: /Resume queue/ })).toBeDisabled()
    rerender(<DevicesView {...props} boards={[{ ...boards[0]!, canResume: true }]} />)
    fireEvent.click(screen.getByRole('button', { name: /Resume queue/ }))
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledOnce()
    })
    expect(port.request.mock.calls[0]?.[0].action).toEqual({
      kind: 'resumeQueue',
      pairId: UI_PAIR_ID,
      boardId: UI_BOARD_ID,
    })
  })
  it.each([
    'offline',
    'uncertain',
    'incompatible',
    'blocked-or-unreachable',
  ] satisfies (typeof DEVICE_STATUSES)[number][])(
    'does not resume %s merely because its occupancy count is zero',
    (status) => {
      render(<LiveView initial={uiMessage({ status, unresolvedAttempts: 0 })} />)
      expect(screen.getByRole('button', { name: /Resume queue/ })).toBeDisabled()
    },
  )
  it('rejects malformed adapter replies and preserves the previous caps and liabilities', async () => {
    const port = uiPort()
    const forged = {
      ...uiMessage({ offers: [] }),
      privatePath: 'peer-sentinel',
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID },
    }
    port.request.mockImplementation((request) =>
      Promise.resolve({
        ...forged,
        setup: { viewId: request.viewId, requestId: request.requestId },
      }),
    )
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await screen.findByText(EN.devices.invalidMessage)
    expect(screen.getByText(uiOffer.entries[0]!.model.modelId, { exact: false })).toBeVisible()
  })
  it('reports an unavailable request identity source without an unhandled rejection or host call', async () => {
    const random = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('identity-unavailable')
    })
    const port = uiPort()
    try {
      render(<LiveView port={port} />)
      fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
      await screen.findByText(EN.devices.invalidMessage)
      expect(port.request).not.toHaveBeenCalled()
    } finally {
      random.mockRestore()
    }
  })
  it('validates outgoing board identifiers before invoking the injected host', async () => {
    const port = uiPort()
    render(
      <DevicesView
        message={uiMessage()}
        port={port}
        onState={vi.fn(() => true)}
        explicitSetup
        boards={[{ pairId: UI_PAIR_ID, boardId: 'invalid', canResume: true }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Resume queue/ }))
    await screen.findByText(EN.devices.invalidMessage)
    expect(port.request).not.toHaveBeenCalled()
  })
  it('warns before unlink, cancels with Escape and restores focus to the opener', async () => {
    const port = uiPort()
    render(<LiveView port={port} />)
    const unlink = screen.getByRole('button', { name: EN.devices.unlink })
    fireEvent.click(unlink)
    expect(port.request).not.toHaveBeenCalled()
    expect(screen.getByText(EN.devices.unlinkHelp)).toBeVisible()
    fireEvent.keyDown(screen.getByRole('button', { name: EN.devices.cancel }), { key: 'Escape' })
    expect(screen.queryByText(EN.devices.unlinkHelp)).toBeNull()
    expect(document.activeElement).toBe(unlink)
    fireEvent.click(unlink)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.confirmUnlink }))
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledOnce()
    })
    expect(port.request.mock.calls[0]?.[0].action).toEqual({ kind: 'unlink', pairId: UI_PAIR_ID })
  })
  it('never sends a second local action while a response is pending and rejects mismatched replies', async () => {
    const held = Promise.withResolvers<DeviceHostMessage>()
    const port = { request: vi.fn(() => held.promise) }
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    expect(port.request).toHaveBeenCalledOnce()
    held.resolve({
      ...uiMessage({ offers: [] }),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID },
    })
    await screen.findByText(EN.devices.invalidMessage)
    expect(screen.getByText(uiOffer.entries[0]!.model.modelId, { exact: false })).toBeVisible()
  })
  it('prevents a pending action from being superseded by a submitted pairing form', async () => {
    const held = Promise.withResolvers<DeviceHostMessage>()
    const port = { request: vi.fn(() => held.promise) }
    render(<LiveView port={port} />)
    fireEvent.change(screen.getByLabelText(EN.devices.scan), {
      target: { value: 'public invitation' },
    })
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    fireEvent.submit(
      screen.getByRole('button', { name: EN.devices.importInvitation }).closest('form')!,
    )
    expect(port.request).toHaveBeenCalledOnce()
    held.resolve({ ...uiMessage(), setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID } })
    await screen.findByText(EN.devices.invalidMessage)
  })
  it.each([{ workers: 33 }, { processes: 1.5 }, { spendUsd: 501 }, { artifactBytes: 67_108_865 }])(
    'validates editable caps at the component boundary before sending: %j',
    (change) => {
      const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
      render(
        <DeviceCard device={uiDevice} setup={undefined} boards={[]} busy={false} send={send} />,
      )
      fireEvent.click(screen.getByLabelText(EN.devices.offer))
      for (const [key, value] of Object.entries(change)) {
        const field = offerForm().elements.namedItem(key)
        if (!(field instanceof HTMLInputElement)) throw new Error('missing cap')
        fireEvent.change(field, { target: { value: String(value) } })
      }
      fireEvent.submit(offerForm())
      expect(send).not.toHaveBeenCalled()
      expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    },
  )
  it('validates private addresses at the component boundary before sending', () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
    render(<DeviceCard device={uiDevice} setup={undefined} boards={[]} busy={false} send={send} />)
    fireEvent.change(screen.getByLabelText(EN.devices.address), { target: { value: '8.8.8.8' } })
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    expect(send).not.toHaveBeenCalled()
  })
  it('validates a pasted confirmation before calling the local action boundary', () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
    render(<DevicePairing setup={undefined} busy={false} send={send} />)
    importConfirmationText(JSON.stringify({ ...uiConfirmation, paidConsent: true }))
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
  })
  it('refuses a blank invitation at the component boundary', () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
    render(<DevicePairing setup={undefined} busy={false} send={send} />)
    fireEvent.submit(
      screen.getByRole('button', { name: EN.devices.importInvitation }).closest('form')!,
    )
    expect(send).not.toHaveBeenCalled()
  })
  it('handles malformed pasted JSON as a local error without a request', () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
    render(<DevicePairing setup={undefined} busy={false} send={send} />)
    importConfirmationText('{')
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
  })
  it('passes local discovery and pause choices without a paid or approval grant', async () => {
    const port = uiPort()
    render(<LiveView port={port} />)
    fireEvent.click(screen.getByLabelText(EN.devices.discovery))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: EN.devices.pause })).toBeEnabled(),
    )
    expect(port.request.mock.calls[0]?.[0].action).toEqual({ kind: 'setDiscovery', enabled: true })
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    await waitFor(() => {
      expect(port.request).toHaveBeenCalledTimes(2)
    })
    expect(port.request.mock.calls[1]?.[0].action).toEqual({
      kind: 'pauseOffers',
      pairId: UI_PAIR_ID,
    })
  })
  it('reads the installed language at render and names local prices/budget before consent', () => {
    setUiText({ ...EN, devices: { ...EN.devices, title: 'Installed Devices' } }, 'de')
    render(
      <DevicesView
        message={uiMessage()}
        port={uiPort()}
        onState={vi.fn(() => true)}
        explicitSetup
        paid={{ price: '€0.10', budgetUsd: 5 }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Installed Devices' })).toBeVisible()
    expect(screen.getByText(/Before the first paid use/)).toHaveTextContent('5,00')
  })
  it('renders peer labels and branch/usage as inert text with route attribution', () => {
    const entry = uiOffer.entries[0]!
    const task: DeviceTaskView = {
      taskId: UI_BOARD_ID,
      title: '<img src=x onerror=alert(1)>',
      route: {
        pairId: UI_PAIR_ID,
        deviceId: uiOffer.deviceId,
        receiverIncarnationId: uiOffer.receiverIncarnationId,
        poolId: uiOffer.poolId,
        entryId: entry.entryId,
        model: entry.model,
      },
      branch: 'https://peer.invalid/branch',
      usage: { kind: 'uncertain', amountUsd: 1 },
    }
    const { container } = render(<DeviceTaskDetails input={task} deviceLabel="Peer <script>" />)
    expect(container.querySelector('img,script,a')).toBeNull()
    expect(screen.getByText(task.branch!)).toBeVisible()
    expect(screen.getByText('Uncertain usage: $1.00')).toBeVisible()
    expect(within(screen.getByRole('article')).getByText(uiOffer.poolId)).toBeVisible()
  })
  it('shows tasks only for their exact saved device and pair', () => {
    const entry = uiOffer.entries[0]!
    const task: DeviceTaskView = {
      taskId: UI_BOARD_ID,
      title: 'Bound task',
      route: {
        pairId: UI_PAIR_ID,
        deviceId: uiOffer.deviceId,
        receiverIncarnationId: uiOffer.receiverIncarnationId,
        poolId: uiOffer.poolId,
        entryId: entry.entryId,
        model: entry.model,
      },
      usage: { kind: 'known', amountUsd: 1 },
    }
    const props = {
      message: uiMessage(),
      port: uiPort(),
      onState: vi.fn(() => true),
      explicitSetup: true,
    }
    const { rerender } = render(<DevicesView {...props} tasks={[task]} />)
    expect(screen.getByRole('article', { name: 'Bound task' })).toBeVisible()
    rerender(
      <DevicesView
        {...props}
        tasks={[{ ...task, route: { ...task.route, deviceId: '0'.repeat(32) } }]}
      />,
    )
    expect(screen.queryByRole('article', { name: 'Bound task' })).toBeNull()
    rerender(
      <DevicesView
        {...props}
        tasks={[{ ...task, route: { ...task.route, pairId: '0'.repeat(32) } }]}
      />,
    )
    expect(screen.queryByRole('article', { name: 'Bound task' })).toBeNull()
  })
  it('rejects invalid task boundaries rather than rendering a fake success', () => {
    render(
      <DeviceTaskDetails
        input={{ title: 'Forged', route: { pairId: UI_PAIR_ID } }}
        deviceLabel="Peer"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.invalidMessage)
    expect(screen.queryByText('Forged')).toBeNull()
  })
  it('passes only public invitation text to the optional qualified QR renderer', async () => {
    const qr = vi.fn((text: string) => <output aria-label="Test QR">{text}</output>)
    const port = uiPort({
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
    })
    const onState = vi.fn(() => true)
    render(
      <DevicesView
        message={uiMessage()}
        port={port}
        onState={onState}
        explicitSetup
        renderQr={qr}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    await screen.findByLabelText(EN.devices.copyInvitation)
    expect(qr).toHaveBeenCalledOnce()
    expect(deviceInvitationSchema.parse(JSON.parse(qr.mock.calls[0]?.[0] ?? ''))).toEqual(
      uiInvitation,
    )
  })
})
