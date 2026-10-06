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
  ['program', /\b(?:pio|platformio)\s+run\b.*(?:-t\s*|--target[=\s]+)(?:uploadfs|upload|erase)\b/i],
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
  if (/^python\d*$/.test(name)) {
    const module = command.argv.indexOf('-m')
    const entry = module === -1 ? 1 : module + 1
    return { ...command, argv: command.argv.slice(entry) }
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
        ? /^-(?:destination|target-directory|t)$/i.test(arg)
        : /^-(?:literalpath|path|filepath)$/i.test(arg),
    )
    const destinationIndex = pathFlag === -1 ? -1 : pathFlag + 1
    const target =
      name === 'dd'
        ? args.find((arg) => arg.startsWith('of='))?.slice('of='.length)
        : args.at(destinationIndex)
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
      command.argv[1] === 'test' &&
      !/--without-uploading\b|(?:-e\s*|--environment[=\s]+)native\b/.test(text)
    )
      row = 'program'
    if (name === 'mpremote')
      row ??= /\b(?:connect\s+list|devs)\b/.test(text) ? 'observe' : 'connect'
    if (
      /^(?:esptool|espefuse|picotool)$/.test(name) &&
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
    /\b(?:pio|platformio|idf(?:\.py)?|esptool|espefuse|avrdude|picotool|mpremote|ampy|dfu-util|st-flash|openocd|nrfjprog|esphome|espota|gpioset|pinctrl|raspi-gpio|ros2|System\.IO\.Ports|cncjs|socket\.io)\b|\/dev\/(?:tty|cu\.|serial|gpiochip)|\bCOM\d+\b|CIRCUITPY|RPI-RP2|\/media\/|\/Volumes\/|\/sys\/(?:class|devices)\/|\/(?:printer|machine)\/|\/server\/jsonrpc|\/fs\//i.test(
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

/** Whole canonical stop, registered target and fixed out-of-band bytes only. */
export function isHardwareStop(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): boolean {
  const parsed = parseShell(command, dialect)
  const item = parsed.commands[0]
  if (
    item === undefined ||
    parsed.isUnknown ||
    parsed.commands.length !== 1 ||
    /[;|&\r\n]/.test(command)
  )
    return false
  const redirect = item.redirects[0]
  const payload = item.argv[1]
  return (
    isHttpStop(item, context) ||
    (payload !== undefined &&
      !item.isPipeline &&
      item.argv.length === 2 &&
      item.redirects.length === 1 &&
      redirect?.operator === '>' &&
      /^(?:echo|printf)$/i.test(item.argv[0] ?? '') &&
      isRegisteredTarget(redirect.target, context) &&
      context.targets?.some(
        (target) => target.address === redirect.target && target.stop === payload,
      ) === true)
  )
}

/** Strongest effect; unknown plus any device signal is never observe or stop. */
export function hardwareAction(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): ActionClass | undefined {
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

export function hardwareTarget(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): TargetIdentity {
  const parsed = parseShell(command, dialect)
  const candidates = parsed.commands.flatMap((item) => [
    ...item.argv,
    ...item.redirects.map((redirect) => redirect.target),
  ])
  const address = candidates.find(
    (candidate) =>
      /^(?:https?|wss?):\/\//i.test(candidate) || devicePath(candidate, context) !== undefined,
  )
  const registered = context.targets?.find(
    (target) =>
      address !== undefined &&
      (isRegisteredTarget(address, { targets: [target] }) ||
        isMachineTarget(address, { targets: [target] })),
  )
  return registered ?? { address: address ?? command }
}
