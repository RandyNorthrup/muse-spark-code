// D75: raw-order JSON tables, never a text merge. Parsing does not enumerate
// JavaScript objects, so integer keys and escaped duplicate keys stay honest.
type Scalar = string | boolean | null
type JsonNode =
  | { kind: 'object'; entries: Map<string, JsonNode>; spellings: Map<string, string> }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'number'; raw: string }
  | { kind: 'value'; value: Scalar; raw: string }

export type JsonTableResult =
  | { kind: 'merged'; text: string }
  | {
      kind: 'conflict'
      reason: 'parse' | 'duplicate' | 'topLevel' | 'value' | 'kept'
      key: string[]
      line?: number
    }

class TableFault extends Error {
  constructor(
    readonly reason: 'parse' | 'duplicate' | 'topLevel' | 'value' | 'kept',
    readonly key: string[],
    readonly line?: number,
  ) {
    super(reason)
  }
}

function parseTable(source: string): JsonNode & { kind: 'object' } {
  const text = source.replace(/^\u{FEFF}/u, '')
  // Keep the cursor for exact syntax locations even when Node's JSON error
  // does not report a position. Scalar strings still use native JSON rules.
  let offset = 0
  function failParse(path: string[]): never {
    throw new TableFault('parse', path, text.slice(0, offset).split('\n').length)
  }
  function whitespace(): void {
    while (/[\t\r\n ]/.test(text[offset] ?? '') && offset < text.length) offset++
  }
  function read(path: string[]): JsonNode {
    whitespace()
    const opening = text[offset]
    if (opening === '{' || opening === '[') {
      offset++
      const entries = new Map<string, JsonNode>()
      const spellings = new Map<string, string>()
      const items: JsonNode[] = []
      whitespace()
      const closing = opening === '{' ? '}' : ']'
      while (text[offset] !== closing) {
        if (opening === '{') {
          whitespace()
          const keyOffset = offset
          const keyNode = read(path)
          if (keyNode.kind !== 'value' || typeof keyNode.value !== 'string') failParse(path)
          const key = keyNode.value
          spellings.set(key, text.slice(keyOffset, offset))
          if (entries.has(key))
            throw new TableFault(
              'duplicate',
              [...path, key],
              text.slice(0, keyOffset).split('\n').length,
            )
          whitespace()
          if (text[offset] !== ':') failParse([...path, key])
          offset++
          entries.set(key, read([...path, key]))
        } else {
          items.push(read([...path, String(items.length)]))
        }
        whitespace()
        if (text[offset] !== ',') break
        offset++
        whitespace()
        if (text[offset] === closing) failParse(path)
      }
      if (text[offset] !== closing) failParse(path)
      offset++
      return opening === '{' ? { kind: 'object', entries, spellings } : { kind: 'array', items }
    }
    const token =
      /^(?:"(?:[^"\\\r\n]|\\.)*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        text.slice(offset),
      )?.[0]
    if (token === undefined) failParse(path)
    offset += token.length
    if (/^-?\d/.test(token)) return { kind: 'number', raw: token }
    let value: unknown
    try {
      value = JSON.parse(token)
    } catch {
      failParse(path)
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return { kind: 'value', value, raw: token }
    }
    failParse(path)
  }
  const root = read([])
  whitespace()
  if (offset !== text.length) failParse([])
  if (root.kind !== 'object') throw new TableFault('topLevel', [])
  return root
}

function isEqual(left: JsonNode | undefined, right: JsonNode | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left.kind === 'value' && right.kind === 'value') return left.value === right.value
  if (left.kind === 'number' && right.kind === 'number')
    return numericIdentity(left.raw) === numericIdentity(right.raw)
  return left.kind === 'array' && right.kind === 'array'
    ? left.items.length === right.items.length &&
        left.items.every((item, index) => isEqual(item, right.items[index]))
    : left.kind === 'object' &&
        right.kind === 'object' &&
        left.entries.size === right.entries.size &&
        [...left.entries].every(([key, value]) => isEqual(value, right.entries.get(key)))
}

function numericIdentity(raw: string): string {
  const [coefficient = '', exponent = '0'] = raw.toLowerCase().split('e', 2)
  const [integer = '', fraction = ''] = coefficient.replace('-', '').split('.', 2)
  const significant = (integer + fraction).replace(/^0+/, '')
  const digits = significant.replace(/0+$/, '')
  if (digits === '') return '0'
  const power =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(significant.length - digits.length)
  return `${raw.startsWith('-') ? '-' : ''}${digits}e${String(power)}`
}

function mergeNode(
  base: JsonNode | undefined,
  ours: JsonNode | undefined,
  theirs: JsonNode | undefined,
  path: string[],
): JsonNode | undefined {
  if (isEqual(ours, theirs) || isEqual(base, theirs)) return ours
  if (isEqual(base, ours) && (ours?.kind !== 'object' || theirs?.kind !== 'object')) return theirs
  if (
    ours?.kind !== 'object' ||
    theirs?.kind !== 'object' ||
    (base !== undefined && base.kind !== 'object')
  )
    throw new TableFault('value', path)
  const entries = new Map<string, JsonNode>()
  const keys = new Set([...ours.entries.keys(), ...theirs.entries.keys()])
  for (const key of keys) {
    const value = mergeNode(
      base?.entries.get(key),
      ours.entries.get(key),
      theirs.entries.get(key),
      [...path, key],
    )
    if (value !== undefined) entries.set(key, value)
  }
  // Ours retains raw order. New keys follow their predecessor in theirs;
  // if that predecessor was removed they go at the end, never sorted.
  const order: string[] = []
  for (const key of ours.entries.keys()) if (entries.has(key)) order.push(key)
  let preceding: string | undefined
  for (const key of theirs.entries.keys()) {
    if (!ours.entries.has(key) && entries.has(key)) {
      const index = preceding === undefined ? -1 : order.indexOf(preceding)
      order.splice(index === -1 ? order.length : index + 1, 0, key)
    }
    preceding = key
  }
  return {
    kind: 'object',
    entries: new Map(order.map((key) => [key, entries.get(key) ?? failValue(path)])),
    spellings: ours.spellings,
  }
}

function failValue(path: string[]): never {
  throw new TableFault('value', path)
}

function render(node: JsonNode, source: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const isMultiline = source.includes('\n')
  const colonSpace = /":([\t ]*)/.exec(source)?.[1] ?? (isMultiline ? ' ' : '')
  const commaSpace = /,([\t ]*)/.exec(source)?.[1] ?? ''
  const indent = /^[\t ]+(?=")/m.exec(source)?.[0] ?? '  '
  const isUnicode = /\\u[\da-f]{4}/i.test(source)
  const isSlash = source.includes(String.raw`\/`)
  function quote(value: string): string {
    let result = JSON.stringify(value)
    if (isUnicode)
      result = result.replaceAll(/[^\p{ASCII}]/gu, (character) =>
        character
          .split('')
          .map((unit) => String.raw`\u${Buffer.from(unit, 'utf16le').swap16().toString('hex')}`)
          .join(''),
      )
    if (isSlash) result = result.replaceAll('/', String.raw`\/`)
    return result
  }
  function write(value: JsonNode, depth: number, original?: JsonNode): string {
    if (value.kind === 'number') return value.raw
    if (value.kind === 'value' && original?.kind === 'value' && isEqual(value, original))
      return original.raw
    if (value.kind === 'value')
      return typeof value.value === 'string' ? quote(value.value) : JSON.stringify(value.value)
    const isObject = value.kind === 'object'
    const parts =
      value.kind === 'object'
        ? [...value.entries].map(
            ([key, child]) =>
              `${original?.kind === 'object' ? (original.spellings.get(key) ?? quote(key)) : quote(key)}:${colonSpace}${write(child, depth + 1, original?.kind === 'object' ? original.entries.get(key) : undefined)}`,
          )
        : value.items.map((child, index) =>
            write(child, depth + 1, original?.kind === 'array' ? original.items[index] : undefined),
          )
    const start = isObject ? '{' : '['
    const end = isObject ? '}' : ']'
    if (parts.length === 0) return start + end
    return isMultiline
      ? `${start}${newline}${indent.repeat(depth + 1)}${parts.join(`,${newline}${indent.repeat(depth + 1)}`)}${newline}${indent.repeat(depth)}${end}`
      : `${start}${parts.join(`,${commaSpace}`)}${end}`
  }
  return `${source.startsWith('\u{FEFF}') ? '\u{FEFF}' : ''}${write(node, 0, parseTable(source))}${source.endsWith('\n') ? newline : ''}`
}

function refused(error: unknown): JsonTableResult {
  return error instanceof TableFault
    ? {
        kind: 'conflict',
        reason: error.reason,
        key: error.key,
        ...(error.line !== undefined && { line: error.line }),
      }
    : { kind: 'conflict', reason: 'parse', key: [] }
}

export function mergeJsonTable(base: string, ours: string, theirs: string): JsonTableResult {
  try {
    const merged = mergeNode(parseTable(base), parseTable(ours), parseTable(theirs), [])
    if (merged === undefined) throw new TableFault('topLevel', [])
    return { kind: 'merged', text: render(merged, ours) }
  } catch (error) {
    return refused(error)
  }
}

// Independent two-way check: unchanged branch leaves must keep ours; changed
// branch leaves must hold theirs. It also catches added/removed containers.
function kept(
  base: JsonNode | undefined,
  ours: JsonNode | undefined,
  theirs: JsonNode | undefined,
  result: JsonNode | undefined,
  path: string[],
): void {
  if (isEqual(base, theirs)) {
    if (!isEqual(ours, result)) throw new TableFault('kept', path)
  } else if (
    theirs?.kind === 'object' &&
    result?.kind === 'object' &&
    ours?.kind === 'object' &&
    (base === undefined || base.kind === 'object')
  ) {
    const keys = new Set([
      ...(base?.entries.keys() ?? []),
      ...ours.entries.keys(),
      ...theirs.entries.keys(),
      ...result.entries.keys(),
    ])
    for (const key of keys)
      kept(
        base?.entries.get(key),
        ours.entries.get(key),
        theirs.entries.get(key),
        result.entries.get(key),
        [...path, key],
      )
  } else if (!isEqual(theirs, result)) throw new TableFault('kept', path)
}

function hasSameOrder(before: JsonNode, after: JsonNode): boolean {
  if (before.kind === 'object' && after.kind === 'object') {
    const keys: string[] = []
    const resultKeys: string[] = []
    for (const key of before.entries.keys()) keys.push(key)
    for (const key of after.entries.keys()) resultKeys.push(key)
    return (
      keys.length === resultKeys.length &&
      keys.every((key, index) => {
        const value = before.entries.get(key)
        const result = after.entries.get(key)
        return (
          key === resultKeys[index] &&
          value !== undefined &&
          result !== undefined &&
          hasSameOrder(value, result)
        )
      })
    )
  }
  return (
    before.kind !== 'array' ||
    after.kind !== 'array' ||
    before.items.every((value, index) => {
      const result = after.items[index]
      return result !== undefined && hasSameOrder(value, result)
    })
  )
}

/** Q injects M68 formatAfterEdit bound to the staging paths, then saves these
 * returned bytes before checks. No formatter runs in prediction or the merge. */
export async function formatMergedJsonTable(
  input: { path: string; base: string; ours: string; theirs: string; text: string },
  formatAfterEdit: (path: string, text: string) => Promise<string | undefined>,
): Promise<JsonTableResult> {
  const text = (await formatAfterEdit(input.path, input.text)) ?? input.text
  try {
    const result = parseTable(text)
    if (
      input.ours.startsWith('\u{FEFF}') !== text.startsWith('\u{FEFF}') ||
      (input.ours.includes('\r\n') && /(?<!\r)\n/.test(text)) ||
      !hasSameOrder(parseTable(input.text), result)
    )
      throw new TableFault('kept', [])
    kept(parseTable(input.base), parseTable(input.ours), parseTable(input.theirs), result, [])
    return { kind: 'merged', text }
  } catch (error) {
    return refused(error)
  }
}
