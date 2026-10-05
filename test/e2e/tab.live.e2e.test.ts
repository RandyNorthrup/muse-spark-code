// The Tab latency probe (M94 step 1, lane P; PLAN.md D73). Opt-in only, never
// in CI: it bills the owner's Model API key. It runs when MUSE_LIVE_MODEL_API=1
// and the key is in MUSE_LIVE_MODEL_API_KEY, which the owner's run script
// decrypts into this process alone and filters out of everything printed. The
// key is read once into memory and the variable deleted. This file starts no
// process, so nothing can inherit it, and every line it writes is scrubbed.
//
// What runs: 30 requests of D73's shape, one at a time, through the real key
// client (`ModelApiClient.streamResponse`: its headers, retries, SSE parsing
// and validation) on muse-spark-1.3-contributor (the owner's live-test rule;
// training is allowed on this throwaway content):
//   - 10 fast pairs, the second of each typed three characters on from the
//     first, so it shares the first one's prefix;
//   - 10 multi-line requests with context snippets.
// The files are generated here, written to a temporary folder under the
// empty live workspace C:\muse-live-ws, read back as the provider would read
// them, and removed. Never real code.
//
// The client's body type still requires `reasoning.summary`, `tools`,
// `tool_choice` and `include`, and D73 sends none of them (lane C makes the
// summary optional). So the probe's `fetch` swaps the exact body the client
// serialised for the D73 body built beside it, and refuses any other.
//
// Recorded per request: the time to the response headers, to the first
// `output_text` delta and to the end; input, cached, output and reasoning
// tokens; the status; whether the reply stayed inside the tags. Printed: the
// medians, 95th and 99th percentiles (nearest rank) and the constants derived
// from them (docs/certification/m94.md, "Probe"). MUSE_TAB_PROBE_DRY=1
// builds the 30 requests and prints them, with no key and no network.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type {
  CreateResponseBody,
  ResponseObject,
  StreamEvent,
} from '../../src/core/backends/modelapi/schemas'
import type { CoreLogger } from '../../src/core/logging'
import { estimateCostUsd } from '../../src/core/usage/insights'
import { isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { liveFetch } from '../../src/host/networkPosture'
import {
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_MODEL_ID,
  MODEL_API_BASE_URL,
  MODEL_API_EFFORT_OFF,
  PROMPT_CACHE_KEY_DIGEST_CHARS,
  PROMPT_CACHE_KEY_HASH,
  PROMPT_CACHE_KEY_PREFIX,
  SETTING_DEFAULTS,
  TAB_AUTOMATIC_LATENCY_CEILING_MS,
  TAB_CONTEXT_CHARS,
  TAB_FAST_MAX_LINES,
  TAB_FAST_PREFIX_CHARS,
  TAB_FAST_SUFFIX_CHARS,
  TAB_HOLE_MARKER,
  TAB_MODEL_TEXT,
  TAB_MULTILINE_MAX_LINES,
  TAB_MULTILINE_PREFIX_CHARS,
  TAB_MULTILINE_SUFFIX_CHARS,
  TAB_PREFIX_ANCHOR_LINES,
  TAB_PROMPT_CACHE_KEY_PREFIX,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const KEY_VARIABLE = 'MUSE_LIVE_MODEL_API_KEY'
const IS_LIVE =
  process.env['MUSE_LIVE_MODEL_API'] === '1' && Object.hasOwn(process.env, KEY_VARIABLE)
const IS_DRY = !IS_LIVE && process.env['MUSE_TAB_PROBE_DRY'] === '1'
const MODEL_ID = `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`
const LIVE_WORKSPACE = String.raw`C:\muse-live-ws`
const PAIRS = 10
const MULTILINE_REQUESTS = 10
const TYPED_AHEAD_CHARS = 3
const EXPECTED_CALLS = PAIRS * 2 + MULTILINE_REQUESTS
// A hard stop: the expected calls and a few retries, never more.
const MAX_ATTEMPTS = EXPECTED_CALLS + 4
// The probe measures how much the model reasons, so its caps leave room: a
// cap below the reasoning would end a reply before any text (A4).
const PROBE_FAST_MAX_OUTPUT_TOKENS = 1024
const PROBE_MULTILINE_MAX_OUTPUT_TOKENS = 2048
// The probe's own backstop per request; never expected to fire.
const REQUEST_DEADLINE_MS = 120_000
const PROBE_TIMEOUT_MS = 900_000
const META_HOST = new URL(MODEL_API_BASE_URL).host
const RESPONSES_PATH = `${new URL(MODEL_API_BASE_URL).pathname}/responses`
// The client's trace line for each answered attempt (client.ts, M39).
const ANSWERED = /^Model API POST \/responses answered 200 in \d+ ms$/
const RETRYING = /retrying in \d+ ms$/
const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const FAST_FILE_FUNCTIONS = 34
const MULTILINE_FILE_FUNCTIONS = 64
const HELPER_FUNCTIONS = 3
// Fast cursors sit in the last 40% of the file, 40% into a line.
const CURSOR_REGION_START = 0.6
const CURSOR_COLUMN_SHARE = 0.4
const MIN_CURSOR_LINE_CHARS = 18
const MULTILINE_REGION_START = 0.7

// --- how the constants are derived (docs/certification/m94.md, "Probe") ---

// D73's planned debounce (Continue's, research L1).
const PLANNED_DEBOUNCE_MS = 350
// Above a 60-WPM keystroke gap (about 200 ms), so typing a word sends nothing.
const DEBOUNCE_FLOOR_MS = 250
const DEBOUNCE_STEP_MS = 50
// A 100-character line of code is about 25 to 30 tokens.
const TOKENS_PER_LINE_ALLOWANCE = 32
const OUTPUT_CAP_STEP = 32
// Meta's floor for `max_output_tokens` (A4).
const MIN_OUTPUT_TOKENS = 16
const TIMEOUT_FACTOR = 2
const TIMEOUT_STEP_MS = 1000
const TIMEOUT_FLOOR_MS = 5000
// Research §7's mix and typing rates (billed requests per hour).
const MULTILINE_SHARE = 0.15
const BILLED_PER_HOUR = [270, 540, 1350] as const
const MEDIAN = 0.5
const P95 = 0.95
const P99 = 0.99

// The probe's instructions: the first draft of TAB_MODEL_TEXT, which lane C
// starts from. Lane 0's system text plus the two tags by name. The probe ran
// (2026-10-04) when that text said only "the reply tags"; FIXM94L0 has since
// named both tags in TAB_MODEL_TEXT itself, so they now appear twice here.
const PROBE_INSTRUCTIONS = [
  TAB_MODEL_TEXT.tabSystem,
  `Reply with exactly ${TAB_REPLY_OPEN_TAG}, then the missing code, then ${TAB_REPLY_CLOSE_TAG}, and nothing outside them; if nothing belongs at the hole, reply ${TAB_REPLY_OPEN_TAG}${TAB_REPLY_CLOSE_TAG}.`,
  `The completion starts at the exact character where ${TAB_HOLE_MARKER} stands and the suffix follows it directly, so never repeat the end of the prefix or the start of the suffix, and keep the file's indentation.`,
].join(' ')
// The mode's bound, after the suffix, so it never breaks the cached prefix.
const FAST_MODE_LINE = `Complete only the rest of the current line, or at most ${String(TAB_FAST_MAX_LINES)} lines.`
const MULTILINE_MODE_LINE = `Complete the code block at the hole, at most ${String(TAB_MULTILINE_MAX_LINES)} lines.`
// Tab's own key: its prefix and a digest of the model and the instructions (D73, A7).
const TAB_CACHE_KEY = `${TAB_PROMPT_CACHE_KEY_PREFIX}${createHash(PROMPT_CACHE_KEY_HASH)
  .update(JSON.stringify([MODEL_ID, PROBE_INSTRUCTIONS]))
  .digest('hex')
  .slice(0, PROMPT_CACHE_KEY_DIGEST_CHARS)}`

// --- the throwaway code ---

type Language = 'typescript' | 'python'
type Mode = 'fast' | 'multiline'

interface Domain {
  readonly type: string
  readonly plural: string
  readonly num: string
  readonly num2: string
  readonly str: string
}

const DOMAINS: readonly Domain[] = [
  { type: 'Order', plural: 'Orders', num: 'amount', num2: 'quantity', str: 'region' },
  { type: 'Shipment', plural: 'Shipments', num: 'weight', num2: 'distance', str: 'carrier' },
  { type: 'Reading', plural: 'Readings', num: 'value', num2: 'drift', str: 'sensor' },
  { type: 'Ticket', plural: 'Tickets', num: 'priority', num2: 'age', str: 'owner' },
  { type: 'Booking', plural: 'Bookings', num: 'price', num2: 'nights', str: 'guest' },
  { type: 'Sample', plural: 'Samples', num: 'score', num2: 'depth', str: 'station' },
  { type: 'Payment', plural: 'Payments', num: 'total', num2: 'fee', str: 'payer' },
  { type: 'Parcel', plural: 'Parcels', num: 'volume', num2: 'stops', str: 'courier' },
  { type: 'Visit', plural: 'Visits', num: 'duration', num2: 'retries', str: 'device' },
  { type: 'Invoice', plural: 'Invoices', num: 'balance', num2: 'discount', str: 'client' },
]
const ADJECTIVES = [
  'Active',
  'Recent',
  'Pending',
  'Large',
  'Flagged',
  'Local',
  'Urgent',
  'Weekly',
  'Open',
  'Shared',
  'Draft',
  'Primary',
  'Late',
  'Valid',
  'Cached',
  'Stale',
] as const
const VERBS = [
  'select',
  'total',
  'group',
  'find',
  'describe',
  'sort',
  'clamp',
  'count',
  'average',
  'partition',
] as const

// One template per verb, in VERBS' order. `%name%` slots, so the generated
// code's own braces and `${…}` stay as written.
const TEMPLATES: Readonly<Record<Language, readonly (readonly string[])[]>> = {
  typescript: [
    [
      'export function %fn%(items: readonly %T%[], limit: number): %T%[] {',
      '  const result: %T%[] = []',
      '  for (const item of items) {',
      '    if (result.length >= limit) {',
      '      break',
      '    }',
      '    if (item.%num% > %k%) {',
      '      result.push(item)',
      '    }',
      '  }',
      '  return result',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[]): number {',
      '  let total = 0',
      '  for (const item of items) {',
      '    total += item.%num% * %k%',
      '  }',
      '  return Math.round(total * 100) / 100',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[]): Map<string, %T%[]> {',
      '  const groups = new Map<string, %T%[]>()',
      '  for (const item of items) {',
      '    const key = item.%str%.trim().toLowerCase()',
      '    const group = groups.get(key) ?? []',
      '    group.push(item)',
      '    groups.set(key, group)',
      '  }',
      '  return groups',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[], id: string): %T% | undefined {',
      '  return items.find((item) => item.id === id && item.%num2% >= %k%)',
      '}',
    ],
    [
      'export function %fn%(item: %T%): string {',
      '  const label = item.%str%.length > %k% ? `${item.%str%.slice(0, %k%)}...` : item.%str%',
      '  return `${item.id}: ${label} (${item.%num%.toFixed(2)})`',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[], descending = false): %T%[] {',
      '  const sorted = [...items].sort((left, right) => left.%num2% - right.%num2%)',
      '  return descending ? sorted.reverse() : sorted',
      '}',
    ],
    [
      'export function %fn%(value: number, low = %k%, high = %k2%): number {',
      '  if (Number.isNaN(value)) {',
      '    return low',
      '  }',
      '  return Math.min(Math.max(value, low), high)',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[], %str%: string): number {',
      '  let count = 0',
      '  for (const item of items) {',
      '    if (item.%str% === %str% && item.%num% < %k2%) {',
      '      count += 1',
      '    }',
      '  }',
      '  return count',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[]): number {',
      '  if (items.length === 0) {',
      '    return 0',
      '  }',
      '  const sum = items.reduce((total, item) => total + item.%num2%, 0)',
      '  return sum / items.length',
      '}',
    ],
    [
      'export function %fn%(items: readonly %T%[], threshold = %k%): [%T%[], %T%[]] {',
      '  const above: %T%[] = []',
      '  const below: %T%[] = []',
      '  for (const item of items) {',
      '    if (item.%num% >= threshold) {',
      '      above.push(item)',
      '    } else {',
      '      below.push(item)',
      '    }',
      '  }',
      '  return [above, below]',
      '}',
    ],
  ],
  python: [
    [
      'def %fn%(items: list[%T%], limit: int) -> list[%T%]:',
      '    result: list[%T%] = []',
      '    for item in items:',
      '        if len(result) >= limit:',
      '            break',
      '        if item.%num% > %k%:',
      '            result.append(item)',
      '    return result',
    ],
    [
      'def %fn%(items: list[%T%]) -> float:',
      '    total = 0.0',
      '    for item in items:',
      '        total += item.%num% * %k%',
      '    return round(total, 2)',
    ],
    [
      'def %fn%(items: list[%T%]) -> dict[str, list[%T%]]:',
      '    groups: dict[str, list[%T%]] = {}',
      '    for item in items:',
      '        key = item.%str%.strip().lower()',
      '        groups.setdefault(key, []).append(item)',
      '    return groups',
    ],
    [
      'def %fn%(items: list[%T%], item_id: str) -> %T% | None:',
      '    for item in items:',
      '        if item.id == item_id and item.%num2% >= %k%:',
      '            return item',
      '    return None',
    ],
    [
      'def %fn%(item: %T%) -> str:',
      '    label = item.%str% if len(item.%str%) <= %k% else item.%str%[:%k%] + "..."',
      '    return f"{item.id}: {label} ({item.%num%:.2f})"',
    ],
    [
      'def %fn%(items: list[%T%], descending: bool = False) -> list[%T%]:',
      '    return sorted(items, key=lambda item: item.%num2%, reverse=descending)',
    ],
    [
      'def %fn%(value: float, low: float = %k%, high: float = %k2%) -> float:',
      '    if math.isnan(value):',
      '        return low',
      '    return min(max(value, low), high)',
    ],
    [
      'def %fn%(items: list[%T%], %str%: str) -> int:',
      '    count = 0',
      '    for item in items:',
      '        if item.%str% == %str% and item.%num% < %k2%:',
      '            count += 1',
      '    return count',
    ],
    [
      'def %fn%(items: list[%T%]) -> float:',
      '    if not items:',
      '        return 0.0',
      '    return sum(item.%num2% for item in items) / len(items)',
    ],
    [
      'def %fn%(items: list[%T%], threshold: float = %k%) -> tuple[list[%T%], list[%T%]]:',
      '    above: list[%T%] = []',
      '    below: list[%T%] = []',
      '    for item in items:',
      '        if item.%num% >= threshold:',
      '            above.append(item)',
      '        else:',
      '            below.append(item)',
      '    return above, below',
    ],
  ],
}
const EXTENSIONS: Readonly<Record<Language, string>> = { typescript: '.ts', python: '.py' }
const TS_BANNER = '// Generated throwaway code for the M94 Tab probe: not part of any project.'
const PY_BANNER = '"""Generated throwaway code for the M94 Tab probe: not part of any project."""'
const SLOT = /%(\w+)%/g
// Lines a fast cursor may sit in: statements a user types out.
const CURSOR_LINE_STARTS = [
  'return ',
  'const ',
  'let ',
  'if ',
  'total +=',
  'label =',
  'key =',
  'groups.',
  'result.',
  'count +=',
]

function substitute(lines: readonly string[], values: Readonly<Record<string, string>>): string[] {
  return lines.map((line) => line.replaceAll(SLOT, (whole, name: string) => values[name] ?? whole))
}

function tsModel(domain: Domain): string[] {
  return [
    `export interface ${domain.type} {`,
    '  readonly id: string',
    `  readonly ${domain.str}: string`,
    `  readonly ${domain.num}: number`,
    `  readonly ${domain.num2}: number`,
    '}',
  ]
}

function pyModel(domain: Domain): string[] {
  return [
    '@dataclass(frozen=True)',
    `class ${domain.type}:`,
    '    id: str',
    `    ${domain.str}: str`,
    `    ${domain.num}: float`,
    `    ${domain.num2}: float`,
  ]
}

/** The top of a file: the type declared in it (fast) or imported from `models` (multi-line). */
function fileHeader(language: Language, domain: Domain, isImported: boolean): string[] {
  if (language === 'typescript') {
    return isImported
      ? [TS_BANNER, '', `import type { ${domain.type} } from './models'`]
      : [TS_BANNER, '', ...tsModel(domain)]
  }
  const common = [PY_BANNER, '', 'from __future__ import annotations', '', 'import math']
  return isImported
    ? [...common, '', `from .models import ${domain.type}`]
    : [...common, 'from dataclasses import dataclass', '', '', ...pyModel(domain)]
}

function modelsFile(language: Language, domain: Domain): string {
  const lines =
    language === 'typescript'
      ? [TS_BANNER, '', ...tsModel(domain)]
      : [
          PY_BANNER,
          '',
          'from __future__ import annotations',
          '',
          'from dataclasses import dataclass',
          '',
          '',
          ...pyModel(domain),
        ]
  return `${lines.join('\n')}\n`
}

interface GeneratedFunction {
  /** The signature's line. */
  readonly start: number
  /** The body's first line and the line after its last (a TypeScript `}` or the gap). */
  readonly bodyStart: number
  readonly bodyEnd: number
}

function functionName(language: Language, verb: string, adjective: string, domain: Domain): string {
  return language === 'typescript'
    ? `${verb}${adjective}${domain.plural}`
    : `${verb}_${adjective.toLowerCase()}_${domain.plural.toLowerCase()}`
}

/** A file of `count` functions over one type; names and numbers vary with `seed`. */
function generateCode(
  language: Language,
  domain: Domain,
  seed: number,
  count: number,
  header: readonly string[],
): { readonly text: string; readonly functions: readonly GeneratedFunction[] } {
  const lines = [...header]
  const functions: GeneratedFunction[] = []
  const templates = TEMPLATES[language]
  const gap = language === 'python' ? ['', ''] : ['']
  for (let index = 0; index < count; index += 1) {
    const k = 2 + ((index * 7 + seed) % 23)
    const values = {
      fn: functionName(
        language,
        VERBS[index % VERBS.length]!,
        ADJECTIVES[(index + seed * 3) % ADJECTIVES.length]!,
        domain,
      ),
      T: domain.type,
      num: domain.num,
      num2: domain.num2,
      str: domain.str,
      k: String(k),
      k2: String(k + 50 + ((index * 13) % 40)),
    }
    lines.push(...gap)
    const start = lines.length
    lines.push(...substitute(templates[index % templates.length]!, values))
    functions.push({
      start,
      bodyStart: start + 1,
      bodyEnd: language === 'python' ? lines.length : lines.length - 1,
    })
  }
  return { text: `${lines.join('\n')}\n`, functions }
}

// --- the requests ---

interface Snippet {
  readonly path: string
  readonly text: string
}

interface ProbeRequest {
  readonly name: string
  readonly mode: Mode
  /** Which fast pair, and whether this is its second request. */
  readonly pair: number | undefined
  readonly isTypedAhead: boolean
  readonly languageId: Language
  readonly relativePath: string
  readonly prefix: string
  readonly suffix: string
  readonly snippets: readonly Snippet[]
  /** What the generated file held at the hole. */
  readonly expected: string
}

/** A path as the request names it: relative to the workspace, with forward slashes. */
function workspacePath(file: string): string {
  return path.relative(LIVE_WORKSPACE, file).split(path.sep).join('/')
}

function writeFile(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

/**
 * The prefix window: from the earliest line that is a multiple of
 * TAB_PREFIX_ANCHOR_LINES and still fits `maxChars`, to the cursor (D73), so
 * its start stays put while the user types.
 */
function prefixWindow(
  lines: readonly string[],
  line: number,
  column: number,
  maxChars: number,
): string {
  const head = lines[line]!.slice(0, column)
  for (let anchor = 0; anchor <= line; anchor += TAB_PREFIX_ANCHOR_LINES) {
    const window = [...lines.slice(anchor, line), head].join('\n')
    if (window.length <= maxChars) {
      return window
    }
  }
  return head.slice(-maxChars)
}

/** The suffix window, cut at the last line end that fits. */
function suffixWindow(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  const cut = text.lastIndexOf('\n', maxChars)
  return text.slice(0, cut > 0 ? cut : maxChars)
}

function languageOf(index: number): Language {
  return index % 2 === 0 ? 'typescript' : 'python'
}

function domainOf(index: number): Domain {
  return DOMAINS[index % DOMAINS.length]!
}

/** One fast pair: the cursor 40% into a statement, then three characters on. */
function fastPair(root: string, pair: number): readonly ProbeRequest[] {
  const languageId = languageOf(pair)
  const domain = domainOf(pair)
  const file = path.join(
    root,
    `fast-${String(pair).padStart(2, '0')}`,
    `${domain.plural.toLowerCase()}${EXTENSIONS[languageId]}`,
  )
  const generated = generateCode(
    languageId,
    domain,
    pair,
    FAST_FILE_FUNCTIONS,
    fileHeader(languageId, domain, false),
  )
  writeFile(file, generated.text)
  // Read back as the provider reads a document.
  const lines = readFileSync(file, 'utf8').split('\n')
  const candidates = lines
    .map((text, line) => ({ text, line }))
    .filter(
      ({ text, line }) =>
        line >= Math.floor(lines.length * CURSOR_REGION_START) &&
        text.trim().length >= MIN_CURSOR_LINE_CHARS &&
        CURSOR_LINE_STARTS.some((start) => text.trim().startsWith(start)),
    )
  const chosen = candidates[(pair * 7) % candidates.length]!
  const indent = chosen.text.length - chosen.text.trimStart().length
  const column = indent + Math.floor(chosen.text.trim().length * CURSOR_COLUMN_SHARE)
  // The rest of the line is the hole: the user has not typed it yet.
  const suffix = suffixWindow(`\n${lines.slice(chosen.line + 1).join('\n')}`, TAB_FAST_SUFFIX_CHARS)
  return [0, TYPED_AHEAD_CHARS].map((typed) => ({
    name: `fast-${String(pair).padStart(2, '0')}${typed === 0 ? 'a' : 'b'}`,
    mode: 'fast' as const,
    pair,
    isTypedAhead: typed > 0,
    languageId,
    relativePath: workspacePath(file),
    prefix: prefixWindow(lines, chosen.line, column + typed, TAB_FAST_PREFIX_CHARS),
    suffix,
    snippets: [],
    expected: chosen.text.slice(column + typed),
  }))
}

/**
 * One multi-line request: a function's body is the hole. Even ones put the
 * cursor after the block opener, odd ones on the blank indented line below
 * it (D73's two multi-line cases). The type's definition and a recently
 * edited helper are the context snippets, sorted by path.
 */
function multilineRequest(root: string, index: number): ProbeRequest {
  const languageId = languageOf(index)
  const domain = domainOf(index + PAIRS / 2)
  const folder = path.join(root, `multi-${String(index).padStart(2, '0')}`)
  const extension = EXTENSIONS[languageId]
  const file = path.join(folder, `${domain.plural.toLowerCase()}${extension}`)
  const header = fileHeader(languageId, domain, true)
  const generated = generateCode(
    languageId,
    domain,
    index + PAIRS,
    MULTILINE_FILE_FUNCTIONS,
    header,
  )
  writeFile(file, generated.text)
  const models = writeFile(path.join(folder, `models${extension}`), modelsFile(languageId, domain))
  const helpers = writeFile(
    path.join(folder, `helpers${extension}`),
    generateCode(languageId, domain, index + PAIRS * 2, HELPER_FUNCTIONS, header).text,
  )
  const lines = readFileSync(file, 'utf8').split('\n')
  const target =
    generated.functions[
      Math.floor(generated.functions.length * MULTILINE_REGION_START) + (index % 4)
    ]!
  const signature = lines[target.start]!
  const body = lines.slice(target.bodyStart, target.bodyEnd)
  const firstLine = body[0] ?? ''
  const indent = firstLine.slice(0, firstLine.length - firstLine.trimStart().length)
  const window = prefixWindow(lines, target.start, signature.length, TAB_MULTILINE_PREFIX_CHARS)
  const isBlankLine = index % 2 === 1
  let budget = TAB_CONTEXT_CHARS
  const snippets: Snippet[] = []
  const sources = [helpers, models].toSorted((left, right) => left.localeCompare(right))
  for (const source of sources) {
    const text = readFileSync(source, 'utf8').slice(0, Math.max(budget, 0))
    budget -= text.length
    if (text !== '') {
      snippets.push({ path: workspacePath(source), text })
    }
  }
  return {
    name: `multi-${String(index).padStart(2, '0')}`,
    mode: 'multiline',
    pair: undefined,
    isTypedAhead: false,
    languageId,
    relativePath: workspacePath(file),
    prefix: isBlankLine ? `${window}\n${indent}` : window,
    suffix: suffixWindow(`\n${lines.slice(target.bodyEnd).join('\n')}`, TAB_MULTILINE_SUFFIX_CHARS),
    snippets,
    expected: isBlankLine ? body.join('\n').slice(indent.length) : `\n${body.join('\n')}`,
  }
}

function buildRequests(root: string): readonly ProbeRequest[] {
  return [
    ...Array.from({ length: PAIRS }, (_unused, pair) => fastPair(root, pair)).flat(),
    ...Array.from({ length: MULTILINE_REQUESTS }, (_unused, index) =>
      multilineRequest(root, index),
    ),
  ]
}

/** The one user message: lane 0's template, then the mode's bound. */
function userText(request: ProbeRequest): string {
  const snippets = request.snippets
    .map(
      (snippet) =>
        `\`\`\`${request.languageId} path=${snippet.path} context\n${snippet.text}\n\`\`\``,
    )
    .join('\n')
  const message = fill(TAB_MODEL_TEXT.tabUserTemplate, {
    path: request.relativePath,
    languageId: request.languageId,
    snippets,
    prefix: request.prefix,
    holeMarker: TAB_HOLE_MARKER,
    suffix: request.suffix,
  })
  return `${message}\n${request.mode === 'fast' ? FAST_MODE_LINE : MULTILINE_MODE_LINE}`
}

/** D73's request: no tools, no reasoning summary, nothing stored, no previous response. */
type TabWireBody = Omit<CreateResponseBody, 'tools' | 'tool_choice' | 'include' | 'reasoning'> & {
  readonly reasoning: { readonly effort: string }
}

function requestBodies(request: ProbeRequest): {
  readonly client: CreateResponseBody
  readonly wire: TabWireBody
} {
  const input: CreateResponseBody['input'] = [
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: userText(request) }] },
  ]
  const wire: TabWireBody = {
    model: MODEL_ID,
    instructions: PROBE_INSTRUCTIONS,
    input,
    reasoning: { effort: MODEL_API_EFFORT_OFF },
    stream: true,
    store: false,
    max_output_tokens:
      request.mode === 'fast' ? PROBE_FAST_MAX_OUTPUT_TOKENS : PROBE_MULTILINE_MAX_OUTPUT_TOKENS,
    prompt_cache_key: TAB_CACHE_KEY,
    prompt_cache_retention: SETTING_DEFAULTS.modelApiPromptCacheRetention,
  }
  return {
    client: {
      ...wire,
      reasoning: { effort: MODEL_API_EFFORT_OFF, summary: 'auto' },
      tools: [],
      tool_choice: 'auto',
      include: [],
    },
    wire,
  }
}

// --- the wire ---

interface ProbeRecord {
  readonly name: string
  readonly mode: Mode
  readonly pair: number | undefined
  readonly isTypedAhead: boolean
  readonly languageId: Language
  readonly promptChars: number
  readonly prefixChars: number
  readonly suffixChars: number
  readonly snippetChars: number
  readonly expected: string
  httpStatus: number
  status: string
  headersMs: number | undefined
  firstTextMs: number | undefined
  totalMs: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  reasoningTokens: number
  hasUsage: boolean
  retries: number
  reply: string
  isInsideTags: boolean
  hasTags: boolean
  isFirstLineMatch: boolean
}

const live: { key: string | undefined } = { key: undefined }
/** The D73 body for each body the client serialises. */
const swaps = new Map<string, string>()
/** Every body sent, as sent. */
const sent: string[] = []
const attempts: { status: number }[] = []
const current: { record: ProbeRecord | undefined; startedAt: number } = {
  record: undefined,
  startedAt: 0,
}
/** The client's log lines as it wrote them; printed only through `report`. */
const logged: string[] = []

/** Anything this file prints goes through here: the key never reaches the output. */
function scrub(text: string): string {
  return live.key === undefined ? text : text.replaceAll(live.key, '[key]')
}

/** Straight to stderr: vitest's reporter keeps a passing test's console to itself. */
function report(text: string): void {
  process.stderr.write(`${scrub(text)}\n`)
}

function refusal(message: string): Response {
  return Response.json(
    { error: { message, type: 'tab_probe', code: 'tab_probe' } },
    { status: HTTP_BAD_REQUEST },
  )
}

/** The client's `fetch`: Meta only, D73's body swapped in, each attempt counted and timed. */
async function probeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.host !== META_HOST || url.pathname !== RESPONSES_PATH) {
    return refusal(`the probe sends only POST ${RESPONSES_PATH}`)
  }
  if (attempts.length >= MAX_ATTEMPTS) {
    return refusal(`the probe's ${String(MAX_ATTEMPTS)} attempts are spent`)
  }
  const body = typeof init?.body === 'string' ? swaps.get(init.body) : undefined
  if (body === undefined) {
    return refusal('the probe sends only the bodies it built')
  }
  const attempt = { status: 0 }
  attempts.push(attempt)
  sent.push(body)
  const response = await liveFetch(input, { ...init, body })
  attempt.status = response.status
  if (current.record !== undefined) {
    current.record.httpStatus = response.status
    current.record.headersMs = performance.now() - current.startedAt
  }
  return response
}

const appendLog =
  (level: string) =>
  (message: string): void => {
    logged.push(`${level} ${message}`)
  }
const recordingLog: CoreLogger = {
  trace: appendLog('trace'),
  info: appendLog('info'),
  warn: appendLog('warn'),
  error: appendLog('error'),
}

function readTerminal(record: ProbeRecord, response: ResponseObject): void {
  const reason = response.incomplete_details?.reason
  record.status = reason === undefined ? response.status : `${response.status} (${reason})`
  const usage = response.usage
  if (usage == null) {
    return
  }
  record.hasUsage = true
  record.inputTokens = usage.input_tokens
  record.cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
  record.outputTokens = usage.output_tokens
  record.reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0
}

/** The first line with text, trimmed: what a suggestion shows first. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  )
}

/** Whether the reply holds one tag pair, and whether nothing but space is outside it. */
function readTags(record: ProbeRecord): void {
  const open = record.reply.indexOf(TAB_REPLY_OPEN_TAG)
  const close = record.reply.lastIndexOf(TAB_REPLY_CLOSE_TAG)
  if (open === -1 || close < open) {
    return
  }
  const completion = record.reply.slice(open + TAB_REPLY_OPEN_TAG.length, close)
  record.hasTags = true
  record.isInsideTags =
    record.reply.slice(0, open).trim() === '' &&
    record.reply.slice(close + TAB_REPLY_CLOSE_TAG.length).trim() === '' &&
    !completion.includes(TAB_REPLY_OPEN_TAG) &&
    !completion.includes(TAB_REPLY_CLOSE_TAG)
  record.isFirstLineMatch = firstLine(completion) === firstLine(record.expected)
}

/** What one stream event adds: the first text's time, the reply, the terminal status and usage. */
function readEvent(record: ProbeRecord, event: StreamEvent, startedAt: number): void {
  switch (event.type) {
    case 'response.output_text.delta': {
      record.firstTextMs ??= performance.now() - startedAt
      record.reply += event.delta
      break
    }
    case 'response.completed':
    case 'response.incomplete':
    case 'response.failed': {
      readTerminal(record, event.response)
      break
    }
    case 'error': {
      record.status = `stream error ${event.code ?? ''}`.trim()
      break
    }
    default: {
      break
    }
  }
}

function newRecord(request: ProbeRequest, promptChars: number): ProbeRecord {
  return {
    name: request.name,
    mode: request.mode,
    pair: request.pair,
    isTypedAhead: request.isTypedAhead,
    languageId: request.languageId,
    promptChars,
    prefixChars: request.prefix.length,
    suffixChars: request.suffix.length,
    snippetChars: sum(request.snippets.map((snippet) => snippet.text.length)),
    expected: request.expected,
    httpStatus: 0,
    status: 'not sent',
    headersMs: undefined,
    firstTextMs: undefined,
    totalMs: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    hasUsage: false,
    retries: 0,
    reply: '',
    isInsideTags: false,
    hasTags: false,
    isFirstLineMatch: false,
  }
}

/** One request through the real client, read to its end: a sent request is never aborted. */
async function send(client: ModelApiClient, request: ProbeRequest): Promise<ProbeRecord> {
  const bodies = requestBodies(request)
  swaps.set(JSON.stringify(bodies.client), JSON.stringify(bodies.wire))
  const record = newRecord(request, PROBE_INSTRUCTIONS.length + userText(request).length)
  current.record = record
  const startedAt = performance.now()
  current.startedAt = startedAt
  try {
    const events = client.streamResponse(
      bodies.client,
      AbortSignal.timeout(REQUEST_DEADLINE_MS),
      () => {
        record.retries += 1
      },
    )
    for await (const event of events) {
      readEvent(record, event, startedAt)
    }
  } catch (error: unknown) {
    record.status = `failed: ${scrub(error instanceof Error ? error.message : String(error))}`
  }
  record.totalMs = performance.now() - startedAt
  current.record = undefined
  readTags(record)
  return record
}

// --- the numbers ---

interface Spread {
  readonly n: number
  readonly min: number
  readonly median: number
  readonly p95: number
  readonly p99: number
  readonly max: number
}

/** Nearest rank: the smallest value with at least `fraction` of the values at or below it. */
function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(Math.ceil(fraction * sorted.length) - 1, 0)] ?? NaN
}

function spread(values: readonly number[]): Spread {
  const sorted = values.toSorted((left, right) => left - right)
  return {
    n: sorted.length,
    min: sorted[0] ?? NaN,
    median: percentile(sorted, MEDIAN),
    p95: percentile(sorted, P95),
    p99: percentile(sorted, P99),
    max: sorted.at(-1) ?? NaN,
  }
}

function sum(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    total += value
  }
  return total
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? NaN : sum(values) / values.length
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function costOf(record: ProbeRecord, modelId: string): number {
  return estimateCostUsd(
    {
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedTokens: record.cachedTokens,
    },
    modelId,
  )
}

function hitRate(records: readonly ProbeRecord[]): number {
  return (
    sum(records.map((record) => record.cachedTokens)) /
    sum(records.map((record) => record.inputTokens))
  )
}

function modeSpreads(records: readonly ProbeRecord[]) {
  return {
    headersMs: spread(records.flatMap((record) => record.headersMs ?? [])),
    firstTextMs: spread(records.flatMap((record) => record.firstTextMs ?? [])),
    totalMs: spread(records.map((record) => record.totalMs)),
    inputTokens: spread(records.map((record) => record.inputTokens)),
    cachedTokens: spread(records.map((record) => record.cachedTokens)),
    outputTokens: spread(records.map((record) => record.outputTokens)),
    reasoningTokens: spread(records.map((record) => record.reasoningTokens)),
    visibleTokens: spread(records.map((record) => record.outputTokens - record.reasoningTokens)),
    withoutText: records.filter((record) => record.firstTextMs === undefined).length,
    insideTags: records.filter((record) => record.isInsideTags).length,
    tagged: records.filter((record) => record.hasTags).length,
    firstLineMatches: records.filter((record) => record.isFirstLineMatch).length,
    contributorUsd: mean(records.map((record) => costOf(record, MODEL_ID))),
    standardUsd: mean(records.map((record) => costOf(record, DEFAULT_MODEL_ID))),
  }
}

/** A mode's output cap: the p99 reasoning plus its completion allowance, in steps of 32. */
function outputCap(spreads: ReturnType<typeof modeSpreads>, maxLines: number): number {
  const allowance = Math.max(maxLines * TOKENS_PER_LINE_ALLOWANCE, spreads.visibleTokens.p99)
  return Math.max(
    roundUp(spreads.reasoningTokens.p99 + allowance, OUTPUT_CAP_STEP),
    MIN_OUTPUT_TOKENS,
  )
}

/**
 * The debounce is shortened only when that brings the median fast suggestion
 * (debounce plus first text) under the ceiling without going below the floor.
 * Otherwise the planned value stays: a shorter wait would add billed
 * requests, which are never aborted, and buy nothing the user would notice.
 */
function debounceFor(medianFirstTextMs: number): number {
  const room = TAB_AUTOMATIC_LATENCY_CEILING_MS - medianFirstTextMs
  return room >= PLANNED_DEBOUNCE_MS || room < DEBOUNCE_FLOOR_MS
    ? PLANNED_DEBOUNCE_MS
    : Math.floor(room / DEBOUNCE_STEP_MS) * DEBOUNCE_STEP_MS
}

function derive(records: readonly ProbeRecord[]) {
  const fast = modeSpreads(records.filter((record) => record.mode === 'fast'))
  const multiline = modeSpreads(records.filter((record) => record.mode === 'multiline'))
  const medianFast = fast.firstTextMs.median
  // Research §7's mix: 85% fast, 15% multi-line.
  const mixedPerRequest = (tier: 'contributorUsd' | 'standardUsd') =>
    (1 - MULTILINE_SHARE) * fast[tier] + MULTILINE_SHARE * multiline[tier]
  return {
    fast,
    multiline,
    all: modeSpreads(records),
    cacheHitRate: {
      typedAhead: hitRate(records.filter((record) => record.isTypedAhead)),
      firstOfPair: hitRate(
        records.filter((record) => record.mode === 'fast' && !record.isTypedAhead),
      ),
      multiline: hitRate(records.filter((record) => record.mode === 'multiline')),
      all: hitRate(records),
    },
    constants: {
      TAB_DEBOUNCE_MS: debounceFor(medianFast),
      TAB_FAST_MAX_OUTPUT_TOKENS: outputCap(fast, TAB_FAST_MAX_LINES),
      TAB_MULTILINE_MAX_OUTPUT_TOKENS: outputCap(multiline, TAB_MULTILINE_MAX_LINES),
      TAB_REQUEST_TIMEOUT_MS: Math.max(
        roundUp(
          TIMEOUT_FACTOR * spread(records.map((record) => record.totalMs)).p99,
          TIMEOUT_STEP_MS,
        ),
        TIMEOUT_FLOOR_MS,
      ),
      tabTrigger: medianFast > TAB_AUTOMATIC_LATENCY_CEILING_MS ? 'onInvoke' : 'automatic',
    },
    perHour: BILLED_PER_HOUR.map((billed) => ({
      billed,
      standardUsd: billed * mixedPerRequest('standardUsd'),
      contributorUsd: billed * mixedPerRequest('contributorUsd'),
    })),
  }
}

function formatMs(value: number | undefined): string {
  return value === undefined ? '-' : `${String(Math.round(value))} ms`
}

/** `strict` when nothing is outside the tags, `loose` when something is, `none` without them. */
function tagWord(record: ProbeRecord): string {
  if (record.isInsideTags) {
    return 'strict'
  }
  return record.hasTags ? 'loose' : 'none'
}

function describeRecord(record: ProbeRecord): string {
  return [
    `tab probe ${record.name} (${record.languageId}): http ${String(record.httpStatus)} ${record.status}`,
    `headers ${formatMs(record.headersMs)}, first text ${formatMs(record.firstTextMs)}, total ${formatMs(record.totalMs)}`,
    `in ${String(record.inputTokens)} (cached ${String(record.cachedTokens)}) out ${String(record.outputTokens)} (reasoning ${String(record.reasoningTokens)})`,
    `tags ${tagWord(record)}, first line ${record.isFirstLineMatch ? 'matches' : 'differs'}`,
    `retries ${String(record.retries)}`,
    `reply ${JSON.stringify(record.reply)} expected ${JSON.stringify(record.expected)}`,
  ].join(' | ')
}

const sentSchema = z.object({
  model: z.string(),
  stream: z.boolean(),
  store: z.boolean(),
  max_output_tokens: z.number(),
  prompt_cache_key: z.string(),
  reasoning: z.object({ effort: z.string(), summary: z.optional(z.unknown()) }),
  tools: z.optional(z.unknown()),
  tool_choice: z.optional(z.unknown()),
  include: z.optional(z.unknown()),
  previous_response_id: z.optional(z.unknown()),
})

describe.skipIf(!IS_LIVE && !IS_DRY)(
  'the Tab latency probe, live (MUSE_LIVE_MODEL_API=1; MUSE_TAB_PROBE_DRY=1 sends nothing)',
  () => {
    let root = ''
    beforeAll(() => {
      if (IS_LIVE) {
        const raw: string | undefined = process.env[KEY_VARIABLE]
        const key = raw?.trim()
        Reflect.deleteProperty(process.env, KEY_VARIABLE)
        if (key === undefined || !isValidModelApiKey(key)) {
          throw new Error(`${KEY_VARIABLE} does not hold a Model API key.`)
        }
        live.key = key
      }
      if (!existsSync(LIVE_WORKSPACE)) {
        throw new Error(`The live workspace ${LIVE_WORKSPACE} does not exist.`)
      }
      root = mkdtempSync(path.join(LIVE_WORKSPACE, 'tab-probe-'))
    })
    afterAll(() => {
      if (root !== '') {
        rmSync(root, { recursive: true, force: true })
      }
      live.key = undefined
    })

    it(
      `sends ${String(EXPECTED_CALLS)} Tab-shaped requests and derives the probe-tuned constants`,
      async () => {
        const requests = buildRequests(root)
        expect(requests).toHaveLength(EXPECTED_CALLS)
        for (const [index, request] of requests.entries()) {
          expect(request.expected.trim(), request.name).not.toBe('')
          if (request.isTypedAhead) {
            // The second of a pair extends the first one's prefix (D73's anchor).
            expect(request.prefix.startsWith(requests[index - 1]!.prefix), request.name).toBe(true)
          }
        }
        report(`tab probe instructions: ${JSON.stringify(PROBE_INSTRUCTIONS)}`)
        report(`tab probe cache key: ${TAB_CACHE_KEY}`)
        for (const request of requests) {
          report(
            `tab probe request ${request.name}: prompt ${String(PROBE_INSTRUCTIONS.length + userText(request).length)} chars (prefix ${String(request.prefix.length)}, suffix ${String(request.suffix.length)}, snippets ${String(request.snippets.length)})`,
          )
        }
        if (IS_DRY) {
          report(`tab probe user text, fast: ${JSON.stringify(userText(requests[0]!))}`)
          report(`tab probe user text, multi-line: ${JSON.stringify(userText(requests.at(-1)!))}`)
          return
        }
        const client = new ModelApiClient({
          fetch: probeFetch,
          baseUrl: MODEL_API_BASE_URL,
          apiKey: () => Promise.resolve(live.key),
          sleep: (ms) => delay(ms),
          now: Date.now,
          random: Math.random,
          log: recordingLog,
        })
        const records: ProbeRecord[] = []
        for (const request of requests) {
          const record = await send(client, request)
          records.push(record)
          report(describeRecord(record))
          // A failed request stops the run: the rest would fail the same way.
          if (record.httpStatus !== HTTP_OK || !record.hasUsage) {
            break
          }
        }
        const answered = logged.filter(
          (line) => line.startsWith('trace ') && ANSWERED.test(line.slice('trace '.length)),
        ).length
        const retryLines = logged.filter((line) => RETRYING.test(line)).length
        const retries = sum(records.map((record) => record.retries))
        const derived = derive(records)
        report(
          `tab probe calls: ${String(attempts.length)} HTTP attempts (expected ${String(EXPECTED_CALLS)}), ${String(answered)} answered per the client's trace, ${String(records.filter((record) => record.hasUsage).length)} with usage, ${String(retries)} retries (${String(retryLines)} retry lines), statuses ${attempts.map((attempt) => String(attempt.status)).join(',')}`,
        )
        report(`tab probe derived: ${JSON.stringify(derived, undefined, 2)}`)
        report(`tab probe json: ${JSON.stringify({ records, derived })}`)
        report(`tab probe log: ${JSON.stringify(logged)}`)

        expect(records.map((record) => `${record.name} ${String(record.httpStatus)}`)).toEqual(
          requests.map((request) => `${request.name} ${String(HTTP_OK)}`),
        )
        expect(records.filter((record) => !record.hasUsage).map((record) => record.name)).toEqual(
          [],
        )
        expect(attempts).toHaveLength(EXPECTED_CALLS + retries)
        expect(answered).toBe(EXPECTED_CALLS)
        // Every body on the wire had D73's shape and Tab's own cache key.
        for (const body of sent) {
          const parsed = sentSchema.parse(JSON.parse(body))
          expect(parsed).toMatchObject({ model: MODEL_ID, stream: true, store: false })
          expect(parsed.reasoning).toEqual({ effort: MODEL_API_EFFORT_OFF })
          expect([
            parsed.tools,
            parsed.tool_choice,
            parsed.include,
            parsed.previous_response_id,
          ]).toEqual([undefined, undefined, undefined, undefined])
          expect(parsed.prompt_cache_key.startsWith(TAB_PROMPT_CACHE_KEY_PREFIX)).toBe(true)
          expect(parsed.prompt_cache_key.startsWith(PROMPT_CACHE_KEY_PREFIX)).toBe(false)
        }
        expect(logged.some((line) => live.key !== undefined && line.includes(live.key))).toBe(false)
      },
      PROBE_TIMEOUT_MS,
    )
  },
)
