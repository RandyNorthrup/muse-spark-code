import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as vscode from 'vscode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakerApproval } from '../../src/core/maker/ports'
import { createVscodeMakerHost, type VscodeMakerDeps } from '../../src/host/maker/vscodeMakerHost'
import { MAKER_COMMANDS, MAKER_MODAL_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import type { ApprovalRequest, MakerMachineSummary } from '../../src/shared/makerProtocol'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memento } from './helpers/memento'
import { EventEmitter, FakeStatusBarItem, Uri, window, workspace } from './mocks/vscode'

const modal: (
  message: string,
  options: vscode.MessageOptions,
  ...items: vscode.MessageItem[]
) => Thenable<vscode.MessageItem | undefined> = window.showWarningMessage
const directories: string[] = []
const hosts: { dispose(): void }[] = []

function request(): ApprovalRequest {
  const payload = 'flash exact bytes'
  return {
    kind: 'command',
    id: randomUUID(),
    digest: createHash('sha256').update(payload).digest('hex'),
    target: {
      kind: 'serial',
      port: '/dev/ttyACM0',
      vid: '303a',
      pid: '1001',
      serialNumber: 'board-one',
      stablePath: '/dev/serial/by-id/board-one',
    },
    expiresAt: Date.now() + 10_000,
    action: 'program',
    payload,
  }
}
async function harness() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm103v-'))
  directories.push(root)
  const workspaceValues = new Map<string, unknown>()
  const machineValues = new Map<string, unknown>()
  const getSecret = vi
    .fn<(name: string) => Promise<string | undefined>>()
    .mockResolvedValue(undefined)
  const storeSecret = vi
    .fn<(name: string, value: string) => Promise<void>>()
    .mockResolvedValue(undefined)
  const deleteSecret = vi.fn<(name: string) => Promise<void>>().mockResolvedValue(undefined)
  const state = { hardware: true, interactive: true }
  const deps: VscodeMakerDeps = {
    context: {
      storageUri: Uri.file(path.join(root, 'workspace')),
      globalStorageUri: Uri.file(path.join(root, 'global')),
      workspaceState: {
        ...memento(workspaceValues),
        keys: () => Array.from(workspaceValues, ([key]) => key),
      },
      globalState: {
        ...memento(machineValues),
        keys: () => Array.from(machineValues, ([key]) => key),
        setKeysForSync: vi.fn(),
      },
      secrets: {
        get: getSecret,
        store: storeSecret,
        delete: deleteSecret,
        onDidChange: new EventEmitter<vscode.SecretStorageChangeEvent>().event,
      },
    },
    log: new FakeLogOutputChannel(),
    hardwareEnabled: () => state.hardware,
    isInteractive: () => state.interactive,
    stop: vi.fn<(id?: string) => Promise<void>>().mockResolvedValue(undefined),
    openPreview: vi.fn<VscodeMakerDeps['openPreview']>().mockResolvedValue(undefined),
  }
  const host = await createVscodeMakerHost(deps)
  hosts.push(host)
  return { host, deps, state, workspaceValues, machineValues, getSecret, storeSecret, deleteSecret }
}
beforeEach(() => {
  workspace.isTrusted = true
  workspace.workspaceFolders = undefined
  vi.mocked(modal).mockReset()
  window.showInformationMessage.mockReset()
  window.showErrorMessage.mockReset()
  window.createStatusBarItem.mockReset()
})
afterEach(async () => {
  for (const host of hosts.splice(0)) host.dispose()
  vi.useRealTimers()
  await Promise.all(
    directories.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  )
})

async function expectSettled(pending: Promise<unknown>): Promise<void> {
  const state = { isSettled: false }
  void pending.then(() => {
    state.isSettled = true
  })
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
  expect(state.isSettled).toBe(true)
  expect(await pending).toBeUndefined()
}

describe('VS Code maker port', () => {
  it('shows the complete target and payload and offers only Send once and Reject', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const approval = new MakerApproval(request(), () => true)
    const answer = await host.confirm(approval.request)
    const call = vi.mocked(modal).mock.calls[0]
    expect(call?.[1].modal).toBe(true)
    expect(call?.[1].detail).toContain(
      approval.request.kind === 'command' ? approval.request.payload : '',
    )
    expect(call?.[1].detail).toContain('board-one')
    expect(call?.[1].detail).toContain('303a')
    expect(call?.slice(2)).toEqual([
      { title: UI_TEXT.makerSendOnce },
      { title: UI_TEXT.makerReject, isCloseAffordance: true },
    ])
    const binding = approval.answer(answer)
    expect(binding).toBeDefined()
    if (binding === undefined) throw new Error('test binding missing')
    expect(approval.consume(binding, approval.request.target)).toBe(true)
    expect(approval.consume(binding, approval.request.target)).toBe(false)
    expect(approval.answer(answer)).toBeUndefined()
  })
  it.each(['trust', 'hardware', 'interactive', 'expiry', 'disposed'])(
    'refuses %s before any UI',
    async (kind) => {
      const { host, state } = await harness()
      const input = request()
      switch (kind) {
        case 'trust': {
          workspace.isTrusted = false
          break
        }
        case 'hardware': {
          state.hardware = false
          break
        }
        case 'interactive': {
          state.interactive = false
          break
        }
        case 'expiry': {
          Reflect.set(input, 'expiresAt', Date.now())
          break
        }
        case 'disposed': {
          {
            host.dispose()
            // No default
          }
          break
        }
      }
      expect(await host.confirm(input)).toBeUndefined()
      expect(modal).not.toHaveBeenCalled()
    },
  )
  it('keeps the displayed approval detached from caller edits and rejects another request or a swapped device', async () => {
    const { host } = await harness()
    const input = request()
    const approval = new MakerApproval(input, () => true)
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => {
      Reflect.set(input, 'digest', 'b'.repeat(64))
      Reflect.set(input.target, 'port', '/dev/ttyACM1')
      return Promise.resolve(items[0])
    })
    const answer = await host.confirm(input)
    expect(answer).toMatchObject({
      digest: approval.request.digest,
      target: approval.request.target,
    })
    const other = new MakerApproval(request(), () => true)
    expect(other.answer(answer)).toBeUndefined()
    const binding = approval.answer(answer)
    if (binding === undefined) throw new Error('test binding missing')
    expect(approval.consume(binding, { ...binding.target, port: '/dev/ttyACM1' })).toBe(false)
    expect(approval.consume(binding, binding.target)).toBe(false)
  })
  it('shows serial encoding/reset/flash identity and complete machine analysis', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    const serial: ApprovalRequest = {
      kind: 'serial',
      action: 'connect',
      id: randomUUID(),
      digest: 'a'.repeat(64),
      expiresAt: Date.now() + 10_000,
      target: { kind: 'serial', port: '/dev/ttyACM0' },
      payload: { encoding: 'hex', value: '00ff' },
      baud: 115_200,
      durationMs: 1000,
      dtr: false,
      rts: true,
      warnsAboutReset: true,
      flashIdentity: { status: 'unknown' },
    }
    await host.confirm(serial)
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain(UI_TEXT.makerResetWarning)
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain('"encoding":"hex"')
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain('00ff')
    const analysis = {
      classes: ['actuate'],
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 0, z: 0 } },
      maxFeedMmMin: 1200,
      temperatures: { extruder: 180 },
      unknown: [],
      refused: [],
      hasMotion: true,
    } as const
    const machine: ApprovalRequest = {
      kind: 'machine',
      action: 'actuate',
      id: randomUUID(),
      digest: 'a'.repeat(64),
      expiresAt: Date.now() + 10_000,
      target: {
        kind: 'machine',
        registrationId: randomUUID(),
        id: 'printer',
        name: 'Printer',
        endpoint: 'https://printer.lan',
        identity: 'printer-one',
      },
      payload: 'G1 X10',
      analysis,
    }
    await host.confirm(machine)
    expect(vi.mocked(modal).mock.calls.at(-1)?.[1].detail).toContain(
      JSON.stringify(analysis, null, 2),
    )
  })
  it.each(['trust', 'hardware', 'interactive', 'expiry'])(
    'rechecks %s after the user answers',
    async (kind) => {
      const { host, state } = await harness()
      vi.mocked(modal).mockImplementation((_message, _options, ...items) => {
        switch (kind) {
          case 'trust': {
            workspace.isTrusted = false
            break
          }
          case 'hardware': {
            state.hardware = false
            break
          }
          case 'interactive': {
            state.interactive = false
            break
          }
          case 'expiry': {
            vi.useFakeTimers()
            vi.setSystemTime(Date.now() + 10_000)

            break
          }
          // No default
        }
        return Promise.resolve(items[0])
      })
      expect(await host.confirm(request())).toBeUndefined()
    },
  )
  it('rejects close and Reject and refuses a malformed request', async () => {
    const { host } = await harness()
    vi.mocked(modal).mockResolvedValue(undefined)
    expect(await host.confirm(request())).toMatchObject({ decision: 'reject_once' })
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[1]))
    expect(await host.confirm(request())).toMatchObject({ decision: 'reject_once' })
    const input = request()
    Reflect.set(input, 'confirm', true)
    await expect(host.confirm(input)).rejects.toThrow()
  })
  it.each(['expiry', 'stop', 'dispose'])(
    'settles a pending modal on %s and ignores its late Send once',
    async (kind) => {
      const { host, deps, state } = await harness()
      vi.useFakeTimers()
      const result = Promise.withResolvers<vscode.MessageItem | undefined>()
      vi.mocked(modal).mockReturnValue(result.promise)
      const input = request()
      const pending = host.confirm(input)
      const send = vi.mocked(modal).mock.calls.at(-1)?.[2]
      switch (kind) {
        case 'expiry': {
          await vi.advanceTimersByTimeAsync(10_000)
          break
        }
        case 'stop': {
          workspace.isTrusted = false
          state.hardware = false
          state.interactive = false
          await host.stop()

          break
        }
        case 'dispose': {
          {
            host.dispose()
            // No default
          }
          break
        }
      }
      await expectSettled(pending)
      result.resolve(send)
      await Promise.resolve()
      if (kind === 'stop') expect(deps.stop).toHaveBeenCalledOnce()
    },
  )
  it('sends the complete oversized payload to the preview before asking, and cancels while opening', async () => {
    const { host, deps } = await harness()
    const input = {
      ...request(),
      kind: 'command',
      payload: 'x'.repeat(MAKER_MODAL_MAX_CHARS + 1),
    } as const
    vi.mocked(modal).mockImplementation((_message, _options, ...items) => Promise.resolve(items[0]))
    await host.confirm(input)
    expect(deps.openPreview).toHaveBeenCalledWith({
      kind: 'payload',
      title: UI_TEXT.makerPayloadLabel,
      content: input.payload,
    })
    expect(vi.mocked(deps.openPreview).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(modal).mock.invocationCallOrder[0] ?? 0,
    )
    const wait = Promise.withResolvers<undefined>()
    vi.mocked(deps.openPreview).mockReturnValue(wait.promise)
    const pending = host.confirm(input)
    await host.stop()
    await expectSettled(pending)
    wait.resolve(undefined)
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(modal).toHaveBeenCalledOnce()
  })
  it('keeps Stop visible when admission is false and hides/removes it only with no machines or disposal', async () => {
    const { host, deps, state } = await harness()
    const item = new FakeStatusBarItem()
    window.createStatusBarItem.mockReturnValue(item)
    const machine: MakerMachineSummary = {
      registrationId: randomUUID(),
      id: 'printer',
      name: 'Printer',
      kind: 'moonraker',
      category: 'printer',
      endpoint: 'https://printer.lan',
      limits: {},
    }
    state.hardware = false
    state.interactive = false
    workspace.isTrusted = false
    host.stopControls([machine])
    expect(item.visible).toBe(true)
    expect(item.command).toBe(MAKER_COMMANDS.stopMachine)
    await host.stop('printer')
    expect(deps.stop).toHaveBeenCalledWith('printer')
    host.stopControls([])
    expect(item.visible).toBe(false)
    host.stopControls([machine])
    host.dispose()
    expect(item.visible).toBe(false)
  })
  it('namespaces mementos, uses canonical outside-repository directories, and delegates secrets only', async () => {
    const { host, deps, workspaceValues, machineValues, getSecret, storeSecret, deleteSecret } =
      await harness()
    expect(host.storage.workspace.directory).toBe(await realpath(host.storage.workspace.directory))
    await host.storage.workspace.update('hardware', { enabled: true, reason: 'bench test' })
    expect(workspaceValues.get('maker.hardware')).toEqual({ enabled: true, reason: 'bench test' })
    expect(await host.storage.workspace.get('hardware')).toEqual({
      enabled: true,
      reason: 'bench test',
    })
    await host.storage.workspace.delete('hardware')
    expect(await host.storage.workspace.get('hardware')).toBeUndefined()
    await host.storage.machine.update('selected', ['printer'])
    expect(machineValues.get('maker.selected')).toEqual(['printer'])
    const value = randomUUID()
    await host.secrets.store('maker.machine.test', value)
    await host.secrets.get('maker.machine.test')
    await host.secrets.delete('maker.machine.test')
    expect(storeSecret).toHaveBeenCalledWith('maker.machine.test', value)
    expect(getSecret).toHaveBeenCalledWith('maker.machine.test')
    expect(deleteSecret).toHaveBeenCalledWith('maker.machine.test')
    await expect(
      createVscodeMakerHost({ ...deps, context: { ...deps.context, storageUri: undefined } }),
    ).rejects.toThrow(UI_TEXT.makerUnavailable)
    workspace.workspaceFolders = [
      { uri: Uri.file(path.dirname(host.storage.workspace.directory)), name: 'inside', index: 0 },
    ]
    await expect(createVscodeMakerHost(deps)).rejects.toThrow(UI_TEXT.makerUnavailable)
  })
  it('shows the physical-switch warning when an independent Stop fails', async () => {
    const { host, deps } = await harness()
    vi.mocked(deps.stop).mockRejectedValue(new Error(randomUUID()))
    await expect(host.stop()).rejects.toThrow(UI_TEXT.makerUnavailable)
    expect(window.showWarningMessage).toHaveBeenCalledWith(UI_TEXT.makerPhysicalStopRequired)
  })
  it('localizes each safety warning and validates notices and previews', async () => {
    const { host, deps } = await harness()
    for (const warning of [
      'physicalStopRequired',
      'startupMotion',
      'limitsUnavailable',
      'auditUnrecorded',
      'sentOutcomeUnknown',
    ] as const)
      await host.notify(warning)
    expect(window.showWarningMessage).toHaveBeenCalledWith(UI_TEXT.makerSentOutcomeUnknown)
    await host.notify({ type: 'makerNotice', level: 'error', message: 'safe translated text' })
    expect(window.showErrorMessage).toHaveBeenCalledWith('safe translated text')
    await host.notify({ type: 'makerNotice', level: 'info', message: 'safe info' })
    await host.notify({ type: 'makerNotice', level: 'warning', message: 'safe warning' })
    await host.notify({
      type: 'presetsOffered',
      title: 'offered',
      kinds: [],
      skillIds: [],
      presets: [],
      notices: ['notice'],
      isCircuitPyRoot: false,
      hasMachineConfig: false,
    })
    expect(window.showInformationMessage).toHaveBeenCalledWith('offered\nnotice')
    await host.openPreview({ kind: 'payload', title: 'exact', content: 'G1 X1' })
    expect(deps.openPreview).toHaveBeenCalledWith({
      kind: 'payload',
      title: 'exact',
      content: 'G1 X1',
    })
    await expect(host.openPreview({ kind: 'payload', title: '', content: '' })).rejects.toThrow()
  })
})
