// RLF-DEVICES: the ACP path. The editor's permission prompt carries the
// same exact payload the panel shows: the options offer this payload
// only or reject, anything else the wire says is reject, and the
// executor sends through the session's asker with nothing widened.
import { describe, expect, it } from 'vitest'
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk'
import {
  AcpMakerSurface,
  makerPermissionAnswer,
  makerPermissionDetail,
  makerPermissionOptions,
  makerPermissionTitle,
} from '../../src/acp/maker'
import { permissionResponse } from '../../src/acp/translate'
import { MakerApprovals } from '../../src/core/maker/approval'
import { analyzeMakerPayload } from '../../src/core/maker/analysis'
import { PrinterExecutor } from '../../src/core/maker/executors'
import { PrinterSimulator, printerSimRecord } from '../../src/core/maker/simulators'
import { MAKER_PERMISSION_OPTIONS, UI_TEXT } from '../../src/shared/constants'
import { makerApprovalPromptSchema, type MakerApprovalPrompt } from '../../src/shared/maker'
import { collectingLogger } from './helpers/collectingLogger'

function selected(optionId: string): RequestPermissionResponse {
  return permissionResponse({ outcome: { outcome: 'selected', optionId } })
}

function mintActuatePrompt(): MakerApprovalPrompt {
  const sim = new PrinterSimulator(printerSimRecord())
  const position = sim.readState().position
  if (position === undefined) throw new Error('sim reports no position')
  const payload = new TextEncoder().encode('G1 X10 Y10 F1500\nM104 S210\n')
  const analysed = analyzeMakerPayload('printer', payload, position)
  if (!analysed.ok) throw new Error(`test payload refused: ${analysed.command}`)
  const pending = new MakerApprovals().mint({
    target: sim.target,
    operation: 'actuate',
    payload,
    analysis: analysed.analysis,
    stateAtMint: sim.readState().fingerprint,
  })
  return makerApprovalPromptSchema.parse(pending.prompt)
}

describe('maker permission prompt', () => {
  it('offers this payload once or reject', () => {
    expect(makerPermissionOptions()).toEqual([
      {
        optionId: MAKER_PERMISSION_OPTIONS.allowOnce,
        name: UI_TEXT.devices.makerSendOnce,
        kind: 'allow_once',
      },
      {
        optionId: MAKER_PERMISSION_OPTIONS.deny,
        name: UI_TEXT.devices.makerReject,
        kind: 'reject_once',
      },
    ])
  })

  it('answers send only to the offered allow option', () => {
    expect(makerPermissionAnswer(selected(MAKER_PERMISSION_OPTIONS.allowOnce))).toBe('send')
    expect(makerPermissionAnswer(selected(MAKER_PERMISSION_OPTIONS.deny))).toBe('reject')
    expect(makerPermissionAnswer(selected('paid-allow-once'))).toBe('reject')
    expect(makerPermissionAnswer(permissionResponse({ outcome: { outcome: 'cancelled' } }))).toBe(
      'reject',
    )
    expect(makerPermissionAnswer(permissionResponse({}))).toBe('reject')
    expect(makerPermissionAnswer(permissionResponse(null))).toBe('reject')
  })

  it('names the operation on the machine', () => {
    const prompt = mintActuatePrompt()
    expect(makerPermissionTitle(prompt)).toBe(
      `${UI_TEXT.devices.makerOperationActuate} · ${prompt.target.name}`,
    )
  })

  it('carries the target, the analysis and the exact payload lines', () => {
    const prompt = mintActuatePrompt()
    const detail = makerPermissionDetail(prompt)
    expect(detail).toContain(prompt.target.name)
    expect(detail).toContain(prompt.target.endpoint)
    expect(detail).toContain(UI_TEXT.devices.makerOperationActuate)
    expect(detail).toContain('G1 X10 Y10 F1500')
    expect(detail).toContain('M104 S210')
    expect(detail).toContain(prompt.digest)
    expect(detail).toContain('X 0–10')
    expect(detail).toContain('210')
    expect(detail).toContain('1,500')
  })
})

describe('ACP maker surface', () => {
  it('refuses without an attached session asker', async () => {
    const messages: string[] = []
    const surface = new AcpMakerSurface({ log: collectingLogger(messages) })
    const answer = await surface.askerFor('gone')(mintActuatePrompt(), new AbortController().signal)
    expect(answer).toBeNull()
    expect(messages).toHaveLength(1)
  })

  it('refuses when the editor cannot be asked', async () => {
    const messages: string[] = []
    const surface = new AcpMakerSurface({ log: collectingLogger(messages) })
    surface.attach(() => Promise.reject(new Error('editor gone')))
    const answer = await surface.askerFor('s1')(mintActuatePrompt(), new AbortController().signal)
    expect(answer).toBeNull()
    expect(messages).toHaveLength(1)
  })

  it('sends through the session asker after the editor allows once', async () => {
    const messages: string[] = []
    const surface = new AcpMakerSurface({ log: collectingLogger(messages) })
    const asked: MakerApprovalPrompt[] = []
    surface.attach((sessionId, prompt) => {
      asked.push(prompt)
      if (sessionId !== 's1') return Promise.resolve(null)
      return Promise.resolve({
        requestId: prompt.requestId,
        decision: 'send',
        digest: prompt.digest,
      })
    })
    const approvals = new MakerApprovals()
    const executor = new PrinterExecutor({ approvals })
    const sim = new PrinterSimulator(printerSimRecord())
    const signal = new AbortController().signal
    // A session the asker does not hold refuses without asking the engine.
    const foreign = await surface.askerFor('s2')(mintActuatePrompt(), signal)
    expect(foreign).toBeNull()
    const connectFlight = executor.connect(sim, surface.askerFor('s1'), {}, signal)
    const connected = await connectFlight
    expect(connected.ok).toBe(true)
    expect(asked).toHaveLength(2)
    const homeFlight = executor.send(
      sim,
      surface.askerFor('s1'),
      new TextEncoder().encode('G28\n'),
      {},
      signal,
    )
    const homed = await homeFlight
    expect(homed.ok).toBe(true)
    const payload = new TextEncoder().encode('G1 X10 Y10\n')
    const sendFlight = executor.send(sim, surface.askerFor('s1'), payload, {}, signal)
    const result = await sendFlight
    expect(result.ok).toBe(true)
    expect(sim.readState().position).toMatchObject({ x: 10, y: 10 })
    // The editor saw the exact bytes before they moved the machine.
    expect(asked).toHaveLength(4)
    const last = asked.at(-1)
    if (last === undefined) throw new Error('send asked nothing')
    const detail = makerPermissionDetail(last)
    expect(detail).toContain('G1 X10 Y10')
    expect(detail).toContain(last.digest)
    expect(messages).toHaveLength(0)
  })

  it('sends nothing when the editor denies', async () => {
    const surface = new AcpMakerSurface({ log: collectingLogger([]) })
    surface.attach(() => Promise.resolve(null))
    const executor = new PrinterExecutor({ approvals: new MakerApprovals() })
    const sim = new PrinterSimulator(printerSimRecord())
    const signal = new AbortController().signal
    const before = sim.readState().fingerprint
    const result = await executor.connect(sim, surface.askerFor('s1'), {}, signal)
    expect(result).toMatchObject({ ok: false, reason: 'approval-rejected' })
    expect(sim.readState().fingerprint).toBe(before)
  })
})
