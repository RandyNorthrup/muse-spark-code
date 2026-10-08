import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

// Structural money guard (PORTS017C). The regex guard in paidMoneyPorts.test.ts
// only sees `…Usd: number` declarations. This guard reads the actual zod
// schemas and type declarations under src/shared and src/core and flags any
// money-named key whose leaf type is a JavaScript number, including numbers
// hidden behind local aliases (`coldCacheUsd: amount` where
// `amount = z.number()`), wrappers (`z.optional(...)`) and cross-file imports.
// A new numeric money field anywhere in these trees must fail this test.
// Reviewed non-money numbers live on ALLOW_LIST, each with a one-line reason;
// an allow-list entry that matches nothing fails as stale, so converted fields
// cannot linger here.

// `usd` is lowercase here on purpose: the legacy journal row names its total
// `usd`, and a new lowercase money field must fail this guard too.
const MONEY_KEY = /(?:[Uu]sd|Cost|Price|Budget|Cap)|^spend/
const MONEY_HINT = /[Uu]sd|Cost|Price|Budget|Cap|spend/

// Boundary schemas that normalize legacy numbers to UsdAmount once. Names in
// this set are exact money even when their definition mentions z.number().
const SANCTIONED = new Set([
  'legacyUsdSchema',
  'usdInputSchema',
  'usdAmountSchema',
  'nonnegativeUsdSchema',
])

const ALLOW_LIST: Readonly<Record<string, string>> = {
  // Versioned read of pre-exact journal rows; parseUsd normalizes each value once on read.
  'core/usage/accountUsage.ts:settledUsd':
    'Versioned read of pre-exact journal rows; parseUsd normalizes each value once on read.',
  'core/usage/accountUsage.ts:reservedUsd':
    'Versioned read of pre-exact journal rows; parseUsd normalizes each value once on read.',
  'core/usage/accountUsage.ts:uncertainUsd':
    'Versioned read of pre-exact journal rows; parseUsd normalizes each value once on read.',
  // OpenRouter /key wire rows filled by the host; rendered only, converted
  // exactly via Usd.from at the insights display boundary.
  'shared/usage.ts:costUsd':
    'OpenRouter /key wire row filled by the host; rendered only, converted exactly via Usd.from at the insights display boundary.',
  'shared/usage.ts:todayUsd':
    'OpenRouter /key wire row filled by the host; rendered only, converted exactly via Usd.from at the insights display boundary.',
  'shared/usage.ts:monthUsd':
    'OpenRouter /key wire row filled by the host; rendered only, converted exactly via Usd.from at the insights display boundary.',
  'shared/usage.ts:limitUsd':
    'OpenRouter /key wire row filled by the host; rendered only, converted exactly via Usd.from at the insights display boundary.',
  'shared/usage.ts:remainingUsd':
    'OpenRouter /key wire row filled by the host; rendered only, converted exactly via Usd.from at the insights display boundary.',
  // OpenRouter key-usage wire shape with no production writer (fixtures only);
  // live Account & usage rows use usage.ts providerUsageRowSchema.
  'shared/modelsPanel.ts:dayUsd':
    'OpenRouter key-usage wire shape with no production writer (fixtures only); live rows use usage.ts providerUsageRowSchema.',
  'shared/modelsPanel.ts:monthUsd':
    'OpenRouter key-usage wire shape with no production writer (fixtures only); live rows use usage.ts providerUsageRowSchema.',
  'shared/modelsPanel.ts:limitUsd':
    'OpenRouter key-usage wire shape with no production writer (fixtures only); live rows use usage.ts providerUsageRowSchema.',
  'shared/modelsPanel.ts:remainingUsd':
    'OpenRouter key-usage wire shape with no production writer (fixtures only); live rows use usage.ts providerUsageRowSchema.',
  // Persisted usage-journal numeric format; converted exactly via Usd.from at
  // the insights display boundary.
  'shared/usagePage.ts:usd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:apiEquivalentUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:spentUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:capUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:uncertainUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:projectedUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  'shared/usagePage.ts:cacheUsd':
    'Persisted usage-journal numeric format; converted exactly via Usd.from at the insights display boundary.',
  // Persisted usage-journal numeric rows; converted exactly via Usd.from at
  // the insights display boundary.
  'shared/usageJournal.ts:usd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  'shared/usageJournal.ts:apiEquivalentUsd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  'shared/usageJournal.ts:usedUsd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  'shared/usageJournal.ts:limitUsd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  'shared/usageJournal.ts:remainingUsd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  'core/usage/aggregate.ts:usd':
    'Persisted usage-journal numeric row; converted exactly via Usd.from at the insights display boundary.',
  // Numeric team attempt and usage costs; tracked for follow-up conversion.
  'shared/team.ts:costUsd':
    'Numeric team attempt and usage cost; tracked for follow-up conversion.',
  'shared/team.ts:reportedCostUsd':
    'Numeric team attempt and usage cost; tracked for follow-up conversion.',
  'shared/team.ts:estimatedCostUsd':
    'Numeric team attempt and usage cost; tracked for follow-up conversion.',
  // Team view display state; tracked for follow-up conversion.
  'shared/teamView.ts:costUsd': 'Team view display state; tracked for follow-up conversion.',
  'shared/teamView.ts:spentUsdToday': 'Team view display state; tracked for follow-up conversion.',
  'shared/teamView.ts:budgetUsdToday': 'Team view display state; tracked for follow-up conversion.',
  // M117 resource-governor demand quantity, not ledger money.
  'shared/estimate.ts:accountUsdPerHour':
    'M117 resource-governor demand quantity, not ledger money.',
  // Captured catalog price shape; converted once via usdNanos at recommend.ts:160.
  'shared/estimate.ts:hourlyUsd':
    'Captured catalog price shape; converted once via usdNanos at recommend.ts:160.',
  // Catalog per-unit prices (USD per million tokens); display and comparison only.
  'core/agent/agentBackend.ts:inputUsdPerMTokens':
    'Catalog per-unit price; display and comparison only, never ledger arithmetic.',
  'core/agent/agentBackend.ts:outputUsdPerMTokens':
    'Catalog per-unit price; display and comparison only, never ledger arithmetic.',
  'shared/protocol.ts:inputUsdPerMTokens':
    'Catalog per-unit price; display and comparison only, never ledger arithmetic.',
  'shared/protocol.ts:outputUsdPerMTokens':
    'Catalog per-unit price; display and comparison only, never ledger arithmetic.',
  'core/team/intensity.ts:cachedUsdPerMTok':
    'Catalog per-unit price; display and comparison only, never ledger arithmetic.',
  // Token counts, not money.
  'shared/paid.ts:dailyBudgetTokens': 'Token count, not money.',
  'core/team/teamPaid.ts:dailyBudgetTokens': 'Token count, not money.',
  'core/team/capValidation.ts:teamDailyBudgetTokens': 'Token count, not money.',
  'core/team/intensity.ts:dailyBudgetTokens': 'Token count, not money.',
  'core/team/teamMeter.ts:teamDailyBudgetTokens': 'Token count, not money.',
  'core/team/teamMeter.ts:workspaceDailyBudgetTokens': 'Token count, not money.',
  'core/team/modelSettings.ts:thinkingBudgetTokens': 'Token count, not money.',
  'core/team/modelSettings.ts:contextCapTokens': 'Token count, not money.',
  'core/team/teamPool.ts:tokensCap': 'Token count, not money.',
  'core/backends/modelapi/goals.ts:tokenBudget': 'Token count, not money.',
  // Model thinking budgets in tokens, not money.
  'core/backends/modelapi/codecs/anthropic.ts:thinkingBudget':
    'Model thinking budget in tokens, not money.',
  'core/backends/modelapi/codecs/gemini.ts:explicitBudget':
    'Model thinking budget in tokens, not money.',
  // Character count, not money.
  'core/backends/modelapi/ModelApiHost.ts:mediaBudgetMaxEncodedChars':
    'Character count, not money.',
  // Durations in milliseconds, not money.
  'core/codeIntel/repoMap.ts:timeBudgetMs': 'Duration in milliseconds, not money.',
  'core/reporting/history.ts:probeBudgetMs': 'Duration in milliseconds, not money.',
  'shared/retryPolicy.ts:retryAfterCapMs': 'Duration in milliseconds, not money.',
  // Worker counts, not money.
  'core/team/intensity.ts:runningCap': 'Worker count, not money.',
  'core/team/intensity.ts:configuredCap': 'Worker count, not money.',
  // xAI integer vendor unit (1e-10 USD ticks); converted once at priceCard.ts:165.
  'core/usage/journalRecord.ts:costInUsdTicks':
    'xAI integer vendor unit (1e-10 USD ticks); converted once at priceCard.ts:165.',
  // Captured vendor frame field (integer ticks); converted exactly via Usd
  // arithmetic at settledCostOf in the same file.
  'core/backends/modelapi/codecs/responses.ts:cost_in_usd_ticks':
    'Captured vendor frame field (integer ticks); converted exactly via Usd arithmetic at settledCostOf.',
  // Team price-preview rates and totals in USD; display and comparison only.
  'core/team/autofill.ts:usdPerMTokInput':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/capValidation.ts:usdPerMTok':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/intensity.ts:usdPerMTok':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/intensity.ts:usdPerHourLow':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/intensity.ts:usdPerHourHigh':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usdPerMTokInput':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usdPerMTokOutput':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usdPerMTokCachedInput':
    'Team price-preview rate in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usdLow':
    'Team price-preview total in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usdHigh':
    'Team price-preview total in USD; display and comparison only, never ledger arithmetic.',
  'core/team/preview.ts:usd':
    'Team price-preview total in USD; display and comparison only, never ledger arithmetic.',
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly key: string
  readonly value: string
}

const QUOTE_CHARS = new Set(['"', "'", '`'])
const OPENERS = ['(', '[', '{']
const CLOSERS = [')', ']', '}']

function closerFor(opener: string): string {
  return CLOSERS[OPENERS.indexOf(opener)] ?? ''
}

function isQuote(char: string): boolean {
  return QUOTE_CHARS.has(char)
}

// Shared quote tracking for the single-line scanners below: feed every
// character in order; `quoted` reports whether it sits inside a string (the
// quote characters themselves count as quoted) and advances the tracker.
function makeQuoteTracker(): { quoted(char: string): boolean } {
  let quote: string | null = null
  let isEscaped = false
  return {
    quoted(char: string): boolean {
      if (quote !== null) {
        if (isEscaped) isEscaped = false
        else if (char === '\\') isEscaped = true
        else if (char === quote) quote = null
        return true
      }
      if (isQuote(char)) {
        quote = char
        return true
      }
      return false
    },
  }
}

// Cut a `//` comment; strings may contain slashes, and backslashes escape.
// Source lines are ASCII, so UTF-16 indexing is exact here.
function stripLineComment(line: string): string {
  const tracker = makeQuoteTracker()
  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? ''
    if (tracker.quoted(char)) continue
    if (char === '/' && line[index + 1] === '/') return line.slice(0, index)
  }
  return line
}

function stripStrings(value: string): string {
  let out = ''
  const tracker = makeQuoteTracker()
  for (const char of value) {
    if (!tracker.quoted(char)) out += char
  }
  return out
}

function bracketDepth(value: string): number {
  const text = stripStrings(value)
  let depth = 0
  for (const char of text) {
    if (OPENERS.includes(char)) depth += 1
    if (CLOSERS.includes(char)) depth -= 1
  }
  return depth
}

// Index of the closer matching the opener at `open`, or -1. Quote-aware and
// linear: no regex backtracking on large schema expressions.
function findCloser(text: string, open: number): number {
  const opener = text[open] ?? ''
  const closer = closerFor(opener)
  if (closer === '') return -1
  let depth = 0
  const tracker = makeQuoteTracker()
  for (let index = open; index < text.length; index++) {
    const char = text[index] ?? ''
    if (tracker.quoted(char)) continue
    if (char === opener) depth += 1
    else if (char === closer) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

// ASI-aware initializer: stops at a newline at depth 0 unless the next line
// continues a method chain. The repo omits semicolons, so scanning to `;`
// would swallow following declarations.
function readInitializer(
  lines: readonly string[],
  index: number,
): { readonly name: string; readonly init: string; readonly last: number } | null {
  const match = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/.exec(lines[index] ?? '')
  if (match?.[1] === undefined) return null
  let text = match[2] ?? ''
  let last = index
  while (bracketDepth(text) > 0 && last + 1 < lines.length && last - index < 40) {
    last += 1
    text += `\n${lines[last] ?? ''}`
  }
  while (last + 1 < lines.length && /^\s*\./.test(lines[last + 1] ?? '')) {
    last += 1
    text += `\n${lines[last] ?? ''}`
  }
  return { name: match[1], init: text, last }
}

function isBoundaryInit(init: string): boolean {
  return init.includes('transform') || init.includes('.pipe(') || init.includes('z.codec(')
}

function localNumerics(lines: readonly string[]): Set<string> {
  const numeric = new Set<string>()
  const inits = new Map<string, string>()
  for (let index = 0; index < lines.length; index++) {
    const read = readInitializer(lines, index)
    if (read === null) continue
    inits.set(read.name, read.init)
    index = read.last
  }
  for (const match of lines.join('\n').matchAll(/type\s+([A-Za-z_$][\w$]*)\s*=\s*number\b/g)) {
    if (match[1] !== undefined) numeric.add(match[1])
  }
  for (const [name, init] of inits) {
    if (SANCTIONED.has(name) || isBoundaryInit(init)) continue
    if (/z\s*\.\s*(coerce\s*\.\s*)?number\b/.test(stripStrings(init))) numeric.add(name)
  }
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const [name, init] of inits) {
      if (numeric.has(name) || SANCTIONED.has(name) || isBoundaryInit(init)) continue
      const ids = stripStrings(init).match(/[A-Za-z_$][\w$]*/g) ?? []
      if (ids.every((id) => !numeric.has(id))) continue
      numeric.add(name)
      isChanged = true
    }
  }
  for (const name of SANCTIONED) numeric.delete(name)
  return numeric
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  const tracker = makeQuoteTracker()
  let current = ''
  for (const char of text) {
    const isQuoted = tracker.quoted(char)
    current += char
    if (isQuoted) continue
    if (OPENERS.includes(char)) depth += 1
    if (CLOSERS.includes(char)) depth -= 1
    if (char !== ',' || depth !== 0) continue
    parts.push(current.slice(0, -1))
    current = ''
  }
  parts.push(current)
  return parts
}

function unwrapZCall(value: string): { readonly fn: string; readonly args: string[] } | null {
  const match = /^z\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(value.trim())
  if (match?.[1] === undefined) return null
  const text = value.trim()
  const start = text.indexOf('(')
  const end = findCloser(text, start)
  return start === -1 ||
    end < 0 ||
    text
      .slice(end + 1)
      .trim()
      .replace(/[,;}\]]+$/, '') !== ''
    ? null
    : { fn: match[1], args: splitTopLevel(text.slice(start + 1, end)) }
}

const WRAPPER_FNS = new Set([
  'optional',
  'nullable',
  'readonly',
  'default',
  'prefault',
  'catch',
  'array',
])

function isBareAlias(clean: string, numerics: ReadonlySet<string>): boolean {
  // Bare aliases only: `scheduleShape.paidCapUsd` and `four.toolCalling` are
  // member reads whose leaf type is unknown here, not numeric aliases.
  // Union members are tested individually (`amount | undefined` still fails).
  return clean.split('|').some((member) => {
    const bare = /^(?:typeof\s+)?([A-Za-z_$][\w$]*)\s*[?!]?\s*(\[\s*\]\s*)*$/.exec(
      member.trim().replace(/^Array<([\s\S]*)>$/, '$1'),
    )?.[1]
    return bare !== undefined && numerics.has(bare)
  })
}

// Iterative descent over wrapper arguments; a stack replaces recursion.
function isNumericValue(value: string, numerics: ReadonlySet<string>): boolean {
  const pending: { readonly text: string; readonly depth: number }[] = [{ text: value, depth: 0 }]
  let current = pending.pop()
  while (current !== undefined) {
    if (current.depth <= 8 && current.text.length <= 3000) {
      // Never strip `)`: it closes wrapper calls (`z.optional(amount)`) that
      // the paren matcher must see balanced.
      const trimmed = current.text.trim().replace(/[,;}\]]+\s*$/, '')
      const clean = stripStrings(trimmed)
      if (/z\s*\.\s*(coerce\s*\.\s*)?number\b/.test(clean)) return true
      const call = unwrapZCall(trimmed)
      if (call === null) {
        if (/^number\b/.test(clean) || isBareAlias(clean, numerics)) return true
      } else if (WRAPPER_FNS.has(call.fn)) {
        pending.push({ text: call.args[0] ?? '', depth: current.depth + 1 })
      } else if (call.fn === 'record') {
        pending.push({ text: call.args[1] ?? '', depth: current.depth + 1 })
      } else if (call.fn === 'union') {
        const first = (call.args[0] ?? '').trim()
        const members = first.startsWith('[')
          ? splitTopLevel(first.slice(1).replace(/\]\s*$/, ''))
          : call.args
        for (const member of members) pending.push({ text: member, depth: current.depth + 1 })
      }
    }
    current = pending.pop()
  }
  return false
}

// The top-level bracket groups of `text`, so nested object literals are
// scanned without recursion.
function innerGroups(text: string): string[] {
  const groups: string[] = []
  const tracker = makeQuoteTracker()
  for (let index = 0; index < text.length; index++) {
    const char = text[index] ?? ''
    if (tracker.quoted(char) || !OPENERS.includes(char)) continue
    const end = findCloser(text, index)
    if (end <= index) continue
    groups.push(text.slice(index + 1, end))
    index = end
  }
  return groups
}

// Iterative descent: a stack replaces recursion over nested literals.
function scanText(
  text: string,
  line: number,
  file: string,
  numerics: ReadonlySet<string>,
  hits: Finding[],
): void {
  const pending = [text]
  const head = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*([\s\S]*)$/
  let current = pending.pop()
  while (current !== undefined) {
    if (MONEY_HINT.test(current)) {
      for (const part of splitTopLevel(current)) {
        if (!MONEY_HINT.test(part)) continue
        const match = head.exec(part)
        if (match?.[1] === undefined) {
          pending.push(...innerGroups(part))
          continue
        }
        const key = match[1]
        const rest = match[2] ?? ''
        // Test only the first top-level segment: later siblings belong to
        // other keys (`coldCacheUsd: amount, })` tests `amount`, not the blob).
        if (MONEY_KEY.test(key) && isNumericValue(splitTopLevel(rest)[0] ?? '', numerics))
          hits.push({ file, line, key, value: rest.trim().slice(0, 90) })
        pending.push(rest)
      }
    }
    current = pending.pop()
  }
}

function exportedNumerics(lines: readonly string[], numeric: ReadonlySet<string>): Set<string> {
  const exported = new Set<string>()
  const source = lines.join('\n')
  for (const name of numeric) {
    const isDirect = new RegExp(String.raw`export\s+(?:const|type)\s+${name}\b`).test(source)
    const isListed = new RegExp(String.raw`export\s*\{[^}]*\b${name}\b[^}]*\}`).test(source)
    if (isDirect || isListed) exported.add(name)
  }
  return exported
}

function resolveImport(from: string, spec: string, known: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.')) return null
  const base = from.split('/').slice(0, -1).join('/')
  const target = `${base}/${spec}`.split('/').filter((part) => part !== '.')
  const stack: string[] = []
  for (const part of target) {
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  const joined = stack.join('/')
  const candidates = [`${joined}.ts`, `${joined}.tsx`, `${joined}/index.ts`]
  return candidates.find((candidate) => known.has(candidate)) ?? null
}

function analyze(
  files: readonly string[],
  all: readonly string[],
  exportedByFile: Map<string, Set<string>>,
  linesOf: (file: string) => string[],
): Finding[] {
  const hits: Finding[] = []
  const known = new Set(all)
  const numericsOf = (file: string): Set<string> => {
    const cached = exportedByFile.get(file)
    if (cached !== undefined) return cached
    const lines = linesOf(file)
    const computed = exportedNumerics(lines, localNumerics(lines))
    exportedByFile.set(file, computed)
    return computed
  }
  for (const file of files) {
    const lines = linesOf(file)
    const numeric = new Set(localNumerics(lines))
    const importPattern = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
    const matches = lines.join('\n').matchAll(importPattern)
    for (const match of matches) {
      const target = resolveImport(file, match[2] ?? '', known)
      if (target === null) continue
      const provided = numericsOf(target)
      const members = (match[1] ?? '').split(',')
      for (const entry of members) {
        const [original, alias] = entry.trim().split(/\s+as\s+/, 2)
        const name = (alias ?? original ?? '').trim()
        const from = (original ?? '').trim()
        if (name !== '' && provided.has(from)) numeric.add(name)
      }
    }
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue
      let text = line
      const keyed = /([A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*(.*)$/.exec(line)
      // Join only a money-keyed value with unbalanced brackets (capped), so a
      // new multiline numeric money field still fails while huge objects stay
      // cheap. Other lines are scanned as-is; their nested literals recurse.
      if (keyed?.[1] !== undefined && MONEY_KEY.test(keyed[1])) {
        let last = index
        while (bracketDepth(text) > 0 && last + 1 < lines.length && last - index < 25) {
          last += 1
          text += ` ${lines[last] ?? ''}`
        }
      }
      scanText(text, index + 1, file, numeric, hits)
    }
    for (const [index, line] of lines.entries()) {
      const constant = /(?:^|[;{\s])const\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d[\d_]*(?:\.\d+)?)\b/.exec(
        line,
      )
      if (constant?.[1] !== undefined && MONEY_KEY.test(constant[1]))
        hits.push({ file, line: index + 1, key: constant[1], value: constant[2] ?? '' })
    }
  }
  return hits
}

describe('structural exact-money guard', () => {
  it('flags every money-named numeric leaf under src/shared and src/core', async () => {
    const root = new URL('../../src/', import.meta.url)
    const names = await readdir(root, { recursive: true })
    const files = names
      .map((name) => name.replaceAll('\\', '/'))
      .filter((name) => /\.tsx?$/.test(name))
      .filter((name) => name.startsWith('shared/') || name.startsWith('core/'))
      .toSorted((left, right) => left.localeCompare(right))
    const raw = new Map<string, string>()
    for (const file of files) raw.set(file, await readFile(new URL(file, root), 'utf8'))
    const sources = new Map<string, string[]>()
    const linesOf = (file: string): string[] => {
      const cached = sources.get(file)
      if (cached !== undefined) return cached
      const lines = (raw.get(file) ?? '').split('\n').map((line) => stripLineComment(line))
      sources.set(file, lines)
      return lines
    }
    // Cheap pre-filter: only files mentioning a money-named key pay for parsing.
    // The key test mirrors MONEY_KEY: the pattern may sit mid-word
    // (`inputUsdPerMTokens`, `retryAfterCapMs`).
    const candidates = files.filter((file) =>
      /\w*(?:Usd|Cost|Price|Budget|Cap)\w*\s*[?!]?\s*:|spend\w*\s*[?!]?\s*:|const\s+\w*(?:Usd|Cost|Price|Budget|Cap)\w*\s*=/.test(
        raw.get(file) ?? '',
      ),
    )
    const exportedByFile = new Map<string, Set<string>>()
    const hits = analyze(candidates, files, exportedByFile, linesOf)
    const seen = new Set<string>()
    const unexpected = hits.filter((hit) => {
      const id = `${hit.file}:${hit.key}`
      if (Object.hasOwn(ALLOW_LIST, id)) {
        seen.add(id)
        return false
      }
      return true
    })
    const stale = Object.keys(ALLOW_LIST).filter((id) => !seen.has(id))
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] })
  })
})
