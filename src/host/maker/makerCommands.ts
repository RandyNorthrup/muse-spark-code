import * as vscode from 'vscode'
import {
  MAKER_COMMANDS,
  MAKER_PROTOCOL_MAX_ID_CHARS,
  MAKER_PROTOCOL_VERSION,
  UI_TEXT,
} from '../../shared/constants'
import {
  makerSurfaceMessageSchema,
  type MakerMachineSummary,
  type MakerSurfaceMessage,
} from '../../shared/makerProtocol'
import type { VscodeMakerHost } from './vscodeMakerHost'
import type { Logger } from '../logger'

type Registration = Extract<MakerSurfaceMessage, { type: 'makerAddMachine' }>
type Removal = Extract<MakerSurfaceMessage, { type: 'makerRemoveMachine' }>
export interface MakerCommandsDeps {
  readonly host: Pick<
    VscodeMakerHost,
    'isTrusted' | 'isInteractive' | 'notify' | 'cancelApprovals' | 'stop'
  >
  readonly log: Logger
  /** G4's latch and audit; persists through host.storage.workspace, never settings. */
  readonly changeHardware: (isEnabled: boolean, reason?: string) => Promise<void>
  readonly listMachines: () => Promise<readonly MakerMachineSummary[]>
  /** Portable registry; key stays in memory until it reaches host.secrets. */
  readonly registerMachine: (message: Registration, key: string | undefined) => Promise<void>
  /** Captured appkeys flow: Read-only Access first; never paste an OctoPrint key. */
  readonly registerOctoprintReadOnly: (message: Registration) => Promise<void>
  readonly removeMachine: (message: Removal) => Promise<void>
  /** U's shared device wizard and explicit scrubbed log view. */
  readonly openDevices: () => Promise<void>
  readonly openDeviceLog: () => Promise<void>
}

function isAttended(host: MakerCommandsDeps['host']): boolean {
  return host.isTrusted() && host.isInteractive()
}

/** Host-owned UI: no tool arguments can enable hardware or carry a credential. */
export class MakerCommands implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[]
  constructor(private readonly deps: MakerCommandsDeps) {
    const handlers: readonly (readonly [string, () => Promise<void>])[] = [
      [MAKER_COMMANDS.enableHardware, () => this.enableHardware()],
      [
        MAKER_COMMANDS.disableHardware,
        async () => {
          deps.host.cancelApprovals()
          await deps.changeHardware(false)
        },
      ],
      [
        MAKER_COMMANDS.addMachine,
        async () => {
          if (isAttended(deps.host)) await deps.openDevices()
        },
      ],
      [MAKER_COMMANDS.removeMachine, () => this.removeMachine()],
      [
        MAKER_COMMANDS.stopMachine,
        async () => {
          await deps.host.stop()
        },
      ],
      [
        MAKER_COMMANDS.openDeviceLog,
        async () => {
          await deps.openDeviceLog()
        },
      ],
    ]
    this.subscriptions = handlers.map(([name, handler]) =>
      vscode.commands.registerCommand(name, async () => {
        try {
          await handler()
        } catch {
          deps.log.error('Maker command failed')
          await vscode.window.showErrorMessage(UI_TEXT.makerUnavailable)
        }
      }),
    )
  }
  async enableHardware(): Promise<void> {
    if (!isAttended(this.deps.host)) {
      await this.deps.host.notify({
        type: 'makerNotice',
        level: 'warning',
        message: this.deps.host.isTrusted()
          ? UI_TEXT.makerUnattendedDenied
          : UI_TEXT.makerTrustRequired,
      })
      return
    }
    const reason = await vscode.window.showInputBox({
      prompt: UI_TEXT.makerHardwareReason,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length === 0 || value.trim().length > MAKER_PROTOCOL_MAX_ID_CHARS
          ? UI_TEXT.makerHardwareReason
          : undefined,
    })
    if (reason === undefined || !isAttended(this.deps.host)) return
    const message = makerSurfaceMessageSchema.parse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerHardware',
      enabled: true,
      reason,
    })
    if (message.type !== 'makerHardware') return
    await this.deps.changeHardware(true, message.reason)
  }
  async addMachine(raw: unknown): Promise<void> {
    const message = makerSurfaceMessageSchema.parse(raw)
    if (message.type !== 'makerAddMachine' || !isAttended(this.deps.host)) return
    const text = [
      JSON.stringify(message.machine, null, 2),
      ...(message.allowPlainHttp ? [UI_TEXT.makerPlainHttpWarning] : []),
    ].join('\n\n')
    const chosen = await vscode.window.showWarningMessage(
      UI_TEXT.makerAddMachine,
      { modal: true, detail: text },
      UI_TEXT.makerAddMachine,
      UI_TEXT.makerReject,
    )
    if (chosen !== UI_TEXT.makerAddMachine || !isAttended(this.deps.host)) return
    if (message.machine.kind === 'octoprint') {
      await this.deps.registerOctoprintReadOnly(message)
      return
    }
    const credential = {
      value: await vscode.window.showInputBox({
        prompt: UI_TEXT.makerMachineKeyPrompt,
        password: true,
        ignoreFocusOut: true,
      }),
    }
    try {
      if (credential.value === undefined || !isAttended(this.deps.host)) return
      await this.deps.registerMachine(
        message,
        credential.value === '' ? undefined : credential.value,
      )
    } finally {
      credential.value = undefined
    }
  }
  async removeMachine(): Promise<void> {
    if (!isAttended(this.deps.host)) return
    const machines = await this.deps.listMachines()
    const selected = await vscode.window.showQuickPick(
      machines.map((machine) => ({ label: machine.name, description: machine.endpoint, machine })),
      { title: UI_TEXT.makerRemoveMachine },
    )
    if (selected === undefined || !isAttended(this.deps.host)) return
    const chosen = await vscode.window.showWarningMessage(
      UI_TEXT.makerRemoveMachine,
      { modal: true, detail: `${selected.machine.name} (${selected.machine.id})` },
      UI_TEXT.makerRemoveMachine,
      UI_TEXT.makerReject,
    )
    if (chosen !== UI_TEXT.makerRemoveMachine || !isAttended(this.deps.host)) return
    const message = makerSurfaceMessageSchema.parse({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerRemoveMachine',
      registrationId: selected.machine.registrationId,
      machineId: selected.machine.id,
    })
    if (message.type === 'makerRemoveMachine') await this.deps.removeMachine(message)
  }
  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose()
  }
}
