// D83.2 (RLF-DEVICES): the six maker action classes plus stop, decided
// by our code, never by the model. A command or macro the classifier
// does not know is actuate (fail closed): it asks like any actuation.
// Stop is not a class the model can compose: M112/M410 and the GRBL
// stop bytes in a composed payload are refused; the stop tool sends the
// machine's own fixed sequence (D83.5).
import type { MakerTargetKind } from '../../shared/maker'

export type MakerActionClass = 'offline' | 'observe' | 'connect' | 'program' | 'actuate' | 'refused'

/**
Typed refusal words; the surface maps each to its own sentence and
splices the machine detail (a command, a digest) beside it. Engine
words, never user sentences.
*/
export type MakerRefusalReason =
  | 'refused-command'
  | 'empty-payload'
  | 'unbounded-motion'
  | 'target-mismatch'
  | 'cnc-delivery'
  | 'outside-limits'
  | 'no-limits'
  | 'unhomed'
  | 'identity-mismatch'
  | 'state-changed'
  | 'approval-rejected'
  | 'approval-expired'

export interface MakerLineClass {
  readonly command: string
  readonly class: MakerActionClass
  readonly reason?: MakerRefusalReason
}

/** D83.2's refused table, matched case-insensitively on G-code words. */
const REFUSED_WORDS = new Set([
  'M997',
  'M502',
  'M500',
  'SAVE_CONFIG',
  'FIRMWARE_RESTART',
  'RESTART',
  'M80',
  'M81',
  'M42',
  'M303',
  'M112',
  'M410',
])

/** G-code words that only read: status, settings, alarms (D83.2 observe). */
const OBSERVE_WORDS = new Set(['M105', 'M114', 'M115', 'M119', 'M503', 'M27'])

/**
G-code words the analyser knows (motion, heat, fans, tools, modes):
actuate, and not listed as unknown. Anything else sent is actuate too,
and listed as unknown for the person's eye.
*/
const KNOWN_ACTUATE_WORDS = new Set([
  'G0',
  'G1',
  'G2',
  'G3',
  'G4',
  'G28',
  'G29',
  'G90',
  'G91',
  'G92',
  'M24',
  'M25',
  'M84',
  'M104',
  'M106',
  'M107',
  'M109',
  'M140',
  'M190',
  'M201',
  'M203',
  'M204',
  'M205',
  'M206',
  'M220',
  'M221',
  'M400',
  'M300',
])

/** Klipper macros D83.2 names as actuate (they move the toolhead). */
const KNOWN_MACROS = new Set(['PAUSE', 'CANCEL_PRINT'])

/**
Composed flashing commands D83.4 refuses in every mode. This lane's
program path takes finished firmware bytes, never composed tool
commands, so these match only to keep the table complete for the
machine-command path that carries them.
*/
const IRREVERSIBLE_CHIP_TOKENS = [
  'write_efuse',
  'burn_efuse',
  'burn_key',
  '-Uefuse',
  '-Uhfuse',
  '-Ulfuse',
  '-Ulock',
  'otp_write',
  'rdp level 2',
  'readout protection level 2',
]

/** Moonraker paths and roots D83.2 refuses (the HTTP-machine path). */
const REFUSED_MOONRAKER_TOKENS = ['/machine/shutdown', '/machine/reboot', 'root=config']

function stripComments(line: string): string {
  const semicolon = line.indexOf(';')
  const withoutSemicolon = semicolon === -1 ? line : line.slice(0, semicolon)
  return withoutSemicolon.replaceAll(/\([^)]*\)/g, ' ').trim()
}

function firstWord(line: string): string {
  const cleaned = stripComments(line)
  if (cleaned === '') return ''
  const words = cleaned.split(/\s+/)
  // A Marlin line number and checksum carry no command of their own.
  const significant = words[0]?.startsWith('N') === true ? words.slice(1) : words
  const word = significant[0] ?? ''
  const star = word.indexOf('*')
  const bare = star === -1 ? word : word.slice(0, star)
  return bare.toUpperCase()
}

function hasToken(upper: string, token: string): boolean {
  return upper.includes(token.toUpperCase())
}

export interface MakerWord {
  readonly letter: string
  /** Null when the letters carry no parseable number. */
  readonly value: number | null
}

/**
Splits a comment-free line into letter words (`G1`, `X10.5`, `F1500`).
Unparseable numbers stay null so the analyser fails closed on them.
*/
/**
The line's command word (`G1`, `M104`, `$H`, `?`): the first letter
word with its number, so compact `G1X10` reads as `G1` too.
*/
export function makerLineCommand(line: string): string {
  const words = parseMakerWords(line)
  const first = words[0]
  if (first === undefined) return ''
  if (['G', 'M'].includes(first.letter) && first.value !== null)
    return `${first.letter}${String(first.value)}`
  return first.letter === '$' ? `$${words[1]?.letter ?? ''}` : first.letter
}

/** Uppercase axis letters to their lowercase state keys. */
export const MAKER_AXIS_KEY = { X: 'x', Y: 'y', Z: 'z' } as const

/** A letter word's number, or undefined when the letter never appears. */
export function makerWordValue(
  words: readonly MakerWord[],
  letter: string,
): number | null | undefined {
  return words.find((word) => word.letter === letter)?.value
}

const MAKER_WORD_PATTERN = /([A-Za-z$?])([-+]?(?:\d+\.?\d*|\.\d+)?)/g

export function parseMakerWords(line: string): MakerWord[] {
  // A Marlin line number and checksum carry no words of their own.
  const cleaned = stripComments(line)
    .replace(/^N\d+\s*/i, '')
    .replace(/\*.*$/, '')
  if (cleaned === '') return []
  const words: MakerWord[] = []
  for (const match of cleaned.matchAll(MAKER_WORD_PATTERN)) {
    const letter = (match[1] ?? '').toUpperCase()
    if (letter === '') continue
    const raw = match[2] ?? ''
    if (raw === '') {
      words.push({ letter, value: null })
      continue
    }
    const value = Number(raw)
    words.push({ letter, value: Number.isFinite(value) ? value : null })
  }
  return words
}

function refusedChipOp(line: string): string | undefined {
  const upper = line.toUpperCase()
  return IRREVERSIBLE_CHIP_TOKENS.find((token) => hasToken(upper, token))
}

function refusedMoonraker(line: string): string | undefined {
  const upper = line.toUpperCase()
  return REFUSED_MOONRAKER_TOKENS.find((token) => hasToken(upper, token))
}

function classifyGrblDollar(word: string): MakerLineClass {
  const command = word.toUpperCase()
  if (command === '$X') return { command, class: 'refused', reason: 'refused-command' }
  if (/^\$RST/i.test(command)) return { command, class: 'refused', reason: 'refused-command' }
  // A `$` write sets a numbered setting or a startup line; `$J=` is jog.
  if (/^\$\d+=/.test(command) || /^\$N\d+=/i.test(command))
    return { command, class: 'refused', reason: 'refused-command' }
  const actionClass = ['$$', '$#', '$G', '$I', '$N'].includes(command) ? 'observe' : 'actuate'
  return { command, class: actionClass }
}

const BYTE_TAB = 0x09
const BYTE_LINE_FEED = 0x0a
const BYTE_CARRIAGE_RETURN = 0x0d
const BYTE_SPACE = 0x20
const BYTE_EXCLAMATION = 0x21
const BYTE_TILDE = 0x7e
const BYTE_DELETE = 0x7f
const BYTE_CONTROL_END = 0x9f

// Control bytes and GRBL real-time bytes never belong in composed
// machine text: stop bytes travel only in the stop sequence (D83.5).
// The person re-sends through the stop tool instead.
function isUnsafeByte(code: number): boolean {
  if (code === BYTE_EXCLAMATION || code === BYTE_TILDE) return true
  return code < BYTE_SPACE
    ? code !== BYTE_TAB && code !== BYTE_LINE_FEED && code !== BYTE_CARRIAGE_RETURN
    : code >= BYTE_DELETE && code <= BYTE_CONTROL_END
}

function hasUnsafeBytes(stripped: string): boolean {
  for (const character of stripped) {
    if (isUnsafeByte(character.codePointAt(0) ?? BYTE_SPACE)) return true
  }
  return false
}

function classifyMachineLine(kind: MakerTargetKind, line: string): MakerLineClass {
  const word = firstWord(line)
  if (word === '') return { command: '', class: 'observe' }
  if (hasUnsafeBytes(stripComments(line)))
    return { command: word, class: 'refused', reason: 'refused-command' }
  const chip = refusedChipOp(line)
  if (chip !== undefined) return { command: word, class: 'refused', reason: 'refused-command' }
  const moonraker = refusedMoonraker(line)
  if (moonraker !== undefined) return { command: word, class: 'refused', reason: 'refused-command' }
  if (line.trim() === '?') return { command: '?', class: 'observe' }
  if (word.startsWith('$')) {
    const dollar = classifyGrblDollar(word)
    // The refused table wins everywhere; the CNC delivery refusal covers
    // only what the table would otherwise let through to approval.
    return kind === 'cnc' && dollar.class === 'actuate'
      ? { command: dollar.command, class: 'refused', reason: 'cnc-delivery' }
      : dollar
  }
  if (REFUSED_WORDS.has(word)) return { command: word, class: 'refused', reason: 'refused-command' }
  if (OBSERVE_WORDS.has(word)) return { command: word, class: 'observe' }
  // D83.7, Q-M103b: status, settings read, alarms and stop only; no
  // model-proposed motion or firing in this delivery.
  if (kind === 'cnc') return { command: word, class: 'refused', reason: 'cnc-delivery' }
  // Anything else sent is actuate; a command or macro the classifier
  // does not know asks like one (unknownCommands names it afterward).
  return { command: word, class: 'actuate' }
}

export function classifyMakerLine(kind: MakerTargetKind, line: string): MakerLineClass {
  if (kind === 'mcu') {
    const chip = refusedChipOp(line)
    if (chip !== undefined)
      return { command: firstWord(line), class: 'refused', reason: 'refused-command' }
    // Microcontroller payloads are firmware bytes shown as hex; composed
    // flashing commands arrive through the tool-command path instead.
    return { command: firstWord(line), class: 'program' }
  }
  return classifyMachineLine(kind, line)
}

export interface MakerPayloadClass {
  readonly class: MakerActionClass
  readonly lines: readonly MakerLineClass[]
  readonly refused: readonly MakerLineClass[]
  /** Actuate commands the analyser cannot name, for the person's eye. */
  readonly unknownCommands: readonly string[]
}

function isKnownActuate(command: string): boolean {
  return (
    KNOWN_ACTUATE_WORDS.has(command) ||
    KNOWN_MACROS.has(command) ||
    command.startsWith('G') ||
    command.startsWith('M') ||
    command.startsWith('T')
  )
}

/** One class for a whole payload: refused wins, then actuate, else observe. */
export function classifyMakerPayload(kind: MakerTargetKind, text: string): MakerPayloadClass {
  const lines = text
    .split('\n')
    .map((line) => classifyMakerLine(kind, line))
    .filter((line) => line.command !== '')
  const refused = lines.filter((line) => line.class === 'refused')
  const unknownCommands = [
    ...new Set(
      lines
        .filter((line) => line.class === 'actuate' && !isKnownActuate(line.command))
        .map((line) => line.command),
    ),
  ]
  if (refused.length > 0) return { class: 'refused', lines, refused, unknownCommands }
  if (kind === 'mcu') return { class: 'program', lines, refused, unknownCommands }
  const actionClass: MakerActionClass = lines.some((line) => line.class === 'actuate')
    ? 'actuate'
    : 'observe'
  return { class: actionClass, lines, refused, unknownCommands }
}
