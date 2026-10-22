import type { HardwareWorkspace } from '../hardwareContext'
import type { ActionClass } from './actionClass'
import { commandName, type ShellCommand } from './shellParse'
import type { TargetIdentity } from '../ports'

export interface HardwareContext {
  readonly hardwareOwner?: HardwareWorkspace
  /** Native discovery failed or is unqualified; it cannot support an actuation binding. */
  readonly isInventoryKnown?: boolean
  readonly isHardwareWorkspace?: boolean
  readonly isMakerEnabled?: boolean
  readonly isHardwareProject?: boolean
  readonly hasConnectedBoard?: boolean
  readonly workspaceRoot?: string
  readonly isUnattended?: boolean
  /** Session guard output; shell entry reads the latch instead of re-deriving hardware mode. */
  readonly hardwareSessionLatched?: boolean
  readonly isCommandActive?: boolean
  readonly hasActiveDeviceSession?: boolean
  /** Host inventory notifications, including observations between model calls. */
  readonly onHardwareObserved?: (observe: (context: HardwareContext) => void) => () => void
  /** Host-observed addresses/ports and stop payloads; never model input. */
  readonly targets?: readonly (TargetIdentity & { readonly stop?: string })[]
  readonly boardRoots?: readonly string[]
}

const CLIENT =
  /^(?:curl|wget|http|https|invoke-webrequest|invoke-restmethod|iwr|irm|websocat|wscat)$/
const ENDPOINT =
  /\/(?:printer\/|machine\/|server\/(?:files\/upload|jsonrpc)|api\/(?:printer|job|files|connection|v1\/)|command\b|fs\/)/i
const METHOD = /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|MOVE|OPTIONS)$/i
const WRITE_FLAG =
  /^(?:--data\S*|--json|--form(?:-string)?|--upload-file|--post-data|--post-file|-body|-infile)$/i
const VALUE_FLAG =
  /^(?:--url|--request|-method|-uri|--header|-headers|--unix-socket|--output|--user|--config|-[XHdFTKoUu])$/i
const READ_RPC = new Set([
  'printer.info',
  'printer.objects.query',
  'printer.objects.list',
  'server.info',
])
const REFUSED =
  /\bM(?:997|502|500|80|81|42|303)(?!\d)|\b(?:SAVE_CONFIG|FIRMWARE_RESTART|RESTART)\b|\$(?:X\b|RST\b|N\d*\s*=|\d+\s*=)/i

function decodePercent(text: string): string {
  return text.replaceAll(/%([\da-f]{2})/gi, (_match, hex: string) =>
    String.fromCodePoint(Number(`0x${hex}`)),
  )
}

export function hasRefusedPayload(text: string): boolean {
  return REFUSED.test(decodePercent(text))
}

function urlOf(text: string): URL | undefined {
  try {
    return new URL(/^[\w.-]+(?::\d+)?\//.test(text) ? `http://${text}` : text)
  } catch {
    return undefined
  }
}

export function isRegisteredTarget(text: string, context: HardwareContext): boolean {
  const url = urlOf(text)
  return (
    context.targets?.some((target) => {
      const known = urlOf(target.address)
      return url !== undefined && known !== undefined
        ? url.origin === known.origin
        : text.toLowerCase() === target.address.toLowerCase()
    }) === true
  )
}

interface Transfer {
  urls: string[]
  method: string
  body: string[]
  unknown: boolean
  hasBody: boolean
}

/** Other transports on a registered machine remain a device signal, never a stop grant. */
export function isMachineTarget(text: string, context: HardwareContext): boolean {
  const url = urlOf(text)
  return (
    url !== undefined &&
    context.targets?.some((target) => urlOf(target.address)?.hostname === url.hostname) === true
  )
}

function transferAction(transfer: Transfer, context: HardwareContext): ActionClass | undefined {
  let result: ActionClass | undefined
  for (const address of transfer.urls) {
    const url = urlOf(address)
    const endpoint = decodePercent(url?.pathname ?? address)
    if (!ENDPOINT.test(endpoint) && !isMachineTarget(address, context)) continue
    const payload = `${decodePercent(address)} ${transfer.body.join(' ')}`
    if (
      hasRefusedPayload(payload) ||
      /\/(?:printer\/(?:firmware_restart|restart)|machine\/(?:shutdown|reboot|services))\b|\broot=config\b/i.test(
        payload,
      )
    )
      return 'refused'
    let isReadRpc = false
    if (endpoint === '/server/jsonrpc' && transfer.body.length === 1) {
      try {
        const body: unknown = JSON.parse(transfer.body[0] ?? '')
        isReadRpc =
          typeof body === 'object' &&
          body !== null &&
          'method' in body &&
          typeof body.method === 'string' &&
          READ_RPC.has(body.method)
      } catch {
        /* Unresolved RPC is actuation. */
      }
    }
    const isRpc = endpoint === '/server/jsonrpc' || /^wss?:/i.test(address)
    const isWrite =
      transfer.unknown ||
      (isRpc ? !isReadRpc : transfer.hasBody || !/^(?:GET|HEAD|OPTIONS)$/i.test(transfer.method)) ||
      /\/command\b|\/printer\/gcode\/script|print=true|Print-After-Upload/i.test(payload)
    const action = isWrite ? (/\/fs\//i.test(address) ? 'program' : 'actuate') : 'observe'
    if (result === undefined || action !== 'observe') result = action
  }
  return result
}

/** All transfers, including --next and every URL, contribute to the verdict. */
export function httpAction(
  command: ShellCommand,
  context: HardwareContext,
): ActionClass | undefined {
  const name = commandName(command.argv[0] ?? '')
  if (!CLIENT.test(name)) return undefined
  const transfers: Transfer[] = []
  let transfer: Transfer = {
    urls: [],
    method: 'GET',
    body: [],
    hasBody: false,
    unknown: /^(?:websocat|wscat)$/.test(name),
  }
  let hasExplicitMethod = false
  for (let index = 1; index < command.argv.length; index += 1) {
    const arg = command.argv[index] ?? ''
    if (arg === '--next') {
      transfers.push(transfer)
      transfer = { urls: [], method: 'GET', body: [], hasBody: false, unknown: false }
      hasExplicitMethod = false
      continue
    }
    if (/^(?:https?|wss?):\/\//i.test(arg) || (!arg.startsWith('-') && urlOf(arg) !== undefined)) {
      transfer.urls.push(arg)
      continue
    }
    if (/^(?:http|https)$/.test(name) && METHOD.test(arg)) {
      transfer.method = arg
      hasExplicitMethod = true
      continue
    }
    const equal = arg.indexOf('=')
    const colon = /^-(?:method|body|uri|infile|headers):/i.test(arg) ? arg.indexOf(':') : -1
    const isShort = /^-[XdFTKH].+/.test(arg)
    let flag = arg
    let value = command.argv[index + 1]
    if (colon !== -1) {
      flag = arg.slice(0, colon)
      value = arg.slice(colon + 1)
    } else if (equal !== -1 && arg.startsWith('--')) {
      flag = arg.slice(0, equal)
      value = arg.slice(equal + 1)
    } else if (isShort) {
      flag = arg.slice(0, 2)
      value = arg.slice(2)
    }
    const isWriteFlag = WRITE_FLAG.test(flag) || /^-[dFT]$/.test(flag)
    if (isWriteFlag || VALUE_FLAG.test(flag)) {
      if (value === undefined) transfer.unknown = true
      if (colon === -1 && !isShort && (equal === -1 || !arg.startsWith('--'))) index += 1
      if (/^(?:-X|--request|-method)$/i.test(flag)) {
        transfer.method = value ?? ''
        hasExplicitMethod = true
      }
      if (value !== undefined && /^(?:--url|-uri)$/i.test(flag)) transfer.urls.push(value)
      if (/^(?:-K|--config)$/i.test(flag)) transfer.unknown = true
      if (isWriteFlag) {
        transfer.hasBody = true
        transfer.body.push(value ?? '')
        if (!hasExplicitMethod)
          transfer.method = /^(?:-T|--upload-file|-infile)$/i.test(flag) ? 'PUT' : 'POST'
        if (value?.startsWith('@') === true || /^(?:-T|--upload-file|-infile)$/i.test(flag))
          transfer.unknown = true
      }
      if (/^(?:-H|--header)$/i.test(flag)) transfer.body.push(value ?? '')
      continue
    }
    if (/^(?:-I|--head)$/i.test(flag)) transfer.method = 'HEAD'
    else if (/^(?:-G|--get)$/i.test(flag)) {
      transfer.method = 'GET'
      hasExplicitMethod = true
    } else if (/^(?:http|https)$/.test(name) && !arg.startsWith('-')) {
      transfer.body.push(arg)
      if (!hasExplicitMethod) transfer.method = 'POST'
    } else if (
      !/^(?:-[sfSLv]+|--silent|--show-error|--location|--fail|--verbose|--no-progress-meter)$/.test(
        arg,
      )
    )
      transfer.unknown = true
  }
  transfers.push(transfer)
  const actions = new Set(transfers.map((item) => transferAction(item, context)))
  if (
    !actions.has('refused') &&
    transfers.some((item) => item.unknown) &&
    (context.isHardwareWorkspace === true ||
      transfers.some((item) =>
        item.urls.some((url) => ENDPOINT.test(decodePercent(url)) || isMachineTarget(url, context)),
      ))
  )
    return 'actuate'
  const order: readonly ActionClass[] = ['refused', 'actuate', 'program', 'observe']
  return order.find((action) => actions.has(action))
}

/** Only the exact, out-of-band endpoint and minimal canonical argv are exempt. */
export function isHttpStop(command: ShellCommand, context: HardwareContext): boolean {
  if (command.redirects.length > 0 || command.isPipeline) return false
  const [name, flag, method, address] = command.argv
  const client = commandName(name ?? '')
  const url = urlOf(address ?? '')
  return (
    command.argv.length === 2 + 2 &&
    /^(?:curl|invoke-webrequest|invoke-restmethod|iwr|irm)$/.test(client) &&
    (client === 'curl' ? flag === '-X' : /^-Method$/i.test(flag ?? '')) &&
    method === 'POST' &&
    url?.pathname === '/printer/emergency_stop' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === '' &&
    isRegisteredTarget(address ?? '', context) &&
    context.targets?.some(
      (target) =>
        isRegisteredTarget(address ?? '', { targets: [target] }) &&
        target.stop === '/printer/emergency_stop',
    ) === true
  )
}
