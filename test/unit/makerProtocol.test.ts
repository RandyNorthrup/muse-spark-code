import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  makerApprovalAnswerSchema,
  makerApprovalRequestSchema,
  makerHostMessageSchema,
  makerSurfaceMessageSchema,
  makerPreviewSchema,
  makerMachineSummarySchema,
  type MakerHostMessage,
  type MakerSurfaceMessage,
  type MakerPresetsOffered,
} from '../../src/shared/makerProtocol'
import { MAKER_PROTOCOL_VERSION, MAKER_PROTOCOL_MAX_ITEMS } from '../../src/shared/constants'

const target = {
  kind: 'serial',
  port: '/dev/ttyACM0',
  vid: '303a',
  pid: '1001',
  serialNumber: 'one',
} as const
const approval = {
  kind: 'command',
  id: randomUUID(),
  digest: 'a'.repeat(64),
  target,
  expiresAt: Date.now() + 1000,
  action: 'program',
  payload: 'firmware bytes',
} as const
const answer = { id: approval.id, digest: approval.digest, target, decision: 'allow_once' } as const
const machine = {
  registrationId: randomUUID(),
  id: 'printer',
  name: 'Printer',
  kind: 'moonraker',
  category: 'printer',
  endpoint: 'http://192.168.1.5',
  limits: {},
} as const
const { registrationId, ...registration } = machine
const event = {
  type: 'presetsOffered',
  title: 'Suggested checks',
  kinds: [],
  skillIds: [],
  presets: [],
  notices: [],
  isCircuitPyRoot: false,
  hasMachineConfig: false,
} satisfies MakerPresetsOffered
const v = MAKER_PROTOCOL_VERSION

// Every shape here belongs to this application, not to a guessed device/MSP frame.
describe('maker surface boundary', () => {
  it.each([
    { v, type: 'makerApproval', request: approval },
    { v, type: 'makerApprovalClosed', id: approval.id },
    { v, type: 'makerNotice', notice: 'physicalStopRequired' },
    { v, type: 'makerPresets', event },
    {
      v,
      type: 'makerPreview',
      preview: { kind: 'payload', title: 'Exact bytes', content: 'M105' },
    },
    {
      v,
      type: 'makerState',
      isTrusted: true,
      hardwareEnabled: false,
      isInteractive: true,
      machines: [machine],
      ports: [target],
    },
    {
      v,
      type: 'makerStatus',
      machineId: 'printer',
      status: {
        identity: 'virtual',
        state: 'future-state',
        isHomed: false,
        limits: {},
        blockedCommands: [],
        warnings: [],
      },
    },
    {
      v,
      type: 'makerDeviceLog',
      entries: [
        {
          time: 1,
          machine: 'printer',
          action: 'stop',
          payload: 'M112',
          digest: approval.digest,
          approval: null,
          outcome: 'stopped',
        },
      ],
    },
    {
      v,
      type: 'makerResult',
      id: approval.id,
      outcome: 'sentOutcomeUnknown',
      message: 'Check the machine before retrying.',
    },
  ] satisfies MakerHostMessage[])('validates and preserves engine message $type', (message) => {
    expect(makerHostMessageSchema.parse(structuredClone(message))).toEqual(message)
  })
  it.each([
    { v, type: 'makerReady' },
    { v, type: 'makerAnswer', answer },
    { v, type: 'makerStop' },
    { v, type: 'makerStop', machineId: 'printer' },
    { v, type: 'makerHardware', enabled: true, reason: 'Bench project' },
    { v, type: 'makerHardware', enabled: false },
    { v, type: 'makerStatus', machineId: 'printer' },
    { v, type: 'makerSend', id: approval.id, machineId: 'printer', payload: 'G1 X20' },
    {
      v,
      type: 'makerSerial',
      id: approval.id,
      operation: 'write',
      target,
      baud: 115_200,
      durationMs: 100,
      dtr: false,
      rts: false,
      payloadHex: '00ff',
    },
    { v, type: 'makerOpenLog' },
    { v, type: 'makerAddMachine', machine: registration, allowPlainHttp: true },
    { v, type: 'makerRemoveMachine', machineId: 'printer', registrationId },
    { v, type: 'makerChoosePreset', presetId: 'pio-build' },
    { v, type: 'makerOpenPreview', artifactId: approval.id },
  ] satisfies MakerSurfaceMessage[])('validates surface message $type', (message) => {
    expect(makerSurfaceMessageSchema.parse(message)).toEqual(message)
  })
  it.each([
    { ...answer, decision: 'allow_always' },
    { ...answer, decision: 'sendOnce' },
    { ...answer, confirm: true },
    { ...answer, token: 'model-field' },
    { ...answer, expiresAt: approval.expiresAt + 1 },
    { ...answer, target: { ...target, vid: 'wrong' } },
  ])('rejects widened or malformed approval answer %j', (raw) => {
    expect(makerApprovalAnswerSchema.safeParse(raw).success).toBe(false)
  })
  it('rejects a version mismatch, unknown fields, opposite direction and model approvals', () => {
    for (const raw of [
      { v: v + 1, type: 'makerStop' },
      { v, type: 'makerStop', token: 'tool' },
      { v, type: 'makerSend', machineId: 'printer', payload: 'G1 X20', confirm: true },
      {
        v,
        type: 'makerAnswer',
        answer: { ...answer, target: { ...target, apiKey: 'not-a-credential' } },
      },
      { v, type: 'makerApproval', request: approval },
    ])
      expect(makerSurfaceMessageSchema.safeParse(raw).success).toBe(false)
    expect(makerHostMessageSchema.safeParse({ v, type: 'makerAnswer', answer }).success).toBe(false)
  })
  it('requires a nonblank reason only when enabling hardware', () => {
    for (const reason of [undefined, '', ' '.repeat(3)]) {
      expect(
        makerSurfaceMessageSchema.safeParse({ v, type: 'makerHardware', enabled: true, reason })
          .success,
      ).toBe(false)
    }
    expect(
      makerSurfaceMessageSchema.safeParse({ v, type: 'makerHardware', enabled: false }).success,
    ).toBe(true)
  })
  it('keeps registration generations on the engine side of add requests', () => {
    expect(
      makerSurfaceMessageSchema.safeParse({
        v,
        type: 'makerAddMachine',
        machine,
        allowPlainHttp: true,
      }).success,
    ).toBe(false)
    expect(
      makerSurfaceMessageSchema.safeParse({
        v,
        type: 'makerAddMachine',
        machine: registration,
        allowPlainHttp: true,
      }).success,
    ).toBe(true)
    expect(makerMachineSummarySchema.safeParse(registration).success).toBe(false)
  })
  it('validates serial and machine approval detail without accepting Stop as an approved action', () => {
    const serial = {
      ...approval,
      kind: 'serial',
      payload: { encoding: 'hex', value: '00ff' },
      baud: 115_200,
      durationMs: 100,
      dtr: false,
      rts: false,
      warnsAboutReset: true,
      flashIdentity: { status: 'unknown' },
    }
    expect(makerApprovalRequestSchema.safeParse(serial).success).toBe(true)
    expect(
      makerApprovalRequestSchema.safeParse({
        ...serial,
        payload: { encoding: 'hex', value: '0zz' },
      }).success,
    ).toBe(false)
    const machineApproval = {
      ...approval,
      kind: 'machine',
      action: 'actuate',
      analysis: {
        classes: ['actuate'],
        maxFeedMmMin: 0,
        temperatures: {},
        unknown: [],
        refused: [],
        hasMotion: false,
      },
    }
    // Target identity carries only its binding fields, not limits/category/kind metadata.
    const machineTarget = {
      kind: 'machine',
      registrationId: machine.registrationId,
      id: machine.id,
      name: machine.name,
      endpoint: machine.endpoint,
      identity: 'virtual',
    }
    expect(
      makerApprovalRequestSchema.safeParse({ ...machineApproval, target: machineTarget }).success,
    ).toBe(true)
    expect(makerApprovalRequestSchema.safeParse({ ...approval, action: 'stop' }).success).toBe(
      false,
    )
  })
  it('bounds lists and refuses secrets in registrations and arbitrary preview paths', () => {
    expect(
      makerHostMessageSchema.safeParse({
        v,
        type: 'makerState',
        isTrusted: true,
        hardwareEnabled: true,
        isInteractive: true,
        machines: Array.from({ length: MAKER_PROTOCOL_MAX_ITEMS + 1 }, () => machine),
        ports: [],
      }).success,
    ).toBe(false)
    expect(
      makerMachineSummarySchema.safeParse({ ...machine, apiKey: 'not-a-credential' }).success,
    ).toBe(false)
    expect(
      makerPreviewSchema.safeParse({ kind: 'stl', title: 'Mesh', path: '/arbitrary/file' }).success,
    ).toBe(false)
  })
  it('keeps the protocol browser-safe without Node shims or engine implementation', async () => {
    const output = await build({
      entryPoints: ['src/shared/makerProtocol.ts'],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
    })
    expect(Object.keys(output.metafile.inputs).some((file) => file.startsWith('src/core/'))).toBe(
      false,
    )
    expect(output.outputFiles[0]?.text).not.toMatch(/["']node:|require\(["']vscode/)
  })
  it('matches the committed JSON Schemas', () => {
    expect(
      execFileSync(process.execPath, ['scripts/maker-schema.mjs', '--check'], { encoding: 'utf8' }),
    ).toContain('Maker schemas match.')
  })
})
