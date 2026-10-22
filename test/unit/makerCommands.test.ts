import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MakerCommands, type MakerCommandsDeps } from '../../src/host/maker/makerCommands'
import { MAKER_COMMANDS, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { confirmModal, pickOne } from './helpers/vscodeViews'
import { commands, window } from './mocks/vscode'

const machine = {
  registrationId: randomUUID(),
  id: 'printer',
  name: 'Bench printer',
  kind: 'moonraker',
  category: 'printer',
  endpoint: 'https://printer.lan',
  limits: {},
} as const
function registration() {
  const { registrationId: _id, ...record } = machine
  return { v: 1, type: 'makerAddMachine', machine: record, allowPlainHttp: true } as const
}
const instances: MakerCommands[] = []
function harness() {
  const state = { isTrusted: true, isInteractive: true }
  const deps: MakerCommandsDeps = {
    host: {
      isTrusted: () => state.isTrusted,
      isInteractive: () => state.isInteractive,
      notify: vi.fn<MakerCommandsDeps['host']['notify']>().mockResolvedValue(undefined),
      cancelApprovals: vi.fn(),
      stop: vi.fn<MakerCommandsDeps['host']['stop']>().mockResolvedValue(undefined),
    },
    log: new FakeLogOutputChannel(),
    changeHardware: vi.fn<MakerCommandsDeps['changeHardware']>().mockResolvedValue(undefined),
    listMachines: vi.fn<MakerCommandsDeps['listMachines']>().mockResolvedValue([machine]),
    registerMachine: vi.fn<MakerCommandsDeps['registerMachine']>().mockResolvedValue(undefined),
    registerOctoprintReadOnly: vi
      .fn<MakerCommandsDeps['registerOctoprintReadOnly']>()
      .mockResolvedValue(undefined),
    removeMachine: vi.fn<MakerCommandsDeps['removeMachine']>().mockResolvedValue(undefined),
    openDevices: vi.fn<MakerCommandsDeps['openDevices']>().mockResolvedValue(undefined),
    openDeviceLog: vi.fn<MakerCommandsDeps['openDeviceLog']>().mockResolvedValue(undefined),
  }
  const adapter = new MakerCommands(deps)
  instances.push(adapter)
  return { adapter, deps, state }
}
async function run(name: string, ...args: unknown[]): Promise<void> {
  const callback = commands.registerCommand.mock.calls.find((call) => call[0] === name)?.[1]
  if (callback === undefined) throw new Error('missing command')
  await callback(...args)
}
beforeEach(() => {
  commands.registerCommand.mockReset()
  commands.registerCommand.mockImplementation(() => ({ dispose: vi.fn() }))
  window.showInputBox.mockReset()
  vi.mocked(confirmModal).mockReset()
  vi.mocked(pickOne).mockReset()
  window.showErrorMessage.mockReset()
})
afterEach(() => {
  for (const adapter of instances.splice(0)) adapter.dispose()
})

describe('maker host-owned commands', () => {
  it('enables only with a native typed reason, through the guard port, ignoring command arguments', async () => {
    const { deps } = harness()
    window.showInputBox.mockResolvedValue('  bench test  ')
    await run(MAKER_COMMANDS.enableHardware, { reason: 'model reason', confirm: true })
    expect(deps.changeHardware).toHaveBeenCalledWith(true, 'bench test')
    const validate = window.showInputBox.mock.calls[0]?.[0]?.validateInput
    expect(validate?.(' ')).toBe(UI_TEXT.makerHardwareReason)
    expect(validate?.('x'.repeat(257))).toBe(UI_TEXT.makerHardwareReason)
    expect(validate?.('bench')).toBeUndefined()
  })
  it.each(['trust', 'interactive', 'cancel', 'blank', 'late-trust', 'late-interactive'])(
    'refuses hardware enable for %s',
    async (kind) => {
      const { deps, state } = harness()
      if (kind === 'trust') state.isTrusted = false
      else if (kind === 'interactive') state.isInteractive = false
      window.showInputBox.mockImplementation(() => {
        if (kind === 'late-trust') state.isTrusted = false
        else if (kind === 'late-interactive') state.isInteractive = false
        const value = kind === 'blank' ? ' ' : 'bench'
        return Promise.resolve(kind === 'cancel' ? undefined : value)
      })
      await run(MAKER_COMMANDS.enableHardware)
      expect(deps.changeHardware).not.toHaveBeenCalled()
    },
  )
  it('disables and stops independently of admission; Stop cancels native approval before the engine', async () => {
    const { deps, state } = harness()
    state.isTrusted = false
    state.isInteractive = false
    await run(MAKER_COMMANDS.disableHardware)
    expect(deps.changeHardware).toHaveBeenCalledWith(false)
    await run(MAKER_COMMANDS.stopMachine, { payload: 'G1 X100' })
    expect(deps.host.stop).toHaveBeenCalledWith()
    expect(deps.host.cancelApprovals).toHaveBeenCalledOnce()
  })
  it('opens the shared machine wizard and explicit local log and disposes every registration', async () => {
    const { adapter, deps } = harness()
    await run(MAKER_COMMANDS.addMachine)
    await run(MAKER_COMMANDS.openDeviceLog)
    expect(deps.openDevices).toHaveBeenCalledOnce()
    expect(deps.openDeviceLog).toHaveBeenCalledOnce()
    adapter.dispose()
    expect(commands.registerCommand).toHaveBeenCalledTimes(6)
  })
  it('shows LAN plaintext warning and collects a key privately, never from a surface', async () => {
    const { adapter, deps } = harness()
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.makerAddMachine)
    const key = randomUUID()
    window.showInputBox.mockResolvedValue(key)
    await adapter.addMachine(registration())
    expect(vi.mocked(confirmModal).mock.calls[0]?.[1].detail).toContain(
      UI_TEXT.makerPlainHttpWarning,
    )
    expect(window.showInputBox).toHaveBeenCalledWith({
      prompt: UI_TEXT.makerMachineKeyPrompt,
      password: true,
      ignoreFocusOut: true,
    })
    expect(deps.registerMachine).toHaveBeenCalledWith(registration(), key)
    await expect(adapter.addMachine({ ...registration(), key })).rejects.toThrow()
    expect(deps.registerMachine).toHaveBeenCalledOnce()
    expect(deps.log.error).not.toHaveBeenCalled()
  })
  it('uses OctoPrint’s Read-only Access appkeys flow without a password input', async () => {
    const { adapter, deps } = harness()
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.makerAddMachine)
    const message = { ...registration(), machine: { ...registration().machine, kind: 'octoprint' } }
    await adapter.addMachine(message)
    expect(deps.registerOctoprintReadOnly).toHaveBeenCalledWith(message)
    expect(window.showInputBox).not.toHaveBeenCalled()
    expect(deps.registerMachine).not.toHaveBeenCalled()
  })
  it.each([
    'trust',
    'interactive',
    'reject',
    'close',
    'cancel-key',
    'late-trust',
    'late-interactive',
    'empty-key',
  ])('handles registration %s without an unapproved credential write', async (kind) => {
    const { adapter, deps, state } = harness()
    if (kind === 'trust') state.isTrusted = false
    else if (kind === 'interactive') state.isInteractive = false
    const choice = kind === 'reject' ? UI_TEXT.makerReject : UI_TEXT.makerAddMachine
    vi.mocked(confirmModal).mockResolvedValue(kind === 'close' ? undefined : choice)
    window.showInputBox.mockImplementation(() => {
      if (kind === 'late-trust') state.isTrusted = false
      else if (kind === 'late-interactive') state.isInteractive = false
      return Promise.resolve(kind === 'cancel-key' ? undefined : '')
    })
    await adapter.addMachine(registration())
    if (kind === 'empty-key')
      expect(deps.registerMachine).toHaveBeenCalledWith(registration(), undefined)
    else expect(deps.registerMachine).not.toHaveBeenCalled()
  })
  it('removes only the selected immutable registration after native confirmation', async () => {
    const { adapter, deps } = harness()
    vi.mocked(pickOne).mockImplementation((items) => Promise.resolve(items[0]))
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.makerRemoveMachine)
    await adapter.removeMachine()
    expect(deps.removeMachine).toHaveBeenCalledWith({
      v: 1,
      type: 'makerRemoveMachine',
      machineId: machine.id,
      registrationId: machine.registrationId,
    })
  })
  it.each(['trust', 'interactive', 'cancel', 'reject', 'late-trust'])(
    'refuses machine removal for %s',
    async (kind) => {
      const { adapter, deps, state } = harness()
      if (kind === 'trust') state.isTrusted = false
      else if (kind === 'interactive') state.isInteractive = false
      vi.mocked(pickOne).mockImplementation((items) =>
        Promise.resolve(kind === 'cancel' ? undefined : items[0]),
      )
      vi.mocked(confirmModal).mockImplementation(() => {
        if (kind === 'late-trust') state.isTrusted = false
        return Promise.resolve(kind === 'reject' ? UI_TEXT.makerReject : UI_TEXT.makerRemoveMachine)
      })
      await adapter.removeMachine()
      expect(deps.removeMachine).not.toHaveBeenCalled()
    },
  )
  it('reports failures with fixed text so a credential in an exception never reaches logs', async () => {
    const { deps } = harness()
    const privateValue = randomUUID()
    vi.mocked(deps.openDeviceLog).mockRejectedValue(new Error(privateValue))
    await run(MAKER_COMMANDS.openDeviceLog)
    expect(deps.log.error).toHaveBeenCalledWith('Maker command failed')
    expect(window.showErrorMessage).toHaveBeenCalledWith(UI_TEXT.makerUnavailable)
  })
})
