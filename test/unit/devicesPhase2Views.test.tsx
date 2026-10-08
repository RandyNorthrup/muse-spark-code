// @vitest-environment jsdom
// M100 phase 2 lane U: owning UI tests for the phase-2 Devices views
// (qr, discovery, grants, prompts, power, setup) against fakes.
import type { ReactNode } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { formatNumber, setUiText } from '../../src/shared/l10n/text'
import { deviceInvitationSchema } from '../../src/shared/devices'
import type { DeviceCapability, DeviceGrant, DeviceThrottled } from '../../src/shared/devices'
import { parseDeviceHostMessage, parseDeviceWebviewRequest } from '../../src/shared/devicesPanel'
import { DevicesView } from '../../src/webview/models/sections/agents/DevicesView'
import { DeviceCard } from '../../src/webview/models/sections/agents/DeviceCard'
import QrFigure from '../../src/webview/models/sections/devices/qr/QrFigure'
import {
  fakeQrInviteText,
  parsePublicInviteText,
} from '../../src/webview/models/sections/devices/qr/inviteText'
import {
  isQrModuleMatrix,
  type QrModuleMatrix,
} from '../../src/webview/models/sections/devices/qr/encoder'
import { DiscoveryDetails } from '../../src/webview/models/sections/devices/discovery/DiscoveryDetails'
import {
  OwnerGrants,
  grantRefusalText,
} from '../../src/webview/models/sections/devices/grants/OwnerGrants'
import { ActionPrompts } from '../../src/webview/models/sections/devices/prompts/ActionPrompts'
import { PowerView } from '../../src/webview/models/sections/devices/power/PowerView'
import { BlockedSetup } from '../../src/webview/models/sections/devices/setup/BlockedSetup'
import { UI_PAIR_ID, uiDevice, uiInvitation, uiMessage, uiPort } from './helpers/deviceUiFakes'

afterEach(() => {
  setUiText(EN, 'en')
  vi.useRealTimers()
})

const OWNER_A = 'a'.repeat(32)
const OWNER_B = 'b'.repeat(32)

function uiGrant(change: Partial<DeviceGrant> = {}): DeviceGrant {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    grantId: 'c'.repeat(32),
    grantRevision: 1,
    pairId: UI_PAIR_ID,
    ownerId: OWNER_A,
    roleId: 'd'.repeat(32),
    mode: 'manual',
    repositoryId: 'e'.repeat(32),
    lanes: true,
    checks: false,
    quota: {
      workers: 1,
      processes: 2,
      heavyChecks: 1,
      tokens: 1000,
      spendUsd: 1,
      artifactBytes: 1024,
    },
    issuedAt: 1000,
    expiresAt: 2000,
    requiresStepUp: false,
    ...change,
  }
}

function uiCapability(change: Partial<DeviceCapability> = {}): DeviceCapability {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    deviceId: uiDevice.deviceId,
    receiverIncarnationId: '9'.repeat(32),
    observedAt: 1000,
    platform: 'darwin',
    osVersion: '26.0',
    tools: ['read'],
    engines: [],
    presence: { touchId: true, windowsHello: false, tpm: false, secureEnclave: true },
    power: 'battery',
    sleepInhibited: true,
    slotCap: 2,
    pressure: { cpuPercent: 42, memoryPercent: 61, diskPercent: 73, transportResets: 3 },
    ...change,
  }
}

function uiThrottled(change: Partial<DeviceThrottled> = {}): DeviceThrottled {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    pairId: UI_PAIR_ID,
    unknownSince: 1000,
    reason: 'pressure',
    ...change,
  }
}

// A fixed 21x21 version-1 matrix: three dark modules, everything else light.
function fixedMatrix(): QrModuleMatrix {
  const modules = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => false))
  modules[4]![4] = true
  modules[10]![12] = true
  modules[16]![16] = true
  return { size: 21, modules }
}

async function pairThroughView(renderQr?: (text: string) => ReactNode) {
  const port = uiPort({
    ...uiMessage(),
    setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, invitation: uiInvitation },
  })
  render(
    <DevicesView
      message={uiMessage()}
      port={port}
      onState={vi.fn(() => true)}
      explicitSetup
      renderQr={renderQr}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
  return await screen.findByLabelText(EN.devices.copyInvitation)
}

describe('M100P2U QR and text fallback', () => {
  it('feeds the encoder the public invite text byte for byte', () => {
    const text = fakeQrInviteText(uiInvitation)
    expect(text).toBe(JSON.stringify(uiInvitation))
    const seen: string[] = []
    const figure = (
      <QrFigure
        text={text}
        encode={(input) => {
          seen.push(input)
          return fixedMatrix()
        }}
      />
    )
    render(figure)
    expect(seen).toEqual([text])
    expect(parsePublicInviteText(text)).toEqual(uiInvitation)
  })

  it('never lets private-key material parse as a public invite', () => {
    const planted = { ...uiInvitation, privateKey: 'deadbeef' }
    expect(deviceInvitationSchema.safeParse(planted).success).toBe(false)
    expect(parsePublicInviteText(JSON.stringify(planted))).toBeUndefined()
    expect(parsePublicInviteText('{')).toBeUndefined()
    expect(JSON.stringify(uiInvitation)).not.toContain('privateKey')
  })

  it('renders dark modules on a light field with a four-module quiet zone', () => {
    const quiet = DEVICE_LIMITS.qrQuietZoneModules
    expect(quiet).toBe(4)
    const { container } = render(<QrFigure text="public" encode={() => fixedMatrix()} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe(EN.devices.qrCodeName)
    const cells = 21 + quiet * 2
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${String(cells)} ${String(cells)}`)
    const rects = [...svg.querySelectorAll('rect')]
    // One light field plus three dark modules.
    expect(rects).toHaveLength(4)
    expect(rects[0]!.getAttribute('fill')).toBe('#ffffff')
    expect(svg.getAttribute('fill')).toBe('#000000')
    for (const rect of rects.slice(1)) {
      expect(Number(rect.getAttribute('x'))).toBeGreaterThanOrEqual(quiet)
      expect(Number(rect.getAttribute('y'))).toBeGreaterThanOrEqual(quiet)
    }
  })

  it('renders nothing without an encoder, a throwing encoder or a non-matrix', () => {
    expect(QrFigure({ text: 'public', encode: undefined })).toBeNull()
    const throwing = render(
      <QrFigure
        text="public"
        encode={() => {
          throw new Error('no-encoder')
        }}
      />,
    )
    expect(throwing.container.querySelector('svg')).toBeNull()
    const invalid = render(
      <QrFigure text="public" encode={() => ({ size: 5, modules: [[true]] })} />,
    )
    expect(invalid.container.querySelector('svg')).toBeNull()
    expect(isQrModuleMatrix({ size: 5, modules: [[true]] })).toBe(false)
    expect(isQrModuleMatrix(fixedMatrix())).toBe(true)
  })

  it('keeps the selectable text and copy control beside the QR, keyboard-reachable', async () => {
    const field = await pairThroughView((text) => (
      <QrFigure text={text} encode={() => fixedMatrix()} />
    ))
    expect(field.tagName).toBe('TEXTAREA')
    expect(field.hasAttribute('hidden')).toBe(false)
    const copy = screen.getByRole('button', { name: EN.devices.copyInvitation })
    copy.focus()
    expect(document.activeElement).toBe(copy)
    field.focus()
    expect(document.activeElement).toBe(field)
    expect(screen.getByRole('img', { name: EN.devices.qrCodeName })).not.toBeNull()
  })

  it('keeps the text fallback complete with no QR renderer at all', async () => {
    const field = await pairThroughView()
    expect(JSON.parse((field as HTMLTextAreaElement).value)).toEqual(uiInvitation)
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('M100P2U discovery switch', () => {
  it('is off by default and renders with zero discovery traffic', () => {
    expect(DEVICE_LIMITS.discoveryDefault).toBe(false)
    const port = uiPort()
    render(
      <DevicesView message={uiMessage()} port={port} onState={vi.fn(() => true)} explicitSetup />,
    )
    expect(screen.getByLabelText(EN.devices.discovery)).not.toBeChecked()
    expect(port.request).not.toHaveBeenCalled()
  })

  it('names the exact advertisement and that discovery grants no trust', () => {
    render(<DiscoveryDetails serviceId="_musespark._tcp" port={32_123} />)
    const line = screen.getByText(/Discovery advertises/)
    expect(line).toHaveTextContent('_musespark._tcp')
    expect(line).toHaveTextContent(formatNumber(32_123))
    expect(line).toHaveTextContent(String(DEVICE_LIMITS.protocolVersion))
    expect(line).toHaveTextContent('grants no trust')
  })
})

describe('M100P2U owners and grants', () => {
  it('shows role, mode, repository, lanes/checks, quota and expiry with a revoke action', () => {
    const onRevoke = vi.fn()
    const grants = [
      uiGrant(),
      uiGrant({
        grantId: 'f'.repeat(32),
        roleId: '0'.repeat(32),
        repositoryId: '1'.repeat(32),
        mode: 'acceptEdits',
        lanes: true,
        checks: true,
      }),
    ]
    render(
      <OwnerGrants
        owners={[{ ownerId: OWNER_A, grants }]}
        busy={false}
        refusal={undefined}
        onRevoke={onRevoke}
      />,
    )
    expect(screen.getByText(EN.devices.owners)).not.toBeNull()
    expect(screen.getByText(OWNER_A)).not.toBeNull()
    expect(screen.getByText('d'.repeat(32))).not.toBeNull()
    expect(screen.getByText(/Manual/)).not.toBeNull()
    expect(screen.getByText(/Edit automatically/)).not.toBeNull()
    expect(screen.getByText('e'.repeat(32))).not.toBeNull()
    const revokes = screen.getAllByRole('button', { name: EN.devices.revokeGrant })
    expect(revokes).toHaveLength(2)
    fireEvent.click(revokes[1]!)
    expect(onRevoke).toHaveBeenCalledExactlyOnceWith(OWNER_A, 'f'.repeat(32))
  })

  it('refuses more than four owners or sixteen grants before display', () => {
    const owners = Array.from({ length: 5 }, (_, index) => ({
      ownerId: String(index).repeat(32).slice(0, 32),
      grants: [uiGrant()],
    }))
    const message = {
      ...uiMessage(),
      setup: { viewId: UI_PAIR_ID, requestId: UI_PAIR_ID, owners },
    }
    expect(parseDeviceHostMessage(message).ok).toBe(false)
    const wide = {
      ...uiMessage(),
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        owners: [
          {
            ownerId: OWNER_A,
            grants: Array.from({ length: 17 }, (_, index) =>
              uiGrant({ grantId: String(index % 10).repeat(32) }),
            ),
          },
        ],
      },
    }
    expect(parseDeviceHostMessage(wide).ok).toBe(false)
    const exact = {
      ...uiMessage(),
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        owners: [{ ownerId: OWNER_A, grants: [uiGrant()] }],
      },
    }
    expect(parseDeviceHostMessage(exact).ok).toBe(true)
  })

  it('maps grant-expired and owner-mismatch to their states', () => {
    expect(grantRefusalText('grant-expired')).toBe(EN.devices.grantExpired)
    expect(grantRefusalText('owner-mismatch')).toBe(EN.devices.ownerMismatch)
    expect(grantRefusalText('grant-revoked')).toBe(EN.devices.revokedHelp)
    expect(grantRefusalText('scope-denied')).toBe(EN.devices.grantHelp)
    render(
      <OwnerGrants
        owners={[{ ownerId: OWNER_A, grants: [uiGrant()] }]}
        busy={false}
        refusal={{
          version: DEVICE_LIMITS.protocolVersion,
          pairId: UI_PAIR_ID,
          ownerId: OWNER_A,
          reason: 'grant-expired',
          retryable: false,
        }}
        onRevoke={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(EN.devices.grantExpired)
  })

  it('sends one revokeGrant message kind for a revoke', async () => {
    const port = uiPort({
      ...uiMessage(),
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        owners: [
          { ownerId: OWNER_A, grants: [uiGrant()] },
          { ownerId: OWNER_B, grants: [uiGrant({ ownerId: OWNER_B })] },
        ],
      },
    })
    render(
      <DevicesView message={uiMessage()} port={port} onState={vi.fn(() => true)} explicitSetup />,
    )
    expect(screen.queryByRole('button', { name: EN.devices.revokeGrant })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    const revokes = await screen.findAllByRole('button', { name: EN.devices.revokeGrant })
    fireEvent.click(revokes[0]!)
    await vi.waitFor(() => {
      expect(port.request).toHaveBeenCalledTimes(2)
    })
    expect(port.request.mock.calls[1]?.[0].action).toEqual({
      kind: 'revokeGrant',
      pairId: UI_PAIR_ID,
      ownerId: OWNER_A,
      grantId: 'c'.repeat(32),
    })
  })

  it('rejects a revokeGrant request missing its grant', () => {
    const request = {
      type: 'deviceRequest',
      viewId: UI_PAIR_ID,
      requestId: UI_PAIR_ID,
      revision: 1,
      action: { kind: 'revokeGrant', pairId: UI_PAIR_ID, ownerId: OWNER_A },
    }
    expect(parseDeviceWebviewRequest(request).ok).toBe(false)
  })
})

describe('M100P2U phase-2 mounts', () => {
  it('renders discovery, power and step-up sections from setup facts', () => {
    const { unmount } = render(
      <DevicesView
        message={{
          ...uiMessage(),
          setup: {
            viewId: UI_PAIR_ID,
            requestId: UI_PAIR_ID,
            discovery: { serviceId: '_musespark._tcp', port: 32_123 },
          },
        }}
        port={uiPort()}
        onState={vi.fn(() => true)}
        explicitSetup
      />,
    )
    expect(screen.getByText(/Discovery advertises/)).not.toBeNull()
    unmount()
    render(
      <DevicesView
        message={{
          ...uiMessage(),
          setup: {
            viewId: UI_PAIR_ID,
            requestId: UI_PAIR_ID,
            capability: uiCapability(),
            throttled: uiThrottled(),
          },
        }}
        port={uiPort()}
        onState={vi.fn(() => true)}
        explicitSetup
      />,
    )
    expect(screen.getByText(`${EN.devices.power}: ${EN.devices.powerBattery}`)).not.toBeNull()
    const statuses = screen.getAllByRole('status').map((line) => line.textContent)
    expect(statuses).toContain(EN.devices.throttled)
  })

  it('renders the step-up prompt for the named device once an action binds it', async () => {
    const port = uiPort({
      ...uiMessage(),
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        stepUp: { grantId: 'c'.repeat(32) },
      },
    })
    render(
      <DevicesView message={uiMessage()} port={port} onState={vi.fn(() => true)} explicitSetup />,
    )
    expect(screen.queryByText(`Waiting for step-up approval on ${uiDevice.label}.`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pause }))
    expect(
      await screen.findByText(`Waiting for step-up approval on ${uiDevice.label}.`),
    ).not.toBeNull()
  })
})

describe('M100P2U per-action prompts', () => {
  it('names the waiting device and offers no presence answer', () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, reason: 'failed' } as const))
    const card = render(
      <DeviceCard
        device={{ ...uiDevice, waitingApprovals: 2 }}
        setup={undefined}
        boards={[]}
        busy={false}
        send={send}
      />,
    )
    expect(
      within(card.container).getByText(`Waiting for approval on ${uiDevice.label}`),
    ).not.toBeNull()
    card.unmount()
    const prompts = render(<ActionPrompts deviceLabel={uiDevice.label} />)
    expect(
      within(prompts.container).getByText(`Waiting for step-up approval on ${uiDevice.label}.`),
    ).not.toBeNull()
    expect(within(prompts.container).getByText(EN.devices.localApprovalHelp)).not.toBeNull()
    expect(within(prompts.container).queryByRole('button')).toBeNull()
  })
})

describe('M100P2U power and pressure', () => {
  it('shows power, sleep inhibition, pressure and resets from the advertisement', () => {
    render(<PowerView capability={uiCapability()} throttled={undefined} />)
    expect(screen.getByText(`${EN.devices.power}: ${EN.devices.powerBattery}`)).not.toBeNull()
    expect(screen.getByText(EN.devices.sleepInhibited)).not.toBeNull()
    expect(screen.getByText(EN.devices.cpuPressure).parentElement).not.toBeNull()
    expect(screen.getByText(EN.devices.transportResets)).not.toBeNull()
  })

  it('reads throttled with help and unknown time, never offline or down', () => {
    render(<PowerView capability={undefined} throttled={uiThrottled()} />)
    expect(screen.getByRole('status')).toHaveTextContent(EN.devices.throttled)
    expect(screen.getByText(EN.devices.throttledHelp)).not.toBeNull()
    expect(screen.getByText(/Unknown since/)).not.toBeNull()
    expect(screen.queryByText(EN.devices.offline)).toBeNull()
    expect(document.body.textContent).not.toContain('down')
  })

  it('reads ac and unknown power states', () => {
    const { rerender } = render(
      <PowerView capability={uiCapability({ power: 'ac' })} throttled={undefined} />,
    )
    expect(screen.getByText(`${EN.devices.power}: ${EN.devices.powerAc}`)).not.toBeNull()
    rerender(<PowerView capability={uiCapability({ power: 'unknown' })} throttled={undefined} />)
    expect(screen.getByText(`${EN.devices.power}: ${EN.devices.powerUnknown}`)).not.toBeNull()
  })
})

describe('M100P2U blocked setup', () => {
  it('fills recovery with host facts and keeps attempts and liability visible', async () => {
    const blocked = uiMessage({
      status: 'blocked-or-unreachable',
      unresolvedAttempts: 3,
      retainedLiabilityUsd: 2.5,
    })
    const port = uiPort({
      ...blocked,
      setup: {
        viewId: UI_PAIR_ID,
        requestId: UI_PAIR_ID,
        listenerApplication: 'Editor host',
        interfaceLabel: 'LAN en0',
      },
    })
    render(<DevicesView message={blocked} port={port} onState={vi.fn(() => true)} explicitSetup />)
    // An unbound setup supplies no facts: summary and recovery name Unknown
    // while attempts and liability stay visible.
    expect(screen.getByText(/receiver offer, route and OS firewall permission/)).toHaveTextContent(
      EN.devices.unknown,
    )
    expect(screen.getByText(/Nothing here changes the firewall/)).toHaveTextContent(
      EN.devices.unknown,
    )
    expect(screen.getByText(/3 unresolved attempts/)).not.toBeNull()
    expect(screen.getByText(/Retained spending liability/)).not.toBeNull()
    // Saving the address binds the reply's setup: summary and recovery fill
    // with the host facts, and attempts and liability stay shown.
    fireEvent.submit(screen.getByRole('button', { name: EN.devices.retryAddress }).closest('form')!)
    const summary = await screen.findByText(/receiver offer, route and OS firewall permission/)
    expect(summary).toHaveTextContent('Editor host')
    expect(summary).toHaveTextContent('LAN en0')
    expect(summary).toHaveTextContent('10.2.3.4')
    const recovery = screen.getByText(/Nothing here changes the firewall/)
    expect(recovery).toHaveTextContent('Editor host')
    expect(recovery).toHaveTextContent('LAN en0')
    expect(recovery).toHaveTextContent('10.2.3.4')
    expect(recovery.textContent).not.toContain('prompt-free')
    expect(screen.getByText(/3 unresolved attempts/)).not.toBeNull()
    expect(screen.getByText(/Retained spending liability/)).not.toBeNull()
  })

  it('renders the recovery block with explicit facts', () => {
    render(
      <BlockedSetup
        application="Editor host"
        interfaceLabel="LAN en0"
        address="10.2.3.4"
        port={32_123}
      />,
    )
    expect(screen.getByText(/ask an administrator for scoped access/)).toHaveTextContent(
      `10.2.3.4:${formatNumber(32_123)}`,
    )
  })
})
