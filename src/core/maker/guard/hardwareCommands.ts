// M103-G: one shared command table for both backends and unattended callers.
// commandShape supplies exact argv for plain commands. Complex shell syntax
// gets a conservative textual scan, never an automated hardware allow.
import {
  commandName,
  literalShellBody,
  parseShell,
  type GuardDialect,
  type ShellCommand,
} from './shellParse'
import {
  httpAction,
  isHttpStop,
  isRegisteredTarget,
  isMachineTarget,
  hasRefusedPayload,
  type HardwareContext,
} from './httpCommands'
import type { ActionClass } from './actionClass'
import type { TargetIdentity } from '../ports'

type HardwareRule = readonly [action: ActionClass, command: RegExp]

/** Each row is exercised separately, including legacy underscore spellings. */
const HARDWARE_RULES: readonly HardwareRule[] = [
  ['actuate', /\b(?:cncjs|socket\.io)[\s\S]*\.emit\s*\(\s*(?:command|write)\b/i],
  [
    'refused',
    /\bespefuse\b.*\b(?:burn[-_]\S+|(?:write|read)[-_]protect[-_]efuse|set[-_]flash[-_]voltage)\b/i,
  ],
  ['refused', /\bavrdude\b.*(?:-U\s*|\s)(?:[lhe]fuse|lock):w(?::|\b)/i],
  ['refused', /\bstm32_programmer_cli\b.*\bRDP\s*=\s*0xCC\b/i],
  ['refused', /\bpicotool\b.*\botp\s+(?:set|load)\b/i],
  [
    'program',
    /\b(?:pio|platformio)\b.*\brun\b.*(?:-t\s*|--target[=\s]+)(?:uploadfs|upload|erase)\b/i,
  ],
  ['program', /\bidf\b.*\b(?:flash|app-flash|erase-flash|dfu-flash)\b/i],
  ['program', /\besptool\b.*\b(?:write[-_]flash|erase[-_]flash|erase[-_]region)\b/i],
  ['program', /\barduino-cli\b.*\b(?:upload|burn-bootloader)\b/i],
  ['program', /\bavrdude\b.*-U\s*(?:flash|eeprom):w(?::|\b)/i],
  ['program', /\bpicotool\b.*\b(?:load|reboot)\b/i],
  [
    'program',
    /\bmpremote\b.*(?:\b(?:run|exec|eval|mount|reset|soft-reset)\b|\b(?:cp|rm)\b.*(?:^|\s):)/i,
  ],
  ['program', /\bampy\b.*\b(?:put|rm|run)\b/i],
  ['program', /\bdfu-util\b.*(?:^|\s)-D(?:\s|\S)/],
  ['program', /\bst-flash\s+write\b/i],
  ['program', /\bopenocd\b.*\bprogram\b/i],
  ['program', /\bnrfjprog\b.*--(?:program|recover)\b/i],
  ['program', /\besphome\b.*\b(?:run|upload)\b/i],
  ['program', /\bespota\b/i],
  ['program', /\bwest\s+flash\b/i],
  [
    'connect',
    /\b(?:pio|platformio)\s+(?:device\s+monitor|run\b.*(?:-t\s*|--target[=\s]+)monitor\b)/i,
  ],
  ['connect', /\bidf\b(?!.*\bqemu\b).*\bmonitor\b/i],
  ['connect', /\barduino-cli\b.*\bmonitor\b/i],
  ['connect', /\besptool\b.*\b(?:chip[-_]id|read[-_]mac|flash[-_]id)\b/i],
  ['connect', /\bpicotool\s+info\b/i],
  ['connect', /\bserial\.tools\.miniterm\b/i],
  ['actuate', /\bgpioset\b|\bpinctrl\s+(?:set|op)\b|\braspi-gpio\s+set\b/i],
  ['actuate', /\bros2\s+(?:topic\s+pub|action\s+send_goal|service\s+call)\b/i],
]

const DEVICE = /^(?:(?:\/dev\/(?:tty[^\s]*|cu\.[^\s]*|serial\/[^\s]*)|(?:\\\\\.\\)?COM\d+))$/i
const BOARD = /(?:^|[\\/])(?:CIRCUITPY|RPI-RP2|mbed)(?:[\\/]|$)|^\/(?:media|Volumes)\//i
const GPIO = /^\/(?:sys\/class\/(?:gpio|pwm)|sys\/devices\/.*gpio|dev\/gpiochip)/i
const DEVICE_TOOL =
  /^(?:pio|platformio|idf|esptool|espefuse|arduino-cli|avrdude|stm32_programmer_cli|picotool|mpremote|ampy|dfu-util|st-flash|openocd|nrfjprog|esphome|espota|west|gpioset|pinctrl|raspi-gpio|ros2|screen|minicom|picocom|cu|stty|serial\.tools\.miniterm)$/i
const ACTION_ORDER: readonly ActionClass[] = [
  'offline',
  'observe',
  'connect',
  'program',
  'actuate',
  'refused',
]

function strongest(actions: readonly (ActionClass | undefined)[]): ActionClass | undefined {
  let result: ActionClass | undefined
  for (const action of actions) {
    if (
      action !== undefined &&
      (result === undefined || ACTION_ORDER.indexOf(action) > ACTION_ORDER.indexOf(result))
    )
      result = action
  }
  return result
}

function devicePath(path: string, context: HardwareContext): ActionClass | undefined {
  if (DEVICE.test(path) || GPIO.test(path)) return 'actuate'
  return BOARD.test(path) ||
    context.boardRoots?.some((root) =>
      path
        .toLowerCase()
        .replaceAll('\\', '/')
        .startsWith(`${root.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '')}/`),
    ) === true
    ? 'program'
    : undefined
}

function executable(command: ShellCommand): ShellCommand {
  const name = commandName(command.argv[0] ?? '')
  if (/^(?:env|command|exec|nohup|sudo)$/.test(name)) {
    const entry = command.argv.findIndex(
      (arg, index) => index > 0 && !arg.startsWith('-') && !/^[\w]+=/.test(arg),
    )
    return entry > 0 ? executable({ ...command, argv: command.argv.slice(entry) }) : command
  }
  if (/^python\d*$/.test(name)) {
    const module = command.argv.indexOf('-m')
    const entry =
      module === -1
        ? command.argv.findIndex((arg, index) => index > 0 && !arg.startsWith('-'))
        : module + 1
    return entry < 1 ? command : { ...command, argv: command.argv.slice(entry) }
  }
  return command
}

function classifyCommand(
  original: ShellCommand,
  context: HardwareContext,
): ActionClass | undefined {
  const command = executable(original)
  const name = commandName(command.argv[0] ?? '')
  const text = [name, ...command.argv.slice(1)].join(' ')
  const http = httpAction(command, context)
  const writes = command.redirects
    .filter((redirect) => redirect.operator.includes('>'))
    .map((redirect) => devicePath(redirect.target, context))
  if (
    /^(?:tee|dd|cp|copy|copy-item|move|mv|move-item|rsync|set-content|add-content|out-file)$/i.test(
      name,
    )
  ) {
    const args = command.argv.slice(1)
    const isCopy = /^(?:cp|copy|copy-item|move|mv|move-item|rsync)$/.test(name)
    const pathFlag = args.findIndex((arg) =>
      isCopy
        ? /^(?:-destination|--target-directory|-t)(?:[=:]|$)/i.test(arg)
        : /^-(?:literalpath|path|filepath)(?::|$)/i.test(arg),
    )
    const flag = args[pathFlag] ?? ''
    const delimiter = flag.search(/[=:]/)
    const positionals = args.filter((arg) => !arg.startsWith('-'))
    let target: string | undefined
    if (name === 'dd') target = args.find((arg) => arg.startsWith('of='))?.slice('of='.length)
    else if (pathFlag === -1) target = isCopy ? positionals.at(-1) : positionals[0]
    else target = delimiter === -1 ? args[pathFlag + 1] : flag.slice(delimiter + 1)
    if (target !== undefined) writes.push(devicePath(target, context))
    if (name === 'tee')
      for (const destination of args) {
        if (!destination.startsWith('-')) writes.push(devicePath(destination, context))
      }
  }
  const write = strongest(writes)
  if (write === 'actuate' && hasRefusedPayload(text)) return 'refused'
  const body = literalShellBody(command)
  const nested = body === undefined ? undefined : hardwareAction(body.text, body.dialect, context)
  let row: ActionClass | undefined
  if (DEVICE_TOOL.test(name)) {
    row =
      HARDWARE_RULES.find(([action, command]) => action === 'refused' && command.test(text))?.[0] ??
      HARDWARE_RULES.find(([, command]) => command.test(text))?.[0]
    if (
      /^(?:pio|platformio)$/.test(name) &&
      command.argv.slice(1).find((arg) => !arg.startsWith('-')) === 'test' &&
      !/--without-uploading\b|(?:-e\s*|--environment[=\s]+)native\b/.test(text)
    )
      row = 'program'
    if (name === 'mpremote')
      row ??= /\b(?:connect\s+list|devs)\b/.test(text) ? 'observe' : 'connect'
    if (
      /^(?:esptool|espefuse|picotool)$/.test(name) &&
      command.argv.slice(1).every((arg) => !/^(?:--help|-h|help|version|--version)$/.test(arg)) &&
      !/\b(?:merge[-_]bin|image[-_]info|summary|dump|otp\s+(?:list|get))\b/.test(text)
    )
      row ??= 'actuate'
  }
  const reads = [
    ...command.argv.slice(1),
    ...command.redirects
      .filter((redirect) => redirect.operator === '<')
      .map((redirect) => redirect.target),
  ]
  if (
    /^(?:screen|minicom|picocom|cu|stty|cat|get-content)$/.test(name) &&
    reads.some((arg) => DEVICE.test(arg))
  )
    row ??= 'connect'
  return strongest([row, nested, http, write])
}

function hasDeviceSignal(command: string, context: HardwareContext): boolean {
  if (context.isHardwareWorkspace === true) return true
  const text = command.replaceAll(/["'\\`^]/g, '')
  return (
    /\b(?:pio|platformio|idf(?:\.py)?|esptool|espefuse|avrdude|arduino-cli|west|stm32_programmer_cli|stty|screen|minicom|picocom|cu|picotool|mpremote|ampy|dfu-util|st-flash|openocd|nrfjprog|esphome|espota|gpioset|pinctrl|raspi-gpio|ros2|System\.IO\.Ports|cncjs|socket\.io)\b|\/dev\/(?:tty|cu\.|serial|gpiochip)|\bCOM\d+\b|CIRCUITPY|RPI-RP2|\/media\/|\/Volumes\/|\/sys\/(?:class|devices)\/|\/(?:printer|machine)\/|\/server\/jsonrpc|\/fs\//i.test(
      text,
    ) ||
    context.targets?.some((target) =>
      text.toLowerCase().includes(newAddress(target.address).toLowerCase()),
    ) === true ||
    context.boardRoots?.some((root) => text.toLowerCase().includes(root.toLowerCase())) === true
  )
}

function newAddress(address: string): string {
  try {
    return new URL(address).hostname
  } catch {
    return address
  }
}

export type HardwareStop =
  | { readonly kind: 'http'; readonly address: string }
  | { readonly kind: 'serial'; readonly address: string; readonly payload: string }

/** Decode only literal printf bytes: no formats, substitutions or extra effects. */
function stopBytes(tool: string, payload: string): string | undefined {
  if (tool === 'echo')
    return /[\\]/.test(payload) || payload.startsWith('-')
      ? undefined
      : Buffer.from(`${payload}\n`, 'utf8').toString('latin1')
  return tool !== 'printf' || /%|\\(?!x[\da-f]{2}|[\\nrt])/i.test(payload)
    ? undefined
    : Buffer.from(payload, 'utf8')
        .toString('latin1')
        .replaceAll(
          /\\(?:x([\da-f]{2})|([\\nrt]))/gi,
          (_match, hex: string | undefined, escape: string | undefined) => {
            if (hex !== undefined) return String.fromCodePoint(Number(`0x${hex}`))
            switch (escape) {
              case 'n': {
                return '\n'
              }
              case 'r': {
                return '\r'
              }
              case 't': {
                return '\t'
              }
              default: {
                return '\\'
              }
            }
          },
        )
}

/** Normalize the registered operation; execution never reuses the ambient command. */
export function hardwareStop(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): HardwareStop | undefined {
  const parsed = parseShell(command, dialect)
  const item = parsed.commands[0]
  if (
    item === undefined ||
    parsed.isUnknown ||
    parsed.commands.length !== 1 ||
    /[;|&\r\n]/.test(command)
  )
    return undefined
  if (isHttpStop(item, context)) return { kind: 'http', address: item.argv[1 + 2] ?? '' }
  const redirect = item.redirects[0]
  const payload = item.argv[1]
  if (
    payload === undefined ||
    item.isPipeline ||
    item.argv.length !== 2 ||
    item.redirects.length !== 1 ||
    redirect?.operator !== '>'
  )
    return undefined
  const bytes = stopBytes(item.argv[0] ?? '', payload)
  return bytes === undefined ||
    !context.targets?.some((target) => target.address === redirect.target && target.stop === bytes)
    ? undefined
    : { kind: 'serial', address: redirect.target, payload: bytes }
}

export function isHardwareStop(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): boolean {
  return hardwareStop(command, dialect, context) !== undefined
}

/** Strongest effect; unknown plus any device signal is never observe or stop. */
export function hardwareAction(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): ActionClass | undefined {
  // In latched hardware mode this is only a card annotation, including opaque wrappers.
  if (
    context.isHardwareWorkspace === true &&
    HARDWARE_RULES.some(([action, rule]) => action === 'refused' && rule.test(command))
  )
    return 'refused'
  const parsed = parseShell(command, dialect)
  const actions = parsed.commands.map((item) => classifyCommand(item, context))
  for (const index of parsed.commands.keys()) {
    if (
      actions[index] === 'actuate' &&
      index > 0 &&
      parsed.commands[index - 1]?.isPipeline === true &&
      hasRefusedPayload(
        parsed.commands
          .slice(0, index + 1)
          .flatMap((command) => command.argv)
          .join(' '),
      )
    )
      return 'refused'
  }
  const action = strongest(actions)
  if (action === 'refused') return action
  if (parsed.isUnknown && (action !== undefined || hasDeviceSignal(command, context)))
    return 'actuate'
  return isHardwareStop(command, dialect, context) ? 'observe' : action
}

/** MSP already supplies literal staged argv; keep each argument and stage intact. */
export function hardwareArgvAction(
  argv: readonly string[],
  context: HardwareContext = {},
): ActionClass | undefined {
  const command = { argv, redirects: [], isPipeline: false }
  const action = classifyCommand(command, context)
  if (action === 'refused') return action
  return literalShellBody(command) !== undefined &&
    (action !== undefined || context.isHardwareWorkspace === true)
    ? 'actuate'
    : action
}

export function hardwareTargets(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
  stages: readonly (readonly string[])[] = [],
): readonly TargetIdentity[] {
  const parsed = parseShell(command, dialect)
  const candidates = [
    ...stages.flat(),
    ...parsed.commands.flatMap((item) => [
      ...item.argv,
      ...item.redirects.map((redirect) => redirect.target),
    ]),
  ]
  const addresses = candidates.filter(
    (candidate) =>
      /^(?:https?|wss?):\/\//i.test(candidate) || devicePath(candidate, context) !== undefined,
  )
  // Bind the entire observed inventory too: unresolved shell code and typed
  // tools cannot hide a second target from a text classifier. Registry churn
  // invalidates the card even when an unrelated machine changed.
  const targets: TargetIdentity[] = [
    ...(context.targets ?? []),
    ...(context.boardRoots ?? []).map((address) => ({ address })),
  ]
  for (const address of addresses) {
    const registered = context.targets?.find(
      (target) =>
        isRegisteredTarget(address, { targets: [target] }) ||
        isMachineTarget(address, { targets: [target] }),
    )
    if (registered === undefined && targets.every((target) => target.address !== address))
      targets.push({ address })
  }
  if (targets.length === 0) targets.push({ address: command })
  return targets.toSorted((left, right) => left.address.localeCompare(right.address))
}
