export type GcodeDialect = 'klipper' | 'marlin' | 'grbl'
export type GcodeClass = 'offline' | 'observe' | 'actuate' | 'refused'

const REFUSED = new Set([
  'M500',
  'M502',
  'M997',
  'M999',
  'M80',
  'M81',
  'M42',
  'M303',
  'SAVE_CONFIG',
  'FIRMWARE_RESTART',
  'RESTART',
  'SHUTDOWN_MACHINE',
  'REBOOT_MACHINE',
  'SET_PIN',
  'FORCE_MOVE',
  'SET_KINEMATIC_POSITION',
  'SET_VELOCITY_LIMIT',
  'PID_CALIBRATE',
  'UPDATE_DELAYED_GCODE',
  'SET_GCODE_VARIABLE',
])
const READS = new Set(['M105', 'M114', 'M115', 'M119', 'M503'])
const KLIPPER_READS = new Set(['STATUS', 'HELP', 'GET_POSITION', 'QUERY_ENDSTOPS'])
const GRBL_READS = new Set(['$$', '$#', '$G', '$I', '$N'])
const MODES = new Set(['G20', 'G21', 'G90', 'G91', 'M82', 'M83'])

/** Macros, PAUSE and CANCEL_PRINT are actuation; Stop has a separate fixed path. */
export function gcodeClass(command: string, dialect: GcodeDialect): GcodeClass {
  if (REFUSED.has(command) || /^\$(?:X|RST|N.*=|\d+=)/.test(command)) return 'refused'
  if (
    READS.has(command) ||
    (dialect === 'klipper' && KLIPPER_READS.has(command)) ||
    (dialect === 'grbl' && GRBL_READS.has(command))
  )
    return 'observe'
  return MODES.has(command) ? 'offline' : 'actuate'
}
