// RLF-DEVICES: each executor proven end to end against its simulator
// through the real approval path. An approved payload arrives byte for
// byte (the simulator's receipt digest matches); a refused payload
// sends nothing. Policy refuses without asking; the gesture is asked
// once per send; stop never asks.
import { describe, expect, it } from 'vitest'
import type { MakerApprovalAnswer, MakerApprovalPrompt } from '../../src/shared/maker'
import {
  MakerApprovals,
  makerPayloadDigest,
  type MakerApprovalAsker,
} from '../../src/core/maker/approval'
import {
  CncExecutor,
  McuExecutor,
  PrinterExecutor,
  type MakerExecuteResult,
  type MakerMachineConnection,
  type MakerSendOptions,
} from '../../src/core/maker/executors'
import {
  CncSimulator,
  McuSimulator,
  PrinterSimulator,
  cncSimRecord,
  mcuSimRecord,
  printerSimRecord,
} from '../../src/core/maker/simulators'

const approvals = new MakerApprovals()

function answer(prompt: MakerApprovalPrompt, decision: 'send' | 'reject'): MakerApprovalAnswer {
  return { requestId: prompt.requestId, decision, digest: prompt.digest }
}

function approver(seen: MakerApprovalPrompt[]): MakerApprovalAsker {
  return (prompt) => {
    seen.push(prompt)
    return Promise.resolve(answer(prompt, 'send'))
  }
}

function rejecter(seen: MakerApprovalPrompt[]): MakerApprovalAsker {
  return (prompt) => {
    seen.push(prompt)
    return Promise.resolve(answer(prompt, 'reject'))
  }
}

const signal = new AbortController().signal
const noExpiry = {}

function sendReceipts(connection: MakerMachineConnection) {
  return connection.receipts().filter((receipt) => receipt.kind === 'send')
}

function printerHarness(record?: Parameters<typeof printerSimRecord>[0]): {
  sim: PrinterSimulator
  executor: PrinterExecutor
} {
  return {
    sim: new PrinterSimulator(printerSimRecord(record)),
    executor: new PrinterExecutor({ approvals }),
  }
}

function cncHarness(record?: Parameters<typeof cncSimRecord>[0]): {
  sim: CncSimulator
  executor: CncExecutor
} {
  return { sim: new CncSimulator(cncSimRecord(record)), executor: new CncExecutor({ approvals }) }
}

function mcuHarness(record?: Parameters<typeof mcuSimRecord>[0]): {
  sim: McuSimulator
  executor: McuExecutor
} {
  return { sim: new McuSimulator(mcuSimRecord(record)), executor: new McuExecutor({ approvals }) }
}

async function connectSim(
  executor: {
    connect(
      connection: MakerMachineConnection,
      asker: MakerApprovalAsker,
      options: MakerSendOptions,
      signal: AbortSignal,
    ): Promise<MakerExecuteResult>
  },
  sim: MakerMachineConnection,
  seen: MakerApprovalPrompt[] = [],
): Promise<void> {
  const connected = await executor.connect(sim, approver(seen), noExpiry, signal)
  expect(connected.ok).toBe(true)
}

async function homePrinter(executor: PrinterExecutor, sim: PrinterSimulator): Promise<void> {
  const homed = await executor.send(
    sim,
    approver([]),
    new TextEncoder().encode('G28\n'),
    noExpiry,
    signal,
  )
  expect(homed.ok).toBe(true)
}

describe('printer executor', () => {
  it('sends approved bytes to the simulator, receipted by digest', async () => {
    const { sim, executor } = printerHarness()
    const seen: MakerApprovalPrompt[] = []
    await connectSim(executor, sim, seen)
    expect(seen[0]?.warning).toBe('portReset')
    await homePrinter(executor, sim)
    const payload = new TextEncoder().encode('G1 X10 Y10 F1500\n')
    const result = await executor.send(sim, approver(seen), payload, noExpiry, signal)
    expect(result.ok).toBe(true)
    expect(sim.readState().position).toMatchObject({ x: 10, y: 10 })
    // The golden proof: the simulator journaled exactly the approved bytes.
    const sends = sendReceipts(sim)
    expect(sends).toHaveLength(2)
    expect(sends[1]?.digest).toBe(makerPayloadDigest(payload))
    if (result.ok) {
      expect(result.log.outcome).toBe('sent')
      expect(result.log.payloadSha256).toBe(makerPayloadDigest(payload))
      expect(result.log.approvalId).toBe(seen.at(-1)?.requestId)
    }
    // The person saw the analysis with the bytes.
    expect(seen.at(-1)?.analysis?.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 0 },
    })
  })

  it('sends nothing when the person rejects', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    await homePrinter(executor, sim)
    const seen: MakerApprovalPrompt[] = []
    const payload = new TextEncoder().encode('G1 X10\n')
    const before = sim.receipts().length
    const result = await executor.send(sim, rejecter(seen), payload, noExpiry, signal)
    expect(result).toMatchObject({ ok: false, reason: 'approval-rejected' })
    expect(seen).toHaveLength(1)
    expect(sim.receipts()).toHaveLength(before)
    expect(sim.readState().position).toMatchObject({ x: 0, y: 0 })
  })

  it('refuses policy violations without asking', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    await homePrinter(executor, sim)
    for (const [text, reason] of [
      ['M500\n', 'refused-command'],
      ['G1 X9999\n', 'outside-limits'],
      ['M104 S999\n', 'outside-limits'],
    ] as const) {
      const seen: MakerApprovalPrompt[] = []
      const before = sim.receipts().length
      const result = await executor.send(
        sim,
        approver(seen),
        new TextEncoder().encode(text),
        noExpiry,
        signal,
      )
      expect(result, text).toMatchObject({ ok: false, reason })
      expect(seen, text).toHaveLength(0)
      expect(sim.receipts(), text).toHaveLength(before)
    }
  })

  it('refuses motion on an unhomed machine without asking', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    const seen: MakerApprovalPrompt[] = []
    const result = await executor.send(
      sim,
      approver(seen),
      new TextEncoder().encode('G1 X10\n'),
      noExpiry,
      signal,
    )
    expect(result).toMatchObject({ ok: false, reason: 'unhomed' })
    expect(seen).toHaveLength(0)
  })

  it('asks again when the machine changed since the prompt', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    await homePrinter(executor, sim)
    // Out-of-band change while the prompt waits: a print starts from the
    // machine's own screen, so the approved state no longer holds.
    const racing: MakerApprovalAsker = (prompt) => {
      void sim.send(new TextEncoder().encode('M24\n'))
      return Promise.resolve(answer(prompt, 'send'))
    }
    const result = await executor.send(
      sim,
      racing,
      new TextEncoder().encode('G1 X10\n'),
      noExpiry,
      signal,
    )
    expect(result).toMatchObject({ ok: false, reason: 'state-changed' })
    expect(sendReceipts(sim).map((receipt) => receipt.digest)).not.toContain(
      makerPayloadDigest(new TextEncoder().encode('G1 X10\n')),
    )
  })

  it('stops without approval and refuses to move while halted', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    const stopped = await executor.stop(sim)
    expect(stopped.response).toContain('halted')
    expect(stopped.log.class).toBe('stop')
    expect(stopped.log.payloadSha256).toBe(makerPayloadDigest(new TextEncoder().encode('M112\n')))
    const homed = await executor.send(
      sim,
      approver([]),
      new TextEncoder().encode('G28\n'),
      noExpiry,
      signal,
    )
    expect(homed.ok).toBe(true)
    expect(homed.ok && homed.response).toContain('halted')
  })

  it('reads status without approval and refuses motion on the read path', async () => {
    const { sim, executor } = printerHarness()
    await connectSim(executor, sim)
    const status = await executor.query(sim, 'M105\n')
    expect(status.ok).toBe(true)
    expect(status.ok && status.log.approvalId).toBeUndefined()
    const motion = await executor.query(sim, 'G1 X10\n')
    expect(motion).toMatchObject({ ok: false, reason: 'approval-rejected' })
  })

  it('refuses a connection its approval never named', async () => {
    const printer = new PrinterSimulator(printerSimRecord())
    const mill = new CncSimulator(cncSimRecord())
    const executor = new PrinterExecutor({ approvals })
    const result = await executor.send(
      mill,
      approver([]),
      new TextEncoder().encode('G1 X1\n'),
      noExpiry,
      signal,
    )
    expect(result).toMatchObject({ ok: false, reason: 'target-mismatch' })
    expect(printer.receipts()).toHaveLength(0)
    expect(mill.receipts()).toHaveLength(0)
  })

  it('refuses sends where the machine reports no limits', async () => {
    const { sim, executor } = printerHarness({ limits: undefined })
    await connectSim(executor, sim)
    const seen: MakerApprovalPrompt[] = []
    const result = await executor.send(
      sim,
      approver(seen),
      new TextEncoder().encode('G28\n'),
      noExpiry,
      signal,
    )
    expect(result).toMatchObject({ ok: false, reason: 'no-limits' })
    expect(seen).toHaveLength(0)
  })
})

describe('cnc executor', () => {
  it('reads status, settings and alarms without approval', async () => {
    const { sim, executor } = cncHarness()
    await connectSim(executor, sim)
    const status = await executor.query(sim, '?\n')
    expect(status.ok).toBe(true)
    expect(status.ok && status.response).toContain('MPos')
    const settings = await executor.query(sim, '$$\n')
    expect(settings.ok).toBe(true)
    expect(settings.ok && settings.response).toContain('$20=')
    expect(status.ok && status.log.approvalId).toBeUndefined()
  })

  it('refuses motion and firing: no send exists this delivery', async () => {
    const { sim, executor } = cncHarness()
    expect('send' in executor).toBe(false)
    await connectSim(executor, sim)
    const before = sim.receipts().length
    for (const text of ['G1 X10\n', 'M3 S12000\n', '$J=X10\n', '$H\n']) {
      const result = await executor.query(sim, text)
      expect(result, text).toMatchObject({ ok: false, reason: 'cnc-delivery' })
    }
    expect(sim.receipts()).toHaveLength(before)
    expect(sim.readState().position).toMatchObject({ x: 0, y: 0 })
  })

  it('stops with the GRBL sequence and warns on motion startup lines', async () => {
    const { sim, executor } = cncHarness()
    await connectSim(executor, sim)
    const stopped = await executor.stop(sim)
    expect(stopped.warning).toBeUndefined()
    expect(sim.readState().fingerprint).not.toBe(sim.receipts()[0]?.stateBefore)
    const stopReceipt = sim.receipts().find((receipt) => receipt.kind === 'stop')
    expect(stopReceipt?.digest).toBe(makerPayloadDigest(new Uint8Array([0x21, 0x85, 0x18])))
    const holdingHarness = cncHarness({ startupLines: ['$N0=G28'] })
    await connectSim(holdingHarness.executor, holdingHarness.sim)
    const stoppedHolding = await holdingHarness.executor.stop(holdingHarness.sim)
    expect(stoppedHolding.warning).toBe('startupMotion')
  })
})

describe('mcu executor', () => {
  const firmware = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01])

  it('opens with the reset warning and programs approved bytes', async () => {
    const { sim, executor } = mcuHarness()
    const seen: MakerApprovalPrompt[] = []
    await connectSim(executor, sim, seen)
    expect(seen[0]?.warning).toBe('portReset')
    const programmed = await executor.program(
      sim,
      approver(seen),
      firmware,
      { expected: { vidPid: '2E8A:0005', chip: 'RP2040' } },
      signal,
    )
    expect(programmed.ok).toBe(true)
    expect(sim.flashBytes()).toEqual(firmware)
    const sends = sendReceipts(sim)
    expect(sends).toHaveLength(1)
    expect(sends[0]?.digest).toBe(makerPayloadDigest(firmware))
    // Binary firmware shows as hex, all of it.
    expect(seen.at(-1)?.preview).toEqual([{ kind: 'hex', hex: 'deadbeef0001' }])
  })

  it('programs nothing when the person rejects', async () => {
    const { sim, executor } = mcuHarness()
    await connectSim(executor, sim)
    const before = sim.receipts().length
    const result = await executor.program(sim, rejecter([]), firmware, noExpiry, signal)
    expect(result).toMatchObject({ ok: false, reason: 'approval-rejected' })
    expect(sim.receipts()).toHaveLength(before)
    expect(sim.flashBytes()).toHaveLength(0)
  })

  it('refuses a board the project never meant, without asking', async () => {
    const { sim, executor } = mcuHarness()
    await connectSim(executor, sim)
    // D83.10's case: a Pico on the port of an ESP32 project.
    const seen: MakerApprovalPrompt[] = []
    const result = await executor.program(
      sim,
      approver(seen),
      firmware,
      { expected: { vidPid: '10C4:EA60', chip: 'ESP32' } },
      signal,
    )
    expect(result).toMatchObject({ ok: false, reason: 'identity-mismatch' })
    expect(seen).toHaveLength(0)
    expect(sim.flashBytes()).toHaveLength(0)
  })

  it('refuses an image past the flash capacity without asking', async () => {
    const { sim, executor } = mcuHarness({ flashCapacityBytes: 4 })
    await connectSim(executor, sim)
    const seen: MakerApprovalPrompt[] = []
    const result = await executor.program(sim, approver(seen), firmware, noExpiry, signal)
    expect(result).toMatchObject({ ok: false, reason: 'outside-limits' })
    expect(seen).toHaveLength(0)
  })

  it('stops streams without touching the board', async () => {
    const { sim, executor } = mcuHarness()
    await connectSim(executor, sim)
    const programmed = await executor.program(sim, approver([]), firmware, noExpiry, signal)
    expect(programmed.ok).toBe(true)
    const stopped = await executor.stop(sim)
    expect(stopped.log.class).toBe('stop')
    expect(stopped.log.payloadByteLength).toBe(0)
    expect(sim.flashBytes()).toEqual(firmware)
    expect('query' in executor).toBe(false)
  })
})
