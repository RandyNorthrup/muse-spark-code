// The window's native maker pickers (RLF-M103WIRE): the Devices list with
// its Add flow, the scrubbed device log as a read-only document, and the
// OctoPrint auth-dialog opener. Runs in dist/makerHost.js; the engine stays
// portable behind callback deps, and the Add flow funnels through
// MakerCommands.addMachine so the exact-payload modal review is shared with
// the panel wizard when it arrives.
import * as vscode from 'vscode'
import type { DeviceLogEntry } from '../../../core/maker/deviceLog'
import type { SerialIdentity } from '../../../core/maker/serial/identity'
import { MAKER_PROTOCOL_VERSION, UI_TEXT } from '../../../shared/constants'
import { makerSurfaceMessageSchema, type MakerMachineSummary } from '../../../shared/makerProtocol'

export interface MakerDevicesDeps {
  readonly listMachines: () => Promise<readonly MakerMachineSummary[]>
  readonly listPorts: () => Promise<readonly SerialIdentity[]>
  /** MakerCommands.addMachine: the modal confirm and key prompt stay shared. */
  readonly addMachine: (message: unknown) => Promise<void>
  readonly readDeviceLog: () => Promise<readonly DeviceLogEntry[]>
}

/** Mirrors machineRecordSchema's id rule; the registry re-validates authoritatively. */
const MACHINE_ID_PATTERN = /^[\w-]+$/

type MachineKind = MakerMachineSummary['kind']
type MachineCategory = MakerMachineSummary['category']
const KINDS: readonly MachineKind[] = [
  'moonraker',
  'octoprint',
  'prusalink',
  'grbl',
  'fluidnc',
  'marlin',
]
// The registry refuses grbl/fluidnc printers; the print hosts serve printers.
const CATEGORIES_FOR_KIND: Readonly<Record<MachineKind, readonly MachineCategory[]>> = {
  moonraker: ['printer'],
  octoprint: ['printer'],
  prusalink: ['printer'],
  grbl: ['cnc', 'laser', 'robot'],
  fluidnc: ['cnc', 'laser', 'robot'],
  marlin: ['printer', 'cnc', 'laser', 'robot'],
}
const HTTP_KINDS: ReadonlySet<MachineKind> = new Set(['moonraker', 'octoprint', 'prusalink'])

function isHttpEndpoint(kind: MachineKind, endpoint: string): boolean {
  if (!HTTP_KINDS.has(kind)) return endpoint.trim().length > 0
  try {
    const url = new URL(endpoint.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error
    return false
  }
}

async function pickKind(): Promise<MachineKind | undefined> {
  const chosen = await vscode.window.showQuickPick(
    KINDS.map((kind) => ({ label: kind, value: kind })),
    { title: UI_TEXT.makerKind },
  )
  return chosen?.value
}

async function pickCategory(kind: MachineKind): Promise<MachineCategory | undefined> {
  const categories = CATEGORIES_FOR_KIND[kind]
  if (categories.length === 1) return categories[0]
  const chosen = await vscode.window.showQuickPick(
    categories.map((category) => ({ label: category, value: category })),
    { title: UI_TEXT.makerCategory },
  )
  return chosen?.value
}

async function addMachineFlow(deps: MakerDevicesDeps): Promise<void> {
  const kind = await pickKind()
  if (kind === undefined) return
  const category = await pickCategory(kind)
  if (category === undefined) return
  const name = await vscode.window.showInputBox({
    prompt: UI_TEXT.makerMachineNamePrompt,
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim().length === 0 ? UI_TEXT.makerMachineNamePrompt : undefined,
  })
  if (name === undefined) return
  const id = await vscode.window.showInputBox({
    prompt: UI_TEXT.makerMachineIdPrompt,
    ignoreFocusOut: true,
    validateInput: (value) =>
      MACHINE_ID_PATTERN.test(value.trim()) ? undefined : UI_TEXT.makerMachineIdPrompt,
  })
  if (id === undefined) return
  const endpoint = await vscode.window.showInputBox({
    prompt: UI_TEXT.makerMachineEndpointPrompt,
    ignoreFocusOut: true,
    validateInput: (value) =>
      isHttpEndpoint(kind, value) ? undefined : UI_TEXT.makerMachineEndpointPrompt,
  })
  if (endpoint === undefined) return
  const trimmed = endpoint.trim()
  // Plain HTTP needs the person's explicit word, beside the key warning.
  let isPlainHttpAllowed = false
  if (trimmed.toLowerCase().startsWith('http://')) {
    const chosen = await vscode.window.showWarningMessage(
      UI_TEXT.makerPlainHttpWarning,
      { modal: true },
      UI_TEXT.makerAddMachine,
      UI_TEXT.makerReject,
    )
    if (chosen !== UI_TEXT.makerAddMachine) return
    isPlainHttpAllowed = true
  }
  // No limits yet: only status and Stop work until the panel wizard sets them.
  const message = makerSurfaceMessageSchema.parse({
    v: MAKER_PROTOCOL_VERSION,
    type: 'makerAddMachine',
    machine: {
      id: id.trim(),
      name: name.trim(),
      kind,
      category,
      endpoint: trimmed,
      limits: {},
    },
    allowPlainHttp: isPlainHttpAllowed,
  })
  await deps.addMachine(message)
}

function machineDetail(machine: MakerMachineSummary): string {
  return `${machine.name} (${machine.id}): ${machine.endpoint}`
}

function portDetail(port: SerialIdentity): string {
  const usb = port.vid === undefined || port.pid === undefined ? '' : ` ${port.vid}:${port.pid}`
  const description = port.description === undefined ? '' : ` ${port.description}`
  return `${port.port}${usb}${description}`
}

/** The Devices list: registered machines, live serial ports, and the Add flow. */
export async function openMakerDevices(deps: MakerDevicesDeps): Promise<void> {
  type DevicesItem = vscode.QuickPickItem &
    (
      | { readonly pick: 'add' }
      | { readonly pick: 'machine'; readonly detailLine: string }
      | { readonly pick: 'port'; readonly detailLine: string }
    )
  const [machines, ports] = await Promise.all([deps.listMachines(), deps.listPorts()])
  const items: DevicesItem[] = [
    { label: `$(add) ${UI_TEXT.makerAddMachine}`, pick: 'add' },
    ...machines.map((machine) => ({
      label: machine.name,
      description: machine.endpoint,
      detail: `${machine.kind} · ${machine.category} · ${machine.id}`,
      pick: 'machine' as const,
      detailLine: machineDetail(machine),
    })),
    ...ports.map((port) => ({
      label: port.port,
      description: port.stablePath ?? port.description ?? '',
      detail: [port.vid, port.pid].filter((part) => part !== undefined).join(':'),
      pick: 'port' as const,
      detailLine: portDetail(port),
    })),
  ]
  const chosen = await vscode.window.showQuickPick(items, { title: UI_TEXT.makerDevicesTitle })
  if (chosen === undefined) return
  if (chosen.pick === 'add') {
    await addMachineFlow(deps)
    return
  }
  await vscode.window.showInformationMessage(chosen.detailLine)
}

/** The scrubbed device log, one entry per block, mirroring the panel view's fields. */
export async function openMakerDeviceLog(
  deps: Pick<MakerDevicesDeps, 'readDeviceLog'>,
): Promise<void> {
  const entries = await deps.readDeviceLog()
  const content =
    entries.length === 0
      ? UI_TEXT.makerEmptyLog
      : entries
          .map(
            (entry) =>
              `${new Date(entry.time).toISOString()} ${entry.machine} · ${entry.action} · ${entry.outcome}\n${entry.payload}\n${JSON.stringify({ digest: entry.digest, approval: entry.approval })}`,
          )
          .join('\n\n')
  const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' })
  await vscode.window.showTextDocument(document, { preview: false })
}

/** The OctoPrint auth dialog, after the engine's same-origin validation. */
export async function openMakerAuthDialog(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url))
}
