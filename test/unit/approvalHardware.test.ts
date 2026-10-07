import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MACHINE_APPROVAL_TTL_MS, UI_TEXT } from '../../src/shared/constants'
import {
  approvalHardwareAction,
  scrubHardwareApproval,
} from '../../src/core/agent/approvalHardware'
import { isReviewableApproval } from '../../src/core/agent/approvalRules'
import { HardwareApproval } from '../../src/core/maker/ports'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { raceRequested } from './helpers/stageRaceCapture'
import { acpMspHost } from './helpers/acpMsp'

type Card = Extract<AgentEvent, { type: 'approvalRequested' }>

function card(command = 'pio run -t upload'): Card {
  const capture = raceRequested('s1')
  const mapped = mapNotification({
    method: 'approval/requested',
    params: { ...capture, subject: { kind: 'shell', command } },
  })
  if (
    typeof mapped === 'string' ||
    !('event' in mapped) ||
    mapped.event.type !== 'approvalRequested'
  )
    throw new Error('captured approval did not map')
  return { ...mapped.event, turnId: 'parent-turn' }
}

function capturedSubject() {
  const subject = raceRequested('old-1')['subject']
  if (typeof subject !== 'object' || subject === null) throw new Error('Missing capture subject')
  return subject
}

function answer(value: HardwareApproval) {
  return { id: value.request.id, digest: value.request.digest, decision: 'sendOnce' }
}

async function observeHardware(h: ReturnType<typeof acpMspHost>, command: string) {
  const session = await startHardwareSession(h)
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  h.server.notify('approval/requested', {
    ...raceRequested('old-1'),
    subject: { ...capturedSubject(), command },
  })
  return { session, events }
}

function startHardwareSession(h: ReturnType<typeof acpMspHost>) {
  return h.host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'onRequest',
  })
}

async function pendingHardwareCard(events: readonly AgentEvent[]): Promise<Card> {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
  })
  const request = events.find((event): event is Card => event.type === 'approvalRequested')
  if (request === undefined) throw new Error('missing hardware approval')
  return request
}

async function expectCliRejected(h: ReturnType<typeof acpMspHost>, events: readonly AgentEvent[]) {
  await vi.waitFor(() => {
    expect(h.server.requestsFor('approval/decide')).toHaveLength(1)
  })
  expect(h.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
  expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
}

describe('Muse Code hardware approvals', () => {
  it('scrubs standing choices from captured approval and update shapes', () => {
    const request = card()
    const scrubbed = scrubHardwareApproval(request)
    expect(scrubbed.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
    expect(scrubbed.note).toBe(UI_TEXT.approvalHardwareNote)
    expect(scrubHardwareApproval({ ...request, type: 'approvalUpdated' }).availableChoices).toEqual(
      scrubbed.availableChoices,
    )
    expect(scrubbed.subject.command).toBe('pio run -t upload')
  })

  it('removes every approval for irreversible actions', () => {
    const scrubbed = scrubHardwareApproval(card('espefuse burn-key KEY0 key.bin'))
    expect(scrubbed.availableChoices.map((choice) => choice.choiceId)).toEqual(['abort'])
    expect(scrubbed.note).toBe(UI_TEXT.hardwareRefused)
  })
  it('refuses a standing scope even when its decision word is approved', () => {
    // Adversarial internal event using existing fields, not a claim about a captured CLI choice.
    const original = card()
    const scrubbed = scrubHardwareApproval({
      ...original,
      availableChoices: [
        ...original.availableChoices,
        { choiceId: 'standing', label: 'standing', decision: 'approved', scope: 'session' },
      ],
    })
    expect(scrubbed.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
  })

  it('does not reach reviewer under Auto or child permission modes', () => {
    expect(isReviewableApproval(card(), 'auto', 'parent-turn')).toBe(false)
    expect(
      isReviewableApproval(
        { ...card(), permissionMode: 'bypassPermissions' },
        'auto',
        'parent-turn',
      ),
    ).toBe(false)
    expect(isReviewableApproval(card('npm test'), 'auto', 'parent-turn')).toBe(true)
    expect(isReviewableApproval(card('npm test'), 'auto', 'parent-turn', true)).toBe(false)
    const unknown = scrubHardwareApproval(card('node -e "run()"'), { isHardwareWorkspace: true })
    expect(isReviewableApproval({ ...unknown }, 'auto', 'parent-turn')).toBe(false)
  })

  it('checks each stage and known physical MCP tools, regardless of confirm arguments', () => {
    const original = card('npm test')
    expect(
      approvalHardwareAction({
        kind: 'shell',
        stages: [
          {
            requirementId: original.requirementId,
            position: 1,
            totalStages: 1,
            argv: ['esptool', 'write_flash', '0', 'app.bin'],
          },
        ],
      }),
    ).toBe('program')
    const physical = scrubHardwareApproval({
      ...original,
      toolName: 'mcp__moonraker__send_gcode',
      rawArgs: '{"confirm":true,"token":"model-chosen"}',
      subject: { kind: 'tool', toolName: 'mcp__moonraker__send_gcode' },
    })
    expect(physical.availableChoices.map((choice) => choice.choiceId)).toEqual(['abort'])
    expect(physical.note).toBe(UI_TEXT.hardwareBindingUnavailable)
    expect(isReviewableApproval(physical, 'auto', 'parent-turn')).toBe(false)
  })

  it('leaves ordinary commands and stops byte-identical', () => {
    const ordinary = card('npm test')
    const stop = card('machine_stop')
    expect(scrubHardwareApproval(ordinary)).toBe(ordinary)
    expect(scrubHardwareApproval(stop)).toBe(stop)
  })
  it('hardware shell cards never offer standing choices, even for allowlisted reads', () => {
    const read = scrubHardwareApproval(card('pio --version'), { isHardwareWorkspace: true })
    expect(read.availableChoices.map((choice) => choice.choiceId)).toEqual(['allow_once', 'abort'])
    expect(isReviewableApproval(read, 'auto', 'parent-turn')).toBe(false)
  })

  it.each([
    ['pwsh', '-EncodedCommand', 'ZQBjAGgAbwA='],
    ['node', '-e', 'run()'],
  ])('R2F6: staged-only interpreter asks without standing choices: %j', (...argv) => {
    const original = card()
    const subject = {
      kind: 'shell',
      stages: [{ requirementId: original.requirementId, position: 1, totalStages: 1, argv }],
    }
    expect(approvalHardwareAction(subject, { isHardwareWorkspace: true })).toBe('actuate')
    const scrubbed = scrubHardwareApproval({ ...original, subject }, { isHardwareWorkspace: true })
    expect(scrubbed.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
    expect(isReviewableApproval(scrubbed, 'auto', 'parent-turn')).toBe(false)
    const conflicting = { ...subject, command: 'esptool --help' }
    expect(approvalHardwareAction(conflicting, { isHardwareWorkspace: true })).toBe('actuate')
    expect(
      scrubHardwareApproval({ ...original, subject: conflicting }, { isHardwareWorkspace: true })
        .availableChoices,
    ).toEqual(scrubbed.availableChoices)
  })
})

describe('Muse Code guard over the real MSP transport', () => {
  it('R3F4: an unattended transition while a hardware card waits sends no allow frame', async () => {
    let isUnattended = false
    const h = acpMspHost(() => ({ isHardwareWorkspace: true, isUnattended }))
    try {
      const { session, events } = await observeHardware(h, 'pio run -t upload')
      const request = await pendingHardwareCard(events)
      isUnattended = true
      await expect(
        session.decideApproval({
          approvalId: request.approvalId,
          requirementId: request.requirementId,
          choiceId: 'allow_once',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareUnattended)
      expect(h.server.requestsFor('approval/decide')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })

  it.each([true, false])(
    'R3F5: registered Stop rejects CLI copy without any card, unattended=%s',
    async (isUnattended) => {
      const h = acpMspHost(() => ({
        isUnattended,
        targets: [{ address: 'https://printer.local', stop: '/printer/emergency_stop' }],
      }))
      h.server.handle('approval/decide', (params) => ({
        commandId: params['commandId'],
        terminal: true,
      }))
      try {
        const { events } = await observeHardware(
          h,
          'curl -X POST https://printer.local/printer/emergency_stop',
        )
        await expectCliRejected(h, events)
      } finally {
        await h.host.close()
      }
    },
  )

  it.each(['staged shell', 'typed tool'] as const)(
    'R2F7: %s binds every host target, including its second identity',
    async (kind) => {
      let usbSerial = 'second-one'
      const h = acpMspHost(() => ({
        targets: [
          { address: 'https://first.local', usbSerial: 'first-one' },
          { address: 'https://second.local', usbSerial },
        ],
      }))
      try {
        const session = await startHardwareSession(h)
        const events: AgentEvent[] = []
        session.onEvent((event) => {
          events.push(event)
        })
        const capture = raceRequested('old-1')
        // Supported internal fields from the captured stage schema. These
        // target values are adversarial tests, not a new CLI wire claim.
        h.server.notify('approval/requested', {
          ...capture,
          subject:
            kind === 'staged shell'
              ? {
                  kind: 'shell',
                  stages: [
                    {
                      requirementId: { approvalId: capture['approvalId'], sourceIndex: 0 },
                      position: 1,
                      totalStages: 1,
                      argv: ['curl', '--json', '{}', 'https://second.local/api/job'],
                    },
                  ],
                }
              : {
                  kind: 'tool',
                  toolName: 'mcp__moonraker__send_gcode',
                  target: 'https://second.local',
                },
        })
        const request = await pendingHardwareCard(events)
        usbSerial = 'replacement-board'
        await expect(
          session.decideApproval({
            approvalId: request.approvalId,
            requirementId: request.requirementId,
            choiceId: 'allow_once',
          }),
        ).rejects.toThrow(UI_TEXT.hardwareBindingUnavailable)
        expect(h.server.requestsFor('approval/decide')).toHaveLength(0)
      } finally {
        await h.host.close()
      }
    },
  )

  it.each([
    ['npm test', true],
    ['git status', true],
    ['espefuse burn-key KEY0 key.bin', false],
  ] as const)(
    'MSP rejects hardware unattended commands and irreversible operations before a surface: %s, unattended=%s',
    async (command, isUnattended) => {
      const h = acpMspHost(() => ({ isHardwareWorkspace: isUnattended, isUnattended }))
      h.server.handle('approval/decide', (params) => ({
        commandId: params['commandId'],
        terminal: true,
      }))
      try {
        const { events } = await observeHardware(h, command)
        await expectCliRejected(h, events)
      } finally {
        await h.host.close()
      }
    },
  )

  it('caps hardware session modes before turns and refuses autonomous goal wakes', async () => {
    const h = acpMspHost(() => ({ hasConnectedBoard: true }))
    try {
      const session = await startHardwareSession(h)
      await session.setApprovalMode('onRequest')
      expect(h.server.requestsFor('session/setApprovalMode')[0]?.params?.['mode']).toBe(
        'promptUnmatched',
      )
      await expect(session.controlGoal({ verb: 'set', objective: 'move machine' })).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(h.server.requestsFor('goal/set')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })
  it('F5: a failed MSP decision retains expiry and consumed approval across retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = acpMspHost()
    const pending = {
      ...raceRequested('old-1'),
      subject: { kind: 'shell', command: 'pio run -t upload' },
    }
    h.server.handle('approval/decide', () => {
      throw Object.assign(new Error('refused'), { kind: 'internal' })
    })
    h.server.handle('approval/listPending', () => ({ approvals: [pending], userInputs: [] }))
    try {
      const { session, events } = await observeHardware(h, 'pio run -t upload')
      const request = await pendingHardwareCard(events)
      const decision = {
        approvalId: request.approvalId,
        requirementId: request.requirementId,
        choiceId: 'allow_once',
      }
      await expect(session.decideApproval(decision)).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      await expect(session.decideApproval(decision)).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      vi.setSystemTime(Date.now() + MACHINE_APPROVAL_TTL_MS + 1)
      await expect(session.decideApproval(decision)).rejects.toThrow(
        UI_TEXT.hardwareBindingUnavailable,
      )
      expect(
        h.server
          .requestsFor('approval/decide')
          .filter((call) => call.params?.['choiceId'] === 'allow_once'),
      ).toHaveLength(0)
    } finally {
      await h.host.close()
      vi.useRealTimers()
    }
  })

  it('F3: wrapped escaped fuse write is refused before any MSP approval surface', () => {
    expect(
      scrubHardwareApproval(
        card(String.raw`sh -c 'avrdude -U lfuse\:w:0xff:m'`),
      ).availableChoices.map((choice) => choice.choiceId),
    ).toEqual(['abort'])
  })
  it('expires an unanswered hardware request as a rejection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const h = acpMspHost()
    h.server.handle('approval/decide', (params) => ({
      commandId: params['commandId'],
      terminal: true,
    }))
    try {
      const { events } = await observeHardware(h, 'pio run -t upload')
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
      })
      await vi.advanceTimersByTimeAsync(MACHINE_APPROVAL_TTL_MS)
      expect(h.server.requestsFor('approval/decide')).toHaveLength(1)
      expect(h.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
    } finally {
      await h.host.close()
      vi.useRealTimers()
    }
  })
  it('rejects Bypass start/change locally and scrubs live cards before every listener', async () => {
    const h = acpMspHost(() => ({ isHardwareWorkspace: true }))
    try {
      await expect(
        h.host.startSession({
          workspaceRoot: '/ws',
          modelId: 'muse-spark-1.3',
          approvalMode: 'allowAll',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareBypassNotice)
      expect(h.server.requestsFor('session/start')).toHaveLength(0)
      const { session, events } = await observeHardware(h, 'pio run -t upload')
      await expect(session.setApprovalMode('allowAll')).rejects.toThrow(
        UI_TEXT.hardwareBypassNotice,
      )
      expect(h.server.requestsFor('session/start')[0]?.params?.['approvalMode']).toBe(
        'promptUnmatched',
      )
      expect(h.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
      const request = await pendingHardwareCard(events)
      expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual(['abort'])
      await expect(
        session.decideApproval({
          approvalId: request.approvalId,
          requirementId: request.requirementId,
          choiceId: 'allow_local_prefix',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareBindingUnavailable)
      expect(h.server.requestsFor('approval/decide')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })
})

describe('engine-minted host approvals', () => {
  const target = { address: 'COM5', vidPid: '303a:1001', usbSerial: 'board-one' }
  function approval() {
    return new HardwareApproval('request-one', 'G28', target, 'actuate', 0)
  }

  it('binds digest, target and expiry; consumes a valid answer once', () => {
    const value = approval()
    expect(value.request.digest).toBe(createHash('sha256').update('G28').digest('hex'))
    expect(value.request.target).toEqual(target)
    expect(value.request.expiresAt).toBe(MACHINE_APPROVAL_TTL_MS)
    expect(value.accept(answer(value), target, MACHINE_APPROVAL_TTL_MS - 1)).toBe(true)
    expect(value.accept(answer(value), target, 1)).toBe(false)
  })

  it.each(['id', 'digest'])('refuses wrong %s and consumes that request', (field) => {
    const value = approval()
    expect(value.accept({ ...answer(value), [field]: 'wrong' }, target, 1)).toBe(false)
    expect(value.accept(answer(value), target, 1)).toBe(false)
  })

  it.each(['address', 'vidPid', 'usbSerial'])('refuses changed target %s', (field) => {
    const value = approval()
    expect(value.accept(answer(value), { ...target, [field]: 'different' }, 1)).toBe(false)
  })

  it('rejects at the expiry boundary and afterwards', () => {
    const at = approval()
    const after = approval()
    expect(at.accept(answer(at), target, MACHINE_APPROVAL_TTL_MS)).toBe(false)
    expect(after.accept(answer(after), target, MACHINE_APPROVAL_TTL_MS + 1)).toBe(false)
  })

  it('rejects model-style tokens/flags and explicit rejection', () => {
    expect(approval().accept({ confirm: true, token: 'model-chosen' }, target, 1)).toBe(false)
    const value = approval()
    expect(value.accept({ ...answer(value), decision: 'reject' }, target, 1)).toBe(false)
  })
  it('R2F7 typed flash/serial/machine/GPIO approvals bind exact bytes, every identity and expiry', () => {
    const second = { address: 'COM6', usbSerial: 'second-board' }
    for (const operation of ['flash', 'serial-write', 'machine-send', 'gpio']) {
      const value = new HardwareApproval(
        operation,
        'exact bytes\u{0}\r\n',
        [target, second],
        'actuate',
        0,
      )
      expect(
        value.accept(answer(value), [target, { ...second, usbSerial: 'replacement' }], 1),
      ).toBe(false)
      expect(value.accept(answer(value), [target, second], 1)).toBe(false)
      const fresh = new HardwareApproval(operation, 'changed bytes', [target, second], 'actuate', 0)
      expect(fresh.request.digest).not.toBe(value.request.digest)
      expect(fresh.accept(answer(fresh), [target, second], MACHINE_APPROVAL_TTL_MS)).toBe(false)
    }
  })
})
