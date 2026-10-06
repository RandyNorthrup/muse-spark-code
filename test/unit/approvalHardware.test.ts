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

function answer(value: HardwareApproval) {
  return { id: value.request.id, digest: value.request.digest, decision: 'sendOnce' }
}

async function observeHardware(h: ReturnType<typeof acpMspHost>, command: string) {
  const { session } = await h.host.resumeSession('old-1', 'muse-spark-1.3')
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  h.server.notify('approval/requested', {
    ...raceRequested('old-1'),
    subject: { kind: 'shell', command },
  })
  return { session, events }
}

async function pendingHardwareCard(events: readonly AgentEvent[]): Promise<Card> {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
  })
  const request = events.find((event): event is Card => event.type === 'approvalRequested')
  if (request === undefined) throw new Error('missing hardware approval')
  return request
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
    expect(physical.availableChoices.map((choice) => choice.choiceId)).toEqual([
      'allow_once',
      'abort',
    ])
    expect(isReviewableApproval(physical, 'auto', 'parent-turn')).toBe(false)
  })

  it('leaves ordinary commands and stops byte-identical', () => {
    const ordinary = card('npm test')
    const stop = card('machine_stop')
    expect(scrubHardwareApproval(ordinary)).toBe(ordinary)
    expect(scrubHardwareApproval(stop)).toBe(stop)
  })
})

describe('Muse Code guard over the real MSP transport', () => {
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
      await expect(session.decideApproval(decision)).rejects.toMatchObject({
        name: 'DecisionNotAppliedError',
      })
      await expect(session.decideApproval(decision)).rejects.toThrow(UI_TEXT.hardwareExpired)
      vi.setSystemTime(Date.now() + MACHINE_APPROVAL_TTL_MS + 1)
      await expect(session.decideApproval(decision)).rejects.toThrow(UI_TEXT.hardwareExpired)
      expect(
        h.server
          .requestsFor('approval/decide')
          .filter((call) => call.params?.['choiceId'] === 'allow_once'),
      ).toHaveLength(1)
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
      expect(h.server.requestsFor('session/setApprovalMode')).toHaveLength(0)
      const request = await pendingHardwareCard(events)
      expect(request.availableChoices.map((choice) => choice.choiceId)).toEqual([
        'allow_once',
        'abort',
      ])
      await expect(
        session.decideApproval({
          approvalId: request.approvalId,
          requirementId: request.requirementId,
          choiceId: 'allow_local_prefix',
        }),
      ).rejects.toThrow(UI_TEXT.hardwareRefused)
      expect(h.server.requestsFor('approval/decide')).toHaveLength(0)
    } finally {
      await h.host.close()
    }
  })

  it('refuses irreversible commands without asking any surface', async () => {
    const h = acpMspHost()
    h.server.handle('approval/decide', (params) => ({
      commandId: params['commandId'],
      terminal: true,
    }))
    try {
      const { events } = await observeHardware(h, 'espefuse burn-key KEY0 key.bin')
      await vi.waitFor(() => {
        expect(h.server.requestsFor('approval/decide')).toHaveLength(1)
      })
      expect(h.server.requestsFor('approval/decide')[0]?.params?.['choiceId']).toBe('abort')
      expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
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
})
