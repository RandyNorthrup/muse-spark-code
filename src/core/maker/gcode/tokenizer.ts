import { Buffer } from 'node:buffer'

/** Supplied by the host from lane I's shared constants, never tool arguments. */
export interface GcodePolicy {
  readonly maxBytes: number
  readonly maxLines: number
  readonly mmPerInch: number
}

export interface GcodeBlock {
  readonly line: number
  readonly command: string
  readonly parameters: Readonly<Record<string, number>>
  readonly raw: string
  readonly isMacro: boolean
  readonly hasArguments: boolean
}

export class GcodeError extends Error {
  constructor(readonly code: 'payloadSize' | 'syntax') {
    super(code)
  }
}

/** Command names from the wire and config use the tokenizer's same spelling. */
export function canonicalGcodeCommand(command: string): string {
  return command
    .trim()
    .toUpperCase()
    .replace(/^([GMT])0+(?=\d)/, '$1')
}

/** Only bounded numeric words and argument-free commands can be dispatched. */
export function serializeGcode(blocks: readonly GcodeBlock[]): string {
  return blocks
    .map((block) => {
      if (block.isMacro && block.hasArguments) throw new GcodeError('syntax')
      return [
        block.command,
        ...Object.entries(block.parameters).map(([letter, value]) => {
          // Number.toString may use exponent notation, which firmware can read
          // as another word. Refuse instead of changing the parsed value.
          const number = String(value)
          if (!/^-?\d+(?:\.\d+)?$/.test(number)) throw new GcodeError('syntax')
          return `${letter}${number}`
        }),
      ].join(' ')
    })
    .join('\n')
}

/** Comments never carry commands; nested/unclosed comments are rejected. */
function uncomment(line: string): string {
  let isInside = false
  let result = ''
  for (const character of line) {
    if (character === ';' && !isInside) break
    if (character === '(') {
      if (isInside) throw new GcodeError('syntax')
      isInside = true
    } else if (character === ')') {
      if (!isInside) throw new GcodeError('syntax')
      isInside = false
    } else if (!isInside) result += character
  }
  if (isInside) throw new GcodeError('syntax')
  return result.trim()
}

/** Exactly one command per line. Checksums, line numbers and controls fail closed. */
export function tokenizeGcode(payload: string, policy: GcodePolicy): readonly GcodeBlock[] {
  const lines = payload.split('\n')
  if (
    Buffer.byteLength(payload) > policy.maxBytes ||
    lines.length > policy.maxLines ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes <= 0 ||
    !Number.isSafeInteger(policy.maxLines) ||
    policy.maxLines <= 0
  )
    throw new GcodeError('payloadSize')
  const blocks: GcodeBlock[] = []
  for (const [index, raw] of lines.entries()) {
    const printable = raw.replace(/\r$/, '')
    if (/[^\u{20}-\u{7E}\t]/u.test(printable)) throw new GcodeError('syntax')
    const text = uncomment(printable)
    if (text === '') continue
    if (/^N\d/i.test(text)) throw new GcodeError('syntax')
    const head =
      /^(?:[GMT]\d+(?:\.\d+)?|\$[^\s]*|[A-Z_][A-Z_0-9]*)(?=\s|[XYZEFIJKSRTPL]\s*[+-]?(?:\d|\.)|$)/i.exec(
        text,
      )
    if (head === null) throw new GcodeError('syntax')
    const command = canonicalGcodeCommand(head[0])
    const isMacro = !/^[GMT]\d+(?:\.\d+)?$/.test(command)
    const tail = text.slice(head[0].length).trim()
    const parameters: Record<string, number> = {}
    if (isMacro) {
      // Macro arguments remain opaque: arbitrary Jinja/firmware effects cannot be bounded.
      blocks.push({ line: index + 1, command, parameters, raw, isMacro, hasArguments: tail !== '' })
      continue
    }
    const word = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/iy
    let at = 0
    while (at < tail.length) {
      if (/\s/.test(tail.charAt(at))) {
        at += 1
        continue
      }
      word.lastIndex = at
      const match = word.exec(tail)
      const letter = match?.[1]?.toUpperCase()
      const value = Number(match?.[2])
      if (
        match === null ||
        letter === undefined ||
        !Number.isFinite(value) ||
        Object.hasOwn(parameters, letter) ||
        ['G', 'M', 'N', 'T'].includes(letter)
      ) {
        throw new GcodeError('syntax')
      }
      parameters[letter] = value
      at = word.lastIndex
    }
    blocks.push({ line: index + 1, command, parameters, raw, isMacro, hasArguments: tail !== '' })
  }
  return blocks
}
