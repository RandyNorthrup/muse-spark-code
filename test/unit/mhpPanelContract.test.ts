import { readFile } from 'node:fs/promises'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as z from 'zod/mini'
import { MHP, MHP_PANEL, MHP_ERROR_CODES } from '../../src/shared/constants'
import { selectMhpVersion } from '../../src/shared/hostApi/capabilities'
import { parseMhpStdioLine } from '../../src/shared/hostApi/framing'
import {
  embeddedBridgeStateSchema,
  MhpPanelError,
  panelBindingSchema,
  panelEnvelopeSchema,
  panelErrorSchema,
  panelQueueBudgetSchema,
  parseMhpPanelEnvelope,
  parseMhpSurfaceNotification,
  type MhpPanelBinding,
  type MuseEmbeddedHost,
} from '../../src/shared/hostApi/panel'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'

const binding: MhpPanelBinding = {
  surface: 'opaque-a',
  sessionId: 'session-a',
  surfaceKind: 'chat',
}
const context = { binding, expectedSeq: 1, direction: 'toHost' as const, ready: true }
const envelope = {
  mhp: '1.5',
  kind: 'panel',
  surface: binding.surface,
  direction: 'toHost',
  seq: 1,
  payload: { type: 'ready' },
}
const lifecycle = { mhp: '1.5', kind: 'surface', ...binding }
const stdio = { protocolVersion: MHP_PANEL.version }
const snapshotSchema = z.object({
  errorCodes: z.unknown(),
  failure: z.unknown(),
  capabilities: z.unknown(),
  methods: z.record(z.string(), z.looseObject({ call: z.unknown() })),
})

describe('MHP 1.5 replacement panel contract', () => {
  it('documents replacement of 1.1 and current 1.5 schemas behind legacy filenames', async () => {
    const readme = await readFile('README.md', 'utf8')
    const guide = readme
      .split('The replacement MHP 1.5.0 contract', 2)[1]
      ?.split('Regenerate with', 1)[0]
      ?.replaceAll(/\s+/gu, ' ')
    expect(guide).toContain('MHP 1.5 replaces 1.1 and 1.2, and supersedes 1.3 and 1.4')
    expect(guide).toContain('both legacy-named snapshots carry the current 1.5 schemas')
    expect(guide).not.toContain('preserve frozen v1')
    const header = z.object({ protocol: z.string() })
    for (const file of ['mhp-v1.schema.json', 'mhp-v1.1.schema.json'])
      expect(
        header.parse(JSON.parse(await readFile(`src/shared/hostApi/${file}`, 'utf8'))).protocol,
      ).toBe(MHP.version)
  })
  it('preserves every v1 call, error and non-initialize result schema', async () => {
    const [v1, next] = await Promise.all([
      readFile('src/shared/hostApi/mhp-v1.schema.json', 'utf8'),
      readFile('src/shared/hostApi/mhp-v1.1.schema.json', 'utf8'),
    ])
    const old = snapshotSchema.parse(JSON.parse(v1))
    const current = snapshotSchema.parse(JSON.parse(next))
    expect(current.errorCodes).toEqual(old.errorCodes)
    expect(current.failure).toEqual(old.failure)
    expect(current.capabilities).toEqual(old.capabilities)
    expect(Object.keys(current.methods)).toEqual(Object.keys(old.methods))
    for (const [method, definition] of Object.entries(old.methods)) {
      expect(current.methods[method]?.call).toEqual(old.methods[method]?.call)
      if (method !== 'initialize') expect(current.methods[method]).toEqual(definition)
    }
    const initialized = {
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: MHP.version, capabilities: ['lifecycle'] },
    }
    expect(
      parseMhpStdioLine(JSON.stringify(initialized), { ...stdio, pendingMethod: 'initialize' }),
    ).toEqual(parseMhpResult('initialize', initialized))
  })

  it.each([
    ['mhp/1.0.0', 'mhp/1.1.0', undefined],
    ['mhp/1.1.0', 'mhp/1.5.0', undefined],
    ['mhp/1.4.0', 'mhp/1.5.0', undefined],
    ['mhp/1.5.0', 'mhp/1.6.0', 'mhp/1.5.0'],
    ['mhp/1.0.0', 'mhp/2.0.0', 'mhp/1.5.0'],
    ['mhp/1.5.1', 'mhp/1.6.0', undefined],
    ['mhp/2.0.0', 'mhp/3.0.0', undefined],
    ['mhp/01.0.0', 'mhp/2.0.0', undefined],
  ])('selects only an implemented version in [%s, %s)', (minimum, maximumExclusive, selected) => {
    expect(selectMhpVersion({ minimum, maximumExclusive })).toBe(selected)
  })

  it('validates shared payloads in both directions without a second vocabulary', () => {
    expect(parseMhpPanelEnvelope(envelope, context)).toEqual(envelope)
    const host = {
      ...envelope,
      direction: 'toPanel',
      payload: { type: 'insertText', text: 'hello' },
    }
    expect(parseMhpPanelEnvelope(host, { ...context, direction: 'toPanel' })).toEqual(host)
    for (const payload of [
      { type: 'invented' },
      { type: 'sendMessage', text: 'incomplete' },
      { type: 'insertText', text: 'wrong direction' },
    ]) {
      expect(() => parseMhpPanelEnvelope({ ...envelope, payload }, context)).toThrow(
        'MHP_PANEL_INVALID_PAYLOAD',
      )
    }
    expect(() =>
      parseMhpPanelEnvelope(
        { ...host, payload: { type: 'ready' } },
        { ...context, direction: 'toPanel' },
      ),
    ).toThrow('MHP_PANEL_INVALID_PAYLOAD')
  })

  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])('refuses invalid sequence %s', (seq) => {
    expect(panelEnvelopeSchema.safeParse({ ...envelope, seq }).success).toBe(false)
  })

  it('enforces ordering independently per surface and direction; refuses duplicates and gaps', () => {
    expect(parseMhpPanelEnvelope(envelope, context).seq).toBe(1)
    const advanced = { ...context, expectedSeq: 2 }
    expect(parseMhpPanelEnvelope({ ...envelope, seq: 2 }, advanced).seq).toBe(2)
    expect(() => parseMhpPanelEnvelope(envelope, advanced)).toThrow('MHP_PANEL_OUT_OF_ORDER')
    expect(() => parseMhpPanelEnvelope({ ...envelope, seq: 3 }, advanced)).toThrow(
      'MHP_PANEL_OUT_OF_ORDER',
    )
    const other = { ...binding, surface: 'opaque-b' }
    expect(
      parseMhpPanelEnvelope({ ...envelope, surface: other.surface }, { ...context, binding: other })
        .seq,
    ).toBe(1)
    expect(
      parseMhpPanelEnvelope(
        { ...envelope, direction: 'toPanel', payload: { type: 'insertText', text: '' } },
        { ...context, direction: 'toPanel' },
      ).seq,
    ).toBe(1)
  })

  it('returns a typed error for an unknown or closed surface before delivery', () => {
    for (const target of [undefined, { ...binding, surface: 'opaque-b' }]) {
      try {
        parseMhpPanelEnvelope(envelope, { ...context, binding: target })
        expect.fail('unknown surface admitted')
      } catch (error) {
        expect(error).toBeInstanceOf(MhpPanelError)
        if (!(error instanceof MhpPanelError)) throw error
        expect(panelErrorSchema.parse(error.frame)).toMatchObject({
          code: 'MHP_PANEL_UNKNOWN_SURFACE',
          surface: binding.surface,
          seq: 1,
        })
      }
    }
  })

  it('refuses delivery before ready and on the wrong transport direction', () => {
    expect(() => parseMhpPanelEnvelope(envelope, { ...context, ready: false })).toThrow(
      'MHP_PANEL_NOT_READY',
    )
    expect(() => parseMhpPanelEnvelope(envelope, { ...context, direction: 'toPanel' })).toThrow(
      'MHP_PANEL_WRONG_DIRECTION',
    )
  })

  it('caps raw UTF-8 bytes, including unknown fields, and admits the exact boundary', () => {
    const message = {
      ...envelope,
      payload: { type: 'sendMessage', localId: '1', text: '', attachmentIds: [] },
    }
    const remaining =
      MHP_PANEL.maximumEnvelopeBytes - new TextEncoder().encode(JSON.stringify(message)).byteLength
    message.payload.text = 'x'.repeat(remaining)
    expect(parseMhpPanelEnvelope(message, context).seq).toBe(1)
    expect(parseMhpStdioLine(`${JSON.stringify(message)}\n`, stdio)).toEqual(message)
    message.payload.text += 'x'
    expect(() => parseMhpPanelEnvelope(message, context)).toThrow('MHP_PANEL_TOO_LARGE')
    expect(() => parseMhpStdioLine(JSON.stringify(message), stdio)).toThrow('MHP_PANEL_TOO_LARGE')
    message.payload.text = 'é'.repeat(Math.floor(remaining / 2) + 1)
    expect(() => parseMhpPanelEnvelope(message, context)).toThrow('MHP_PANEL_TOO_LARGE')
    expect(() => parseMhpStdioLine(JSON.stringify(message), stdio)).toThrow('MHP_PANEL_TOO_LARGE')
    expect(() =>
      parseMhpPanelEnvelope(
        {
          ...envelope,
          payload: { ...envelope.payload, padding: 'x'.repeat(MHP_PANEL.maximumEnvelopeBytes) },
        },
        context,
      ),
    ).toThrow('MHP_PANEL_TOO_LARGE')
  })

  it('refuses malformed, extra-field and unserializable envelopes', () => {
    for (const invalid of [
      { ...envelope, mhp: '1.0' },
      { ...envelope, surface: '' },
      { ...envelope, extra: true },
      [envelope],
    ]) {
      expect(() => parseMhpPanelEnvelope(invalid, context)).toThrow('MHP_PANEL_INVALID_ENVELOPE')
    }
    const payload = { type: 'ready', circular: {} }
    payload.circular = payload
    expect(() => parseMhpPanelEnvelope({ ...envelope, payload }, context)).toThrow(
      'MHP_PANEL_INVALID_PAYLOAD',
    )
  })

  it('routes Tasks and Whats New through their existing schemas and rejects cross-surface messages', () => {
    const tasks = { ...binding, surfaceKind: 'tasks' as const }
    expect(
      parseMhpPanelEnvelope(
        { ...envelope, payload: { type: 'tasksReady' } },
        { ...context, binding: tasks },
      ).payload.type,
    ).toBe('tasksReady')
    expect(
      parseMhpPanelEnvelope(
        {
          ...envelope,
          direction: 'toPanel',
          payload: {
            type: 'tasksState',
            conversation: 'test',
            items: [],
            ended: false,
            canMoveToWindow: false,
          },
        },
        { ...context, binding: tasks, direction: 'toPanel' },
      ).payload.type,
    ).toBe('tasksState')
    expect(() => parseMhpPanelEnvelope(envelope, { ...context, binding: tasks })).toThrow(
      'MHP_PANEL_INVALID_PAYLOAD',
    )
    const whatsNew = { ...binding, surfaceKind: 'whatsNew' as const }
    expect(
      parseMhpPanelEnvelope(
        { ...envelope, payload: { type: 'tryIt', index: 0 } },
        { ...context, binding: whatsNew },
      ).payload.type,
    ).toBe('tryIt')
    expect(() =>
      parseMhpPanelEnvelope(
        { ...envelope, direction: 'toPanel', payload: { type: 'insertText', text: '' } },
        { ...context, binding: whatsNew, direction: 'toPanel' },
      ),
    ).toThrow('MHP_PANEL_INVALID_PAYLOAD')
  })

  it('declares surface kinds and keeps session binding immutable across lifecycle notifications', () => {
    for (const invalid of [
      { ...binding, surfaceKind: 'unknown' },
      { ...binding, sessionId: '' },
      { ...binding, surface: '' },
    ]) {
      expect(panelBindingSchema.safeParse(invalid).success).toBe(false)
    }
    for (const surfaceKind of [
      'chat',
      'tasks',
      'whatsNew',
      'usage',
      'maker',
      'models',
      'traffic',
      'settings',
      'walkthrough',
      'diff',
    ]) {
      expect(panelBindingSchema.safeParse({ ...binding, surfaceKind }).success).toBe(true)
    }
    expect(parseMhpSurfaceNotification({ ...lifecycle, event: 'opened' }, undefined).event).toBe(
      'opened',
    )
    for (const event of ['ready', 'hidden', 'closed']) {
      expect(
        parseMhpSurfaceNotification(
          { ...lifecycle, event, ...(event === 'closed' && { droppedMessages: 2 }) },
          binding,
        ).event,
      ).toBe(event)
    }
    expect(() =>
      parseMhpSurfaceNotification({ ...lifecycle, event: 'ready', sessionId: 'other' }, binding),
    ).toThrow('MHP_PANEL_BINDING_MISMATCH')
    expect(() => parseMhpSurfaceNotification({ ...lifecycle, event: 'ready' }, undefined)).toThrow(
      'MHP_PANEL_UNKNOWN_SURFACE',
    )
    expect(() => parseMhpSurfaceNotification({ ...lifecycle, event: 'opened' }, binding)).toThrow(
      'MHP_PANEL_INVALID_LIFECYCLE',
    )
    expect(() =>
      parseMhpSurfaceNotification({ ...lifecycle, event: 'closed', droppedMessages: -1 }, binding),
    ).toThrow()
    expect(() => parseMhpSurfaceNotification({ ...lifecycle, event: 'closed' }, binding)).toThrow()
  })

  it('replays only the existing state request appropriate to the reloaded surface', () => {
    for (const [surfaceKind, stateRequest] of [
      ['chat', { type: 'ready' }],
      ['tasks', { type: 'tasksReady' }],
      ['usage', { type: 'readUsage' }],
      ['whatsNew', null],
      ['maker', { type: 'ready' }],
    ]) {
      const bound = panelBindingSchema.parse({ ...binding, surfaceKind })
      expect(
        parseMhpSurfaceNotification(
          { ...lifecycle, ...bound, event: 'reloaded', stateRequest },
          bound,
        ),
      ).toMatchObject({ event: 'reloaded', stateRequest })
    }
    expect(() =>
      parseMhpSurfaceNotification(
        { ...lifecycle, event: 'reloaded', stateRequest: { type: 'tasksReady' } },
        binding,
      ),
    ).toThrow('MHP_PANEL_INVALID_LIFECYCLE')
  })

  it('multiplexes calls, results, failures, notifications and panel frames on one NDJSON stream', () => {
    const frames = [
      { jsonrpc: '2.0', id: 1, method: 'shutdown', params: {} },
      { jsonrpc: '2.0', method: 'documents/didClose', params: { uri: 'file:///workspace/a.ts' } },
      { jsonrpc: '2.0', id: 1, result: null },
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: MHP_ERROR_CODES.invalidRequest, message: 'MHP_INVALID_REQUEST' },
      },
      { ...lifecycle, event: 'opened' },
      envelope,
    ]
    for (const frame of frames)
      expect(
        parseMhpStdioLine(`${JSON.stringify(frame)}\r\n`, { ...stdio, pendingMethod: 'shutdown' }),
      ).toEqual(frame)
    expect(() =>
      parseMhpStdioLine(JSON.stringify(envelope), { protocolVersion: 'mhp/1.1.0' }),
    ).toThrow('MHP_INCOMPATIBLE_VERSION')
    expect(() => parseMhpStdioLine(JSON.stringify(frames[2]), stdio)).toThrow(
      'MHP_UNCORRELATED_RESULT',
    )
    for (const line of [
      '',
      '[]',
      '{}',
      `${JSON.stringify(envelope)}\n${JSON.stringify(envelope)}`,
      JSON.stringify({ ...envelope, payload: { type: 'invented' } }),
    ]) {
      expect(() => parseMhpStdioLine(line, stdio)).toThrow()
    }
  })

  it('exports the browser bridge interface and JSON-only persisted state', () => {
    expectTypeOf<MuseEmbeddedHost['postMessage']>().returns.toBeVoid()
    expectTypeOf<MuseEmbeddedHost['onMessage']>().returns.toEqualTypeOf<() => void>()
    expect(
      embeddedBridgeStateSchema.parse({ sessionId: binding.sessionId, draft: '', collapsed: [] }),
    ).toEqual({ sessionId: binding.sessionId, draft: '', collapsed: [] })
    expect(embeddedBridgeStateSchema.safeParse({ callback: () => undefined }).success).toBe(false)
  })

  it('bounds both aggregate queue bytes and message count before admission', () => {
    const limit = { bytes: MHP_PANEL.maximumQueuedBytes, messages: MHP_PANEL.maximumQueuedMessages }
    expect(panelQueueBudgetSchema.parse(limit)).toEqual(limit)
    expect(panelQueueBudgetSchema.safeParse({ ...limit, bytes: limit.bytes + 1 }).success).toBe(
      false,
    )
    expect(
      panelQueueBudgetSchema.safeParse({ ...limit, messages: limit.messages + 1 }).success,
    ).toBe(false)
  })
})
