// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceCard } from '../../src/webview/models/sections/agents/DeviceCard'
import type { DeviceAction } from '../../src/webview/models/sections/agents/DevicePairing'
import {
  devicesPanelStateSchema,
  type DeviceActionResult,
  type DeviceHostMessage,
  type DevicesPanelState,
} from '../../src/shared/devicesPanel'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

afterEach(() => {
  setUiText(EN, 'en')
})

type DeviceRow = Extract<DevicesPanelState, { enabled: true }>['devices'][number]

function row(): DeviceRow {
  const state = devicesPanelStateSchema.parse({
    enabled: true,
    discoveryEnabled: false,
    devices: [
      {
        deviceId: 'a'.repeat(32),
        pairId: 'b'.repeat(32),
        label: 'Workshop desktop',
        fingerprint: 'c'.repeat(64),
        endpoint: { address: '127.0.0.1', port: 8443 },
        status: 'connected',
        waitingApprovals: 0,
        unresolvedAttempts: 0,
        retainedLiabilityUsd: 0,
        offers: [],
      },
    ],
  })
  if (!state.enabled) throw new Error('missing enabled fixture')
  const first = state.devices[0]
  if (first === undefined) throw new Error('missing row fixture')
  return first
}

function setup(): DeviceHostMessage['setup'] {
  return undefined
}

function renderCard(): { sent: DeviceAction[] } {
  const sent: DeviceAction[] = []
  render(
    <DeviceCard
      device={row()}
      setup={setup()}
      boards={[]}
      busy={false}
      send={(action: DeviceAction): Promise<DeviceActionResult> => {
        sent.push(action)
        return Promise.resolve({ ok: false, reason: 'stale' })
      }}
    />,
  )
  return { sent }
}

function offerForm(): HTMLFormElement {
  const save = screen.getByRole('button', { name: 'Review and save local offer' })
  const form = save.closest('form')
  if (form === null) throw new Error('missing offer form')
  return form
}

describe('M100 offer editor', () => {
  it('renders cap inputs with no maximum of ours', () => {
    renderCard()
    const form = offerForm()
    const inputs = [...form.querySelectorAll('input[type="number"]')]
    expect(inputs).toHaveLength(6)
    for (const input of inputs) expect(input).not.toHaveAttribute('max')
  })

  it('sends the person’s huge caps exactly as typed', () => {
    const { sent } = renderCard()
    const values: Record<string, string> = {
      'Worker limit': '1000000',
      'Process limit': '1000000',
      'Heavy-check slots': '1000000',
      'Token limit': '2000000',
      'Spend limit': '999999.99',
      'Result size limit': '100000000',
    }
    for (const [label, value] of Object.entries(values))
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    fireEvent.click(screen.getByLabelText('Offer lanes'))
    fireEvent.submit(offerForm())
    expect(sent).toEqual([
      {
        kind: 'offer',
        pairId: 'b'.repeat(32),
        lanes: true,
        checks: false,
        caps: {
          workers: 1_000_000,
          processes: 1_000_000,
          heavyChecks: 1_000_000,
          tokens: 2_000_000,
          spendUsd: '999999.99',
          artifactBytes: 100_000_000,
        },
      },
    ])
  })

  it('refuses an offer with neither lanes nor checks and sends nothing', () => {
    const { sent } = renderCard()
    fireEvent.submit(offerForm())
    expect(screen.getByRole('alert')).toBeVisible()
    expect(sent).toEqual([])
  })
})
