// @vitest-environment jsdom
// RLF-DEVICES: the exact-payload dialog shows the minted prompt byte for
// byte and posts the person's echoed answer. Send once echoes the id and
// digest; Reject, the close button and Escape all answer reject; while
// the answer is in flight both buttons stay disabled.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MakerApprovals } from '../../src/core/maker/approval'
import { analyzeMakerPayload } from '../../src/core/maker/analysis'
import { PrinterSimulator, printerSimRecord } from '../../src/core/maker/simulators'
import { makerAnalysisSchema, type MakerApprovalPrompt } from '../../src/shared/maker'
import { type DeviceActionResult } from '../../src/shared/devicesPanel'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { MakerApprovalDialog } from '../../src/webview/models/sections/devices/maker/MakerApprovalDialog'
import type { DeviceAction } from '../../src/webview/models/sections/agents/DevicePairing'

beforeEach(() => {
  setUiText(EN, 'en')
})
afterEach(() => {
  setUiText(EN, 'en')
})

function simTarget() {
  return new PrinterSimulator(printerSimRecord()).target
}

function actuatePrompt(): MakerApprovalPrompt {
  const sim = new PrinterSimulator(printerSimRecord())
  const position = sim.readState().position
  if (position === undefined) throw new Error('sim reports no position')
  const payload = new TextEncoder().encode('G1 X10 Y10 F1500\nM104 S210\n')
  const analysed = analyzeMakerPayload('printer', payload, position)
  if (!analysed.ok) throw new Error(`test payload refused: ${analysed.command}`)
  return new MakerApprovals().mint({
    target: sim.target,
    operation: 'actuate',
    payload,
    analysis: analysed.analysis,
    stateAtMint: sim.readState().fingerprint,
  }).prompt
}

function connectPrompt(): MakerApprovalPrompt {
  const sim = new PrinterSimulator(printerSimRecord())
  return new MakerApprovals().mint({
    target: sim.target,
    operation: 'connect',
    payload: new Uint8Array(),
    stateAtMint: sim.readState().fingerprint,
  }).prompt
}

function renderDialog(prompt: MakerApprovalPrompt, sent: DeviceAction[], isBusy = false) {
  const send = (action: DeviceAction): Promise<DeviceActionResult> => {
    sent.push(action)
    return Promise.resolve({ ok: false, reason: 'stale' })
  }
  render(<MakerApprovalDialog prompt={prompt} busy={isBusy} send={send} />)
}

describe('maker approval dialog', () => {
  it('sends the echoed answer for the exact payload shown', () => {
    const sent: DeviceAction[] = []
    const prompt = actuatePrompt()
    renderDialog(prompt, sent)
    expect(screen.getByRole('dialog', { name: EN.devices.makerApprovalTitle })).toBeDefined()
    // The person sees every byte and the digest before choosing.
    expect(screen.getByText(/G1 X10 Y10 F1500/)).toBeDefined()
    expect(screen.getByText(/M104 S210/)).toBeDefined()
    expect(screen.getByText(prompt.digest)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.makerSendOnce }))
    expect(sent).toEqual([
      {
        kind: 'answerMakerApproval',
        requestId: prompt.requestId,
        decision: 'send',
        digest: prompt.digest,
      } satisfies DeviceAction,
    ])
  })

  it('answers reject on Reject and Escape', () => {
    for (const close of ['button', 'escape'] as const) {
      const sent: DeviceAction[] = []
      const prompt = actuatePrompt()
      const send = (action: DeviceAction): Promise<DeviceActionResult> => {
        sent.push(action)
        return Promise.resolve({ ok: false, reason: 'stale' })
      }
      const { unmount } = render(<MakerApprovalDialog prompt={prompt} busy={false} send={send} />)
      if (close === 'button') {
        fireEvent.click(screen.getByRole('button', { name: EN.devices.makerReject }))
      } else {
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      }
      expect(sent).toEqual([
        {
          kind: 'answerMakerApproval',
          requestId: prompt.requestId,
          decision: 'reject',
          digest: prompt.digest,
        } satisfies DeviceAction,
      ])
      unmount()
    }
  })

  it('answers reject from the modal close button', () => {
    const sent: DeviceAction[] = []
    const prompt = actuatePrompt()
    renderDialog(prompt, sent)
    fireEvent.click(screen.getByRole('button', { name: EN.usageClose }))
    expect(sent).toEqual([
      {
        kind: 'answerMakerApproval',
        requestId: prompt.requestId,
        decision: 'reject',
        digest: prompt.digest,
      } satisfies DeviceAction,
    ])
  })

  it('sends nothing while the answer is in flight', () => {
    const sent: DeviceAction[] = []
    renderDialog(actuatePrompt(), sent, true)
    const send = screen.getByRole('button', { name: EN.devices.makerSendOnce })
    const reject = screen.getByRole('button', { name: EN.devices.makerReject })
    if (!(send instanceof HTMLButtonElement) || !(reject instanceof HTMLButtonElement))
      throw new TypeError('missing decision buttons')
    expect(send.disabled).toBe(true)
    expect(reject.disabled).toBe(true)
    fireEvent.click(send)
    fireEvent.click(reject)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(sent).toEqual([])
  })

  it('renders the analysis rows and unknown commands', () => {
    const sent: DeviceAction[] = []
    const analysis = makerAnalysisSchema.parse({
      bounds: { min: { x: 0, y: 0 }, max: { x: 10, y: 10, z: 0 } },
      maxTempC: 210,
      maxFeedMmMin: 1500,
      unknownCommands: ['M999'],
    })
    const prompt: MakerApprovalPrompt = {
      ...actuatePrompt(),
      analysis,
      warning: 'portReset',
    }
    renderDialog(prompt, sent)
    expect(screen.getByText(EN.devices.makerWarningPortReset)).toBeDefined()
    expect(screen.getAllByText(/210/)).toHaveLength(2)
    expect(screen.getByText(/°C/)).toBeDefined()
    expect(screen.getByText(/1,500/)).toBeDefined()
    expect(screen.getByText(/X 0–10/)).toBeDefined()
    expect(screen.getByText('M999')).toBeDefined()
  })

  it('shows the empty note for a payload-less prompt', () => {
    const sent: DeviceAction[] = []
    const prompt = connectPrompt()
    renderDialog(prompt, sent)
    expect(screen.getByText(EN.devices.makerPayloadEmpty)).toBeDefined()
    expect(screen.queryByText(EN.devices.makerAnalysis)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.makerSendOnce }))
    expect(sent).toHaveLength(1)
  })

  it('names the simulator target', () => {
    const sent: DeviceAction[] = []
    renderDialog(actuatePrompt(), sent)
    expect(screen.getByText(EN.devices.makerSimulator)).toBeDefined()
    expect(screen.getByText(EN.devices.makerSimNote)).toBeDefined()
    expect(simTarget().simulated).toBe(true)
  })
})
