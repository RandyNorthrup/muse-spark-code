// M103-G: one shared command table for both backends and unattended callers.
// commandShape supplies exact argv for plain commands. Complex shell syntax
// gets a conservative textual scan, never an automated hardware allow.
import type { CommandShape, ShellDialect } from '../../backends/modelapi/shellSyntax'
import type { ActionClass } from './actionClass'

interface HardwareRule {
  readonly id: string
  readonly action: ActionClass
  readonly command: RegExp
}

/** Model API injects its precise lexer; MSP already supplies validated staged argv. */
type SplitCommand = (command: string, dialect: ShellDialect) => CommandShape

const DEVICE = /(?:\/dev\/(?:tty\S*|cu\.\S*|serial\/\S*)|(?:\\\\\.\\)?COM\d+)(?:\b|$)/i
const SERIAL_WRITE =
  /(?:>\s*["']?(?:\/dev\/(?:tty\S*|cu\.\S*|serial\/\S*)|(?:\\\\\.\\)?COM\d+)|\b(?:set-content|add-content|out-file)\b.*\bCOM\d+|System\.IO\.Ports.*\.Write(?:Line)?\s*\()/i
const DEVICE_VOLUME = /(?:^|[\\/])(?:CIRCUITPY|RPI-RP2)(?:[\\/]|$)/i
const HTTP_CLIENT =
  /(?:^|[\s/\\])(?:curl|wget|http|https|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(?:\.exe)?(?:\s|$)/i
const HTTP_WRITE =
  /(?:-X\s*|--request[=\s]+|-Method\s+|\b)(?:POST|PUT|DELETE|MOVE|PATCH)\b|(?:--data\S*|-d|-F|--form|-T|--upload-file|--post-data|--post-file)\b/i
const MACHINE_ENDPOINT =
  /\/(?:printer\/|machine\/|server\/files\/upload|api\/(?:printer|job|files|connection|v1\/(?:job|files))|command\b|fs\/)/i
const REFUSED_PAYLOAD =
  /\bM(?:997|502|500|80|81|42|303)(?!\d)|\b(?:SAVE_CONFIG|FIRMWARE_RESTART|RESTART)\b|\$(?:X\b|RST\b|N\d*\s*=|\d+\s*=)/i
const STOP_PAYLOAD = /^(?:M112|M410|!|\\x18|\\x85|\\030)(?:\s|\\n)*$/i
// Fixed GRBL protocol bytes, kept outside regexes so control characters are never regex syntax.
const STOP_BYTES: ReadonlySet<string> = new Set(
  ['18'].map((hex) => String.fromCodePoint(Number(`0x${hex}`))),
)

/** Each row is exercised separately, including legacy underscore spellings. */
const HARDWARE_RULES: readonly HardwareRule[] = [
  {
    id: 'cncjs-socket',
    action: 'actuate',
    command: /\b(?:cncjs|socket\.io)[\s\S]*\.emit\s*\(\s*(?:command|write)\b/i,
  },
  {
    id: 'efuse',
    action: 'refused',
    command:
      /\bespefuse\b.*\b(?:burn[-_]\S+|(?:write|read)[-_]protect[-_]efuse|set[-_]flash[-_]voltage)\b/i,
  },
  {
    id: 'avr-fuses',
    action: 'refused',
    command: /\bavrdude\b.*(?:-U\s*|\s)(?:[lhe]fuse|lock):w(?::|\b)/i,
  },
  { id: 'stm32-rdp', action: 'refused', command: /\bstm32_programmer_cli\b.*\bRDP\s*=\s*0xCC\b/i },
  { id: 'pico-otp', action: 'refused', command: /\bpicotool\b.*\botp\s+(?:set|load)\b/i },
  {
    id: 'pio-upload',
    action: 'program',
    command: /\b(?:pio|platformio)\s+run\b.*(?:-t\s*|--target[=\s]+)(?:uploadfs|upload|erase)\b/i,
  },
  {
    id: 'idf-flash',
    action: 'program',
    command: /\bidf\b.*\b(?:flash|app-flash|erase-flash|dfu-flash)\b/i,
  },
  {
    id: 'esptool-flash',
    action: 'program',
    command: /\besptool\b.*\b(?:write[-_]flash|erase[-_]flash|erase[-_]region)\b/i,
  },
  {
    id: 'arduino-upload',
    action: 'program',
    command: /\barduino-cli\b.*\b(?:upload|burn-bootloader)\b/i,
  },
  {
    id: 'avr-program',
    action: 'program',
    command: /\bavrdude\b.*-U\s*(?:flash|eeprom):w(?::|\b)/i,
  },
  { id: 'pico-program', action: 'program', command: /\bpicotool\b.*\b(?:load|reboot)\b/i },
  {
    id: 'micropython-program',
    action: 'program',
    command:
      /\bmpremote\b.*(?:\b(?:run|exec|eval|mount|reset|soft-reset)\b|\b(?:cp|rm)\b.*(?:^|\s):)/i,
  },
  { id: 'ampy-program', action: 'program', command: /\bampy\b.*\b(?:put|rm|run)\b/i },
  { id: 'dfu-program', action: 'program', command: /\bdfu-util\b.*(?:^|\s)-D(?:\s|\S)/ },
  { id: 'st-program', action: 'program', command: /\bst-flash\s+write\b/i },
  { id: 'openocd-program', action: 'program', command: /\bopenocd\b.*\bprogram\b/i },
  { id: 'nrf-program', action: 'program', command: /\bnrfjprog\b.*--(?:program|recover)\b/i },
  { id: 'esphome-program', action: 'program', command: /\besphome\b.*\b(?:run|upload)\b/i },
  { id: 'espota-program', action: 'program', command: /\bespota\b/i },
  { id: 'zephyr-program', action: 'program', command: /\bwest\s+flash\b/i },
  {
    id: 'pio-monitor',
    action: 'connect',
    command:
      /\b(?:pio|platformio)\s+(?:device\s+monitor|run\b.*(?:-t\s*|--target[=\s]+)monitor\b)/i,
  },
  { id: 'idf-monitor', action: 'connect', command: /\bidf\b(?!.*\bqemu\b).*\bmonitor\b/i },
  { id: 'arduino-monitor', action: 'connect', command: /\barduino-cli\b.*\bmonitor\b/i },
  {
    id: 'esptool-connect',
    action: 'connect',
    command: /\besptool\b.*\b(?:chip[-_]id|read[-_]mac|flash[-_]id)\b/i,
  },
  { id: 'pico-info', action: 'connect', command: /\bpicotool\s+info\b/i },
  { id: 'serial-terminal', action: 'connect', command: /\bserial\.tools\.miniterm\b/i },
  {
    id: 'gpio',
    action: 'actuate',
    command: /\bgpioset\b|\bpinctrl\s+(?:set|op)\b|\braspi-gpio\s+set\b/i,
  },
  {
    id: 'ros-motion',
    action: 'actuate',
    command: /\bros2\s+(?:topic\s+pub|action\s+send_goal|service\s+call)\b/i,
  },
]

function normalize(command: string): string {
  return command
    .replaceAll(/%([\da-f]{2})/gi, (_encoded, hex: string) =>
      String.fromCodePoint(Number(`0x${hex}`)),
    )
    .replaceAll(/\.(?:exe|py)\b/gi, '')
    .replaceAll(/["']/g, '')
}

/** Stop is a whole payload, never an escape for motion beside a stop word. */
function isSerialStop(command: string): boolean {
  const payload = /\b(?:echo|printf)\s+["']([^"']*)["']\s*>/.exec(command)?.[1]
  return payload !== undefined && (STOP_PAYLOAD.test(payload) || STOP_BYTES.has(payload))
}

/** Only a fixed stop alone; an extra command, URL, argument or motion defeats this exemption. */
export function isHardwareStop(command: string): boolean {
  return (
    (/^\s*(?:echo|printf)\s+["'][^"']+["']\s*>\s*["']?(?:\/dev\/(?:tty[^\s"']*|cu\.[^\s"']*|serial\/[^\s"']*)|COM\d+)["']?\s*$/i.test(
      command,
    ) &&
      isSerialStop(command)) ||
    /^\s*curl(?:\.exe)?\s+-X\s+POST\s+https?:\/\/[^\s;|&"']+\/printer\/emergency_stop\s*$/i.test(
      command,
    )
  )
}

function classify(command: string): ActionClass | undefined {
  const text = normalize(command)
  const isSerialWrite = SERIAL_WRITE.test(command)
  const isHttpMachine = HTTP_CLIENT.test(text) && MACHINE_ENDPOINT.test(text)
  if ((isSerialWrite || isHttpMachine) && REFUSED_PAYLOAD.test(text)) return 'refused'
  if (isHttpMachine) {
    if (
      /\/printer\/(?:firmware_restart|restart)\b|\/machine\/(?:shutdown|reboot|services)\b|\broot=config\b/i.test(
        text,
      )
    )
      return 'refused'
    if (
      /\/printer\/emergency_stop(?:[\s?]|$)/i.test(text) &&
      !/\/printer\/gcode\/script/i.test(text)
    )
      return 'observe'
    if (/\/printer\/objects\/(?:query|list)\b|\/printer\/info\b/i.test(text)) return 'observe'
    if (
      /\/(?:printer\/(?:gcode\/script|print\/)|machine\/device_power\/|command\b)/i.test(text) ||
      HTTP_WRITE.test(text) ||
      /print=true|Print-After-Upload/i.test(text)
    )
      return /\/fs\//i.test(text) ? 'program' : 'actuate'
    return 'observe'
  }
  if (isSerialWrite) return isSerialStop(command) ? 'observe' : 'actuate'
  const refused = HARDWARE_RULES.find((row) => row.action === 'refused' && row.command.test(text))
  if (refused !== undefined) return refused.action
  if (
    /\b(?:pio|platformio)\s+test\b/i.test(text) &&
    !/--without-uploading\b|(?:-e\s*|--environment[=\s]+)native\b/i.test(text)
  )
    return 'program'
  if (/\b(?:cp|copy|copy-item|move|mv|move-item|rsync)\b/i.test(text) && DEVICE_VOLUME.test(text))
    return 'program'
  const matched = HARDWARE_RULES.find((row) => row.command.test(text))
  if (matched !== undefined) return matched.action
  if (/\bmpremote(?:\s|$)/i.test(text))
    return /\b(?:connect\s+list|devs)\b/i.test(text) ? 'observe' : 'connect'
  if (DEVICE.test(text) && /\b(?:screen|minicom|picocom|cu|stty|cat|get-content)\b/i.test(text))
    return 'connect'
  // Unknown calls in a physical namespace ask, instead of trusting a new
  // subcommand. Documented offline/read-only forms retain ordinary policy.
  return /\b(?:esptool|espefuse|picotool)\b/i.test(text) &&
    !/\b(?:merge[-_]bin|image[-_]info|summary|dump|otp\s+(?:list|get))\b/i.test(text)
    ? 'actuate'
    : undefined
}

const ACTION_ORDER: readonly ActionClass[] = [
  'offline',
  'observe',
  'connect',
  'program',
  'actuate',
  'refused',
]

/** The strongest physical effect across a chain, including a complex line. */
export function hardwareAction(
  command: string,
  dialect: ShellDialect = 'bash',
  split?: SplitCommand,
): ActionClass | undefined {
  // A PowerShell port object is often declared in an earlier statement.
  let result = classify(command)
  if (/System\.IO\.Ports/i.test(command)) {
    if (/\.Write(?:Line)?\s*\(/i.test(command))
      result = REFUSED_PAYLOAD.test(command) ? 'refused' : 'actuate'
    else if (/\.Open\s*\(/i.test(command)) result = 'connect'
  }
  const shape = split?.(command, dialect)
  const commands =
    shape?.isPlain === true
      ? shape.commands.map((argv) => argv.join(' '))
      : command.split(/(?:&&|\|\||[;|\n\r])/)
  for (const line of commands) {
    const action = classify(line)
    if (
      action !== undefined &&
      (result === undefined || ACTION_ORDER.indexOf(action) > ACTION_ORDER.indexOf(result))
    )
      result = action
  }
  return result
}
