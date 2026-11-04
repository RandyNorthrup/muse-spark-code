import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MakerEngine } from '../../src/host/maker/makerEngine'
import type { ApprovalRequest, MakerSecrets, MakerStorage } from '../../src/core/maker/ports'
import { machineSecretName, type MakerLanPolicy } from '../../src/core/maker/registry'
import { UI_TEXT } from '../../src/shared/constants'
import {
  makerHostMessageSchema,
  makerSurfaceMessageSchema,
  type MakerNotice,
} from '../../src/shared/makerProtocol'
import { machineSimulator, makerLimits } from './helpers/makerMachineSimulator'
import { makerTempRoot, makePrivateFolder, runtimeMakerNative } from './helpers/makerTemp'
import { allowOnceConfirm } from '../e2e/helpers/makerEmulators'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const lan: MakerLanPolicy = {
  classify: () => 'private',
  resolve: () => Promise.resolve(['127.0.0.1']),
}

function mapStorage(directory: string): MakerStorage & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>()
  return {
    values,
    directory,
    get: (key) => Promise.resolve(values.get(key)),
    update: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

interface EngineHarness {
  engine: MakerEngine
  confirms: ApprovalRequest[]
  notices: MakerNotice[]
  cancels: { count: number }
  controls: { count: number }
  dialogs: string[]
  errors: string[]
  secrets: MakerSecrets & { values: Map<string, string> }
  storage: { workspace: ReturnType<typeof mapStorage>; machine: ReturnType<typeof mapStorage> }
  trusted: { value: boolean }
  interactive: { value: boolean }
}

async function harness(options?: {
  trusted?: boolean
  interactive?: boolean
  workspaceRoot?: string | undefined
}): Promise<EngineHarness> {
  const root = await mkdtemp(path.join(makerTempRoot(), 'mwe-'))
  roots.push(root)
  const machineDirectory = path.join(root, 'data', 'maker')
  const workspaceDirectory = path.join(root, 'ws', 'maker')
  await mkdir(machineDirectory, { recursive: true })
  await mkdir(workspaceDirectory, { recursive: true })
  await makePrivateFolder(path.join(machineDirectory, 'leases'))
  const workspace = options?.workspaceRoot === undefined ? path.join(root, 'folder') : undefined
  if (workspace !== undefined) await mkdir(workspace, { recursive: true })
  const storage = {
    workspace: mapStorage(workspaceDirectory),
    machine: mapStorage(machineDirectory),
  }
  const secretValues = new Map<string, string>()
  const secrets: EngineHarness['secrets'] = {
    values: secretValues,
    get: (name) => Promise.resolve(secretValues.get(name)),
    store: (name, value) => {
      secretValues.set(name, value)
      return Promise.resolve()
    },
    delete: (name) => {
      secretValues.delete(name)
      return Promise.resolve()
    },
  }
  const confirms: ApprovalRequest[] = []
  const notices: MakerNotice[] = []
  const controls = { count: 0 }
  const dialogs: string[] = []
  const cancels = { count: 0 }
  const trusted = { value: options?.trusted ?? true }
  const interactive = { value: options?.interactive ?? true }
  const holder: { engine?: MakerEngine } = {}
  const errors: string[] = []
  const quiet = {
    trace: (line: string) => {
      errors.push(line)
    },
    info: (line: string) => {
      errors.push(line)
    },
    warn: (line: string) => {
      errors.push(line)
    },
    error: (line: string) => {
      errors.push(line)
    },
  }
  const native = runtimeMakerNative()
  const made = await MakerEngine.create({
    storage,
    secrets,
    host: {
      isTrusted: () => trusted.value,
      hardwareEnabled: () => holder.engine?.isHardwareEnabled() ?? false,
      isInteractive: () => interactive.value,
      confirm: (request, review) => {
        confirms.push(request)
        return allowOnceConfirm(request, review)
      },
      notify: (notice) => {
        notices.push(notice)
        return Promise.resolve()
      },
      stopControls: () => {
        controls.count += 1
        return Promise.resolve()
      },
      cancelApprovals: () => {
        cancels.count += 1
      },
      openPreview: () => Promise.resolve(),
      storage,
      secrets,
    },
    log: quiet,
    platform: native.platform,
    env: native.env,
    packageRoot: native.packageRoot,
    dataDirectory: path.join(root, 'data'),
    workspaceRoot: workspace,
    lan,
    openAuthDialog: (url) => {
      dialogs.push(url)
      return Promise.resolve()
    },
  })
  holder.engine = made
  closers.push(() => made.close())
  return {
    engine: made,
    errors,
    confirms,
    notices,
    cancels,
    controls,
    dialogs,
    secrets,
    storage,
    trusted,
    interactive,
  }
}

function registration(endpoint: string, limits: unknown = {}) {
  return makerSurfaceMessageSchema.parse({
    v: 1,
    type: 'makerAddMachine',
    machine: {
      id: 'printer',
      name: 'Bench printer',
      kind: 'moonraker',
      category: 'printer',
      endpoint,
      limits,
    },
    allowPlainHttp: true,
  })
}

async function registerPrinter(
  fixture: EngineHarness,
  server: Pick<Awaited<ReturnType<typeof machineSimulator>>, 'endpoint'>,
  key: string | undefined,
): Promise<void> {
  const message = registration(server.endpoint)
  if (message.type !== 'makerAddMachine') throw new Error('registration misparsed')
  await fixture.engine.registerMachine(message, key)
}

function expectLastNotice(fixture: EngineHarness, message: string): void {
  expect(fixture.notices.at(-1)).toEqual({ type: 'makerNotice', level: 'warning', message })
}

function statusMessage(machineId: string) {
  const message = makerSurfaceMessageSchema.parse({ v: 1, type: 'makerStatus', machineId })
  if (message.type !== 'makerStatus') throw new Error('status misparsed')
  return message
}

function sendMessage(machineId: string, payload: string) {
  const message = makerSurfaceMessageSchema.parse({
    v: 1,
    type: 'makerSend',
    id: randomUUID(),
    machineId,
    payload,
  })
  if (message.type !== 'makerSend') throw new Error('send misparsed')
  return message
}

function octoprintRegistration(endpoint: string) {
  return makerSurfaceMessageSchema.parse({
    v: 1,
    type: 'makerAddMachine',
    machine: {
      id: 'octo',
      name: 'OctoPrint',
      kind: 'octoprint',
      category: 'printer',
      endpoint,
      limits: {},
    },
    allowPlainHttp: true,
  })
}

describe('window maker engine latch', () => {
  it('enables with an audited reason, persists, then disables', async () => {
    const fixture = await harness()
    await fixture.engine.setHardware(true, 'supervised bench')
    expect(fixture.engine.isHardwareEnabled()).toBe(true)
    expect(await fixture.storage.workspace.get('hardware')).toMatchObject({
      enabled: true,
      reason: 'supervised bench',
    })
    const entries = await fixture.engine.readDeviceLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ machine: 'workspace', action: 'observe', outcome: 'sent' })
    expect(entries[0]?.payload).toContain('supervised bench')
    await fixture.engine.setHardware(false)
    expect(fixture.engine.isHardwareEnabled()).toBe(false)
    expect(await fixture.storage.workspace.get('hardware')).toBe(undefined)
    expect(fixture.cancels.count).toBeGreaterThan(0)
  })
  it('refuses enabling while untrusted, unattended or without a reason', async () => {
    const fixture = await harness()
    fixture.trusted.value = false
    await expect(fixture.engine.setHardware(true, 'x')).rejects.toThrow(UI_TEXT.makerTrustRequired)
    fixture.trusted.value = true
    fixture.interactive.value = false
    await expect(fixture.engine.setHardware(true, 'x')).rejects.toThrow(
      UI_TEXT.makerUnattendedDenied,
    )
    fixture.interactive.value = true
    await expect(fixture.engine.setHardware(true, '  ')).rejects.toThrow(
      UI_TEXT.makerHardwareReason,
    )
    expect(fixture.engine.isHardwareEnabled()).toBe(false)
    expect(await fixture.engine.readDeviceLog()).toHaveLength(0)
  })
  it('restores the latch on creation and audits without a folder open', async () => {
    const fixture = await harness()
    await fixture.engine.setHardware(true, 'bench')
    const secondLog: string[] = []
    const record = (line: string) => {
      secondLog.push(line)
    }
    const again = await MakerEngine.create({
      storage: fixture.storage,
      secrets: fixture.secrets,
      host: {
        isTrusted: () => true,
        hardwareEnabled: () => false,
        isInteractive: () => true,
        confirm: () => Promise.resolve(undefined),
        notify: () => Promise.resolve(),
        stopControls: () => Promise.resolve(),
        openPreview: () => Promise.resolve(),
        storage: fixture.storage,
        secrets: fixture.secrets,
        cancelApprovals: () => {
          secondLog.push('cancelled')
        },
      },
      log: { trace: record, info: record, warn: record, error: record },
      platform: process.platform,
      env: process.env,
      packageRoot: runtimeMakerNative().packageRoot,
      dataDirectory: path.join(path.dirname(fixture.storage.machine.directory)),
      workspaceRoot: undefined,
      lan,
      openAuthDialog: () => Promise.resolve(),
    })
    closers.push(() => again.close())
    expect(again.isHardwareEnabled()).toBe(true)
    expect(secondLog).toEqual([])
  })
})

describe('window maker engine registry', () => {
  it('registers, lists and removes a machine, and says the add', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    await registerPrinter(fixture, server, 'pasted-key')
    const machines = await fixture.engine.listMachines()
    expect(machines).toHaveLength(1)
    expect(machines[0]).toMatchObject({ id: 'printer', endpoint: server.endpoint })
    expect(await fixture.secrets.get(machineSecretName(machines[0]?.registrationId ?? ''))).toBe(
      'pasted-key',
    )
    expect(fixture.notices).toContainEqual({
      type: 'makerNotice',
      level: 'info',
      message: 'Added machine Bench printer.',
    })
    const removal = makerSurfaceMessageSchema.parse({
      v: 1,
      type: 'makerRemoveMachine',
      registrationId: randomUUID(),
      machineId: 'printer',
    })
    if (removal.type !== 'makerRemoveMachine') throw new Error('removal misparsed')
    await expect(fixture.engine.removeMachine(removal)).rejects.toThrow('machineTargetChanged')
    const agreed = makerSurfaceMessageSchema.parse({
      v: 1,
      type: 'makerRemoveMachine',
      registrationId: machines[0]?.registrationId ?? '',
      machineId: 'printer',
    })
    if (agreed.type !== 'makerRemoveMachine') throw new Error('removal misparsed')
    await fixture.engine.removeMachine(agreed)
    expect(await fixture.engine.listMachines()).toHaveLength(0)
    expect(await fixture.secrets.get(machineSecretName(machines[0]?.registrationId ?? ''))).toBe(
      undefined,
    )
  })
  it('refuses registry writes while unattended', async () => {
    const fixture = await harness({ interactive: false })
    const message = registration('http://127.0.0.1:9')
    if (message.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await expect(fixture.engine.registerMachine(message, undefined)).rejects.toThrow(
      UI_TEXT.makerUnattendedDenied,
    )
    expect(await fixture.engine.listMachines()).toHaveLength(0)
  })
})

describe('window maker engine OctoPrint enrollment', () => {
  it('registers a granted key without ever sending one, and opens its dialog', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    const message = octoprintRegistration(server.endpoint)
    if (message.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerOctoprintReadOnly(message)
    const machines = await fixture.engine.listMachines()
    expect(machines).toHaveLength(1)
    expect(await fixture.secrets.get(machineSecretName(machines[0]?.registrationId ?? ''))).toBe(
      'sim-issued-key',
    )
    expect(fixture.dialogs).toEqual([`${server.endpoint}/auth/sim`])
    expect(server.requests.every((request) => !request.hasKey)).toBe(true)
    expect(fixture.notices.at(-1)).toMatchObject({ level: 'info' })
  })
  it('says denied and unsupported, and registers nothing', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    server.setAppkeysDecision('denied')
    const denied = octoprintRegistration(server.endpoint)
    if (denied.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerOctoprintReadOnly(denied)
    expect(await fixture.engine.listMachines()).toHaveLength(0)
    expectLastNotice(fixture, UI_TEXT.makerAppKeysDenied)
    server.setAppkeysDecision('granted')
    server.setAppkeysProbe(false)
    await fixture.engine.registerOctoprintReadOnly(denied)
    expect(await fixture.engine.listMachines()).toHaveLength(0)
    expectLastNotice(fixture, UI_TEXT.makerAppKeysUnsupported)
  })
  it('refuses a cross-origin auth dialog before the first poll', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    server.setAppkeysDialog('http://127.0.0.1:9/auth/evil')
    const message = octoprintRegistration(server.endpoint)
    if (message.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await expect(fixture.engine.registerOctoprintReadOnly(message)).rejects.toThrow(
      'machineResponse',
    )
    expect(fixture.dialogs).toEqual([])
    expect(
      server.requests.some((request) => request.path.startsWith('/plugin/appkeys/request/')),
    ).toBe(false)
    expect(await fixture.engine.listMachines()).toHaveLength(0)
  })
})

describe('window maker engine tools', () => {
  it('reads status from a registered machine', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    const message = registration(server.endpoint, makerLimits)
    if (message.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerMachine(message, undefined)
    await fixture.engine.setHardware(true, 'bench')
    const status = makerHostMessageSchema.parse(
      await fixture.engine.action(statusMessage('printer'), new AbortController().signal),
    )
    if (status.type !== 'makerStatus') throw new Error('status misparsed')
    expect(status.machineId).toBe('printer')
    expect(server.requests.some((request) => request.path === '/printer/info')).toBe(true)
  })
  it('sends an approved move and audits it, and refuses send without limits', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    const limited = registration(server.endpoint, makerLimits)
    if (limited.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerMachine(limited, undefined)
    await fixture.engine.setHardware(true, 'bench')
    await fixture.engine.action(statusMessage('printer'), new AbortController().signal)
    const sent = makerHostMessageSchema.parse(
      await fixture.engine.action(sendMessage('printer', 'G1 X20'), new AbortController().signal),
    )
    if (sent.type !== 'makerResult') throw new Error('send misparsed')
    expect(sent.outcome).toBe('sent')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(true)
    expect(fixture.confirms).toHaveLength(1)
    const logged = await fixture.engine.readDeviceLog()
    expect(logged.some((entry) => entry.action === 'actuate' && entry.outcome === 'sent')).toBe(
      true,
    )
    const unlimited = makerSurfaceMessageSchema.parse({
      v: 1,
      type: 'makerAddMachine',
      machine: {
        id: 'bare',
        name: 'Bare',
        kind: 'moonraker',
        category: 'printer',
        endpoint: server.endpoint,
        limits: {},
      },
      allowPlainHttp: true,
    })
    if (unlimited.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerMachine(unlimited, undefined)
    await expect(
      fixture.engine.action(sendMessage('bare', 'G1 X30'), new AbortController().signal),
    ).rejects.toThrow()
  })
  it('lists state with machines while enabled, and refuses while disabled or untrusted', async ({
    onTestFailed,
  }) => {
    // What this case waited on, for a log: it passed 15 s on three hosted runs (CC-INT11FIX5).
    const started = performance.now()
    const reached: string[] = []
    const reach = (step: string) => {
      reached.push(`${step} at ${String(Math.round(performance.now() - started))} ms`)
    }
    onTestFailed(() => {
      console.error(`makerWindowEngine case reached: ${reached.join(', ')}`)
    })
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    await registerPrinter(fixture, server, undefined)
    reach('registered')
    const off = makerHostMessageSchema.parse(await fixture.engine.listDevices())
    reach('listed with hardware off')
    if (off.type !== 'makerState') throw new Error('state misparsed')
    expect(off.hardwareEnabled).toBe(false)
    expect(off.machines).toHaveLength(1)
    expect(off.ports).toEqual([])
    await fixture.engine.setHardware(true, 'bench')
    reach('hardware on')
    const on = makerHostMessageSchema.parse(await fixture.engine.listDevices())
    reach('listed the ports')
    if (on.type !== 'makerState') throw new Error('state misparsed')
    expect(on.hardwareEnabled).toBe(true)
    expect(on.machines).toHaveLength(1)
    expect(Array.isArray(on.ports)).toBe(true)
    await fixture.engine.setHardware(false)
    reach('hardware off')
    await expect(
      fixture.engine.action(statusMessage('printer'), new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.makerHardwareDisabled)
    fixture.trusted.value = false
    await expect(
      fixture.engine.action(statusMessage('printer'), new AbortController().signal),
    ).rejects.toThrow(UI_TEXT.makerTrustRequired)
    fixture.trusted.value = true
  })
  it('refuses status for an unknown machine', async () => {
    const fixture = await harness()
    await fixture.engine.setHardware(true, 'bench')
    await expect(
      fixture.engine.action(statusMessage('ghost'), new AbortController().signal),
    ).rejects.toThrow('unregisteredMachine')
  })
})

describe('window maker engine Stop', () => {
  it('stops a registered machine for real, and resolves with none', async () => {
    const fixture = await harness()
    await fixture.engine.stop()
    const server = await machineSimulator()
    closers.push(server.close)
    await registerPrinter(fixture, server, undefined)
    await fixture.engine.stop('printer')
    expect(server.requests.some((request) => request.path === '/printer/emergency_stop')).toBe(true)
    await fixture.engine.stop()
    expect(fixture.cancels.count).toBeGreaterThan(0)
  })
  it('says when a machine needs its physical stop, and names a failed one', async () => {
    const fixture = await harness()
    const server = await machineSimulator()
    closers.push(server.close)
    const link = makerSurfaceMessageSchema.parse({
      v: 1,
      type: 'makerAddMachine',
      machine: {
        id: 'prusa',
        name: 'Prusa',
        kind: 'prusalink',
        category: 'printer',
        endpoint: server.endpoint,
        limits: {},
      },
      allowPlainHttp: true,
    })
    if (link.type !== 'makerAddMachine') throw new Error('registration misparsed')
    await fixture.engine.registerMachine(link, undefined)
    await fixture.engine.stop('prusa')
    expect(fixture.notices.at(-1)).toMatchObject({ level: 'warning' })
    await registerPrinter(fixture, server, undefined)
    server.reply({ status: 500, body: 'broken' })
    await expect(fixture.engine.stop('printer')).rejects.toThrow('Bench printer')
    server.reply(undefined)
  })
})
