// Licence-text matching against the official SPDX license templates
// (M97 CM971-R3, PLAN.md D76), following the SPDX License List Matching
// Guidelines: case, whitespace, quote and dash styles, the copyright
// symbol, http/https, comment markers, separator lines and the SPDX
// equivalent-word list never change a match; every other token of the
// template's fixed text must be present, in order, and nothing may
// follow its end. Only the template's own `<<var>>` and
// `<<beginOptional>>` parts may vary, and a variable accepts text only
// when it has the shape of what it stands for: a copyright notice, a
// list marker, or a name. A sentence, a condition or prose in any
// language never has that shape, so it can never vanish into a match:
// it stays a difference, quoted for human review. The template bytes
// are vendored offline, pinned by version and SHA-256 in
// `data/provenance.json`, and verified before use.

import {
  LEGAL_TEMPLATE_ALIGN_MIN,
  LEGAL_TEMPLATE_SLOT_WORDS,
  LEGAL_TEMPLATE_CAPITALS_RUN_MAX,
  LEGAL_TEMPLATE_NAME_TOKENS_MAX,
  LEGAL_TEMPLATE_EXPECTED_TOKENS,
  LEGAL_TEMPLATE_ORIGINAL_SLACK_CHARS,
  LEGAL_TEMPLATE_SIMILARITY_MIN,
  LEGAL_TEMPLATE_SPAN_MAX_CHARS,
  LEGAL_TEMPLATE_TITLE_LINES_MAX,
  LEGAL_TEMPLATE_VARIABLE_MAX_CHARS,
  WORK_LEAD_IN_WORDS_MAX,
} from '../../shared/constants'
import { bytesFingerprint } from '../verify/fingerprint'
import { SPDX_TEMPLATE_FILES, type SpdxTemplateFile } from './data'
import { PINNED_LEGAL_DATA_DIRECTORY, readPinnedLegalData } from './workspace'

/** Where a text first leaves its closest template. */
export interface TemplateDifference {
  /** The pinned template the text reads closest to (an SPDX id). */
  readonly templateId: string
  /** The input's differing text, bounded; empty when the text stops early. */
  readonly span: string
  /** The template's continuation there; empty past its end or for a variable. */
  readonly expected: string
}

/** A text's reading against the pinned templates. */
export interface TemplateReading {
  /** The match key: an SPDX id, or the GPL family's version stem. */
  readonly key: string
  readonly exact: boolean
  /** Dice share of agreeing words with the template, 0..1. */
  readonly similarity: number
  /** Present whenever `exact` is false. */
  readonly difference?: TemplateDifference
}

type VariableRole = 'closed' | 'notice' | 'marker' | 'name'

interface TemplateVariable {
  readonly name: string
  readonly originalKey: string
  /**
   * The variable's `match` source with each wildcard captured and every
   * other group silent (see `VARIABLE_WILDCARDS`): the match test and the
   * capture read are the same expression, so one literal serves both.
   */
  readonly wildcards: RegExp
  readonly role: VariableRole
  readonly requiresMarker: boolean
  readonly maxChars: number
  readonly vocabulary: ReadonlySet<string>
  readonly restrictionWords: ReadonlySet<string>
}

type Instruction =
  | { readonly op: 'token'; readonly value: string }
  | { readonly op: 'variable'; readonly variable: TemplateVariable }
  | { readonly op: 'split'; readonly skip: number }
  | { readonly op: 'end' }

/** One parsed, verified template. */
interface LicenseTemplate {
  /** The SPDX id the template file names (`GPL-3.0-only`). */
  readonly id: string
  /** The match key: the id, or the GPL family's stem (`GPL-3.0`). */
  readonly key: string
  readonly isGplFamily: boolean
  readonly program: readonly Instruction[]
  readonly firstSets: readonly ReadonlySet<string>[]
  readonly wordCounts: ReadonlyMap<string, number>
  readonly wordTotal: number
  readonly requiredCounts: ReadonlyMap<string, number>
  readonly requiredTotal: number
  readonly titleVocabulary: ReadonlySet<string>
  /**
   * Per optional part, the copyright variables inside it: an optional
   * appendix (`How to apply …`) may be given from its notice on, as the
   * applied notice, since its instructions are not terms.
   */
  readonly noticeEntries: ReadonlyMap<number, readonly number[]>
}

interface Equivalences {
  readonly restrictionWords: ReadonlySet<string>
  /** Variant token sequences, longest first, each with its canonical form. */
  readonly variants: readonly { readonly from: readonly string[]; readonly to: readonly string[] }[]
}

/** The verified template set and anything that failed verification. */
export interface LicenseTemplateSet {
  readonly templates: readonly LicenseTemplate[]
  /** Pinned files that were missing, altered or unparseable. */
  readonly problems: readonly string[]
  readonly equivalences: Equivalences
}

interface Token {
  readonly norm: string
  readonly start: number
  readonly end: number
  readonly line: number
  readonly isWord: boolean
}

const EMPTY_VOCABULARY: ReadonlySet<string> = new Set()
const ANY_TOKEN = '\u{0}any'
const END_TOKEN = '\u{0}end'
const QUOTES = /^["'`«»‘’‚‛“”„‟‹›]$/u
const DASHES = /^[‐-―−﹘﹣－-]$/u
const WORD = /^[\p{L}\p{N}\p{M}]+$/u
const TOKEN = /[\p{L}\p{N}\p{M}]+|\S/gu
const COMMENT_PREFIX = /^\s*(?:\/\/+|\/\*+|\*+\/|\*+(?=\s|$)|#+|;+|--+(?=\s|$)|%+|<!--|-->)?/u
const SEPARATOR_LINE = /^\s*([^\p{L}\p{N}\s])\1{2,}\s*$/u
// A list item's marker at a line start; `(c)` is the copyright mark, not item c.
const LIST_ITEM = /^\s*(?:[-•·]|\(?(?:\d{1,3}|[abd-z]|[ivxl]{2,6})[.)])\s+/iu
const MARKUP = /<<(beginOptional|endOptional|var;([\s\S]*?))>>/gu
const VARIABLE_FIELDS = /^name="([\s\S]*?)";\s*original="([\s\S]*?)";\s*match="([\s\S]*?)"\s*$/u
const BOUNDED_WILDCARD = /^\.\{\d+,(\d+)\}$/u
const TERMINATORS = /[!?;。！？；؟।]/u
const COPYRIGHT_MARKER = /^(?:copyright\b:?|\(c\)|©|copr\.)/iu
const LEADING_MARKERS = /^(?:(?:copyright\b:?|\(c\)|©|copr\.)\s*)+/iu
const RIGHTS_RESERVED_LINE = /^all rights reserved\.?$/iu
const RIGHTS_RESERVED = /[.,]?\s*all rights reserved\.?\s*$/iu
const YEARS = /\b\d{4}(?:\s*[-–—]\s*(?:\d{4}|present))?\b/giu
const LIST_MARKER =
  /^(?:\(?(?:\d{1,3}(?:\.\d{1,3})*|[a-z]{1,2}|[ivxlcdm]{1,7})[.)]?\)?\.?|[-*•·–—o])$/iu
/** Company and organisation abbreviations a name may close a word with. */
const ABBREVIATIONS: ReadonlySet<string> = new Set(
  'inc corp co ltd llc llp lp gmbh ag sa sas sarl bv nv plc pty kg kk oy ab as aps spa srl ltda cia univ assn assoc dept bros'.split(
    ' ',
  ),
)
/** Lowercase words a holder name may carry: particles and collectives. */
const NAME_CONNECTORS: ReadonlySet<string> = new Set(
  'and of the by for de da das di do dos du del della der den des la le les van von y e et al its their other others contributors authors developers affiliates subsidiaries present or'.split(
    ' ',
  ),
)

/**
 * Restriction vocabulary (M97 CM971-R3, lead ruling): words that limit
 * use, audience, purpose or price. They are never part of a holder's or
 * party's name, in any case, so a notice that carries one (`Example
 * Nonprofit Projects Only`) keeps human review. The list only ever forces
 * review; it never makes a text match.
 */
function restrictionWords(text: string): ReadonlySet<string> {
  return new Set(
    text
      .trim()
      .split(/\s+/u)
      .flatMap((entry) => {
        const [stem = '', ...suffixes] = entry.split('|')
        return suffixes.length === 0 ? [stem] : suffixes.map((suffix) => stem + suffix)
      })
      .map((word) => word.replaceAll('ı', 'i').replaceAll('ß', 'ss')),
  )
}
// Keep compound restrictions intact: neither `non` nor `profit` alone
// implies a restriction (Profit Inc. is an ordinary company name).
const RESTRICTION_PHRASES = ['non profit', 'non commercial', 'no ai']

/** Split Unicode camelCase, acronym boundaries and separators before folding case. */
function nameTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .replaceAll(/([\p{Ll}\p{N}]\p{M}*)([\p{Lu}\p{Lt}])/gu, '$1 $2')
    .replaceAll(/([\p{Lu}\p{Lt}]\p{M}*)([\p{Lu}\p{Lt}]\p{M}*\p{Ll})/gu, '$1 $2')
    .toLowerCase()
    .replaceAll('\u{307}', '')
    .replaceAll('ı', 'i')
    .replaceAll('ß', 'ss')
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((part) => part !== '')
}

function isRestrictionWord(text: string, restricted: ReadonlySet<string>): boolean {
  const tokens = nameTokens(text)
  const joined = tokens.join(' ')
  const unsplit = text
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('\u{307}', '')
    .replaceAll('ı', 'i')
    .replaceAll('ß', 'ss')
  return (
    restricted.has(unsplit) ||
    tokens.some((part) => restricted.has(part)) ||
    RESTRICTION_PHRASES.some((phrase) => ` ${joined} `.includes(` ${phrase} `))
  )
}

/**
 * Punctuation as the guidelines compare it. Quote marks of every style
 * and Markdown emphasis (`*AS IS*`, `_AS IS_`) carry no terms, so they
 * drop out on both sides; the other marks stay.
 */
function normalizePunctuation(token: string): readonly string[] {
  if (token === '©') return ['(', 'c', ')']
  if (token === '&') return ['and']
  if (token === '*' || token === '_' || QUOTES.test(token)) return []
  return [DASHES.test(token) ? '-' : token]
}

function baseTokens(text: string, offset: number, line: number): Token[] {
  const found: Token[] = []
  for (const match of text.matchAll(TOKEN)) {
    const raw = match[0]
    const start = offset + match.index
    const end = start + raw.length
    if (WORD.test(raw)) {
      const lower = raw.toLowerCase()
      found.push({ norm: lower === 'https' ? 'http' : lower, start, end, line, isWord: true })
    } else {
      for (const norm of normalizePunctuation(raw))
        found.push({ norm, start, end, line, isWord: norm === 'and' })
    }
  }
  return found
}

function applyEquivalences(tokens: readonly Token[], equivalences: Equivalences): Token[] {
  const out: Token[] = []
  let index = 0
  while (index < tokens.length) {
    const variant = equivalences.variants.find(
      ({ from }) =>
        index + from.length <= tokens.length &&
        from.every((value, offset) => tokens[index + offset]?.norm === value),
    )
    const first = tokens[index]
    const last = variant === undefined ? first : tokens[index + variant.from.length - 1]
    if (variant === undefined || first === undefined || last === undefined) {
      if (first !== undefined) out.push(first)
      index += 1
      continue
    }
    for (const norm of variant.to)
      out.push({ norm, start: first.start, end: last.end, line: first.line, isWord: true })
    index += variant.from.length
  }
  return out
}

/**
 * Tokenize the way the guidelines compare text, the template's fixed text
 * and the input alike: comment markers at line starts, comment-box edges
 * at line ends and separator lines (`-----`, `*****`) carry no terms.
 */
function tokenize(text: string, equivalences: Equivalences): readonly Token[] {
  const tokens: Token[] = []
  let offset = 0
  let lineNumber = 0
  for (const line of text.split(/(?<=\n)/u)) {
    const body = line.replace(/\r?\n$/u, '')
    const commentPrefix = COMMENT_PREFIX.exec(body)?.[0].length ?? 0
    // A list item's bullet or number carries no terms (guideline B.6).
    const prefix = commentPrefix + (LIST_ITEM.exec(body.slice(commentPrefix))?.[0].length ?? 0)
    const content = withoutBoxEdge(body.slice(prefix))
    if (!SEPARATOR_LINE.test(content))
      tokens.push(...baseTokens(content, offset + prefix, lineNumber))
    offset += line.length
    lineNumber += 1
  }
  return applyEquivalences(tokens, equivalences)
}

/**
 * A line without a comment-box edge (trailing asterisks, or a closing
 * block-comment marker) at its end. Written
 * as a scan, not a regular expression, so a long whitespace run costs
 * linear time.
 */
const BLOCK_COMMENT_END = '*/'

function withoutBoxEdge(line: string): string {
  const trimmed = line.trimEnd()
  if (trimmed.endsWith(BLOCK_COMMENT_END)) return trimmed.slice(0, -BLOCK_COMMENT_END.length)
  let end = trimmed.length
  while (end > 0 && trimmed.charAt(end - 1) === '*') end -= 1
  if (end === trimmed.length) return line
  const before = trimmed.slice(0, end)
  return before === '' || before.trimEnd() !== before ? before : line
}

function keyOf(text: string, equivalences: Equivalences): string {
  return tokenize(text, equivalences)
    .map((token) => token.norm)
    .join(' ')
}

function parseEquivalences(text: string, restricted: ReadonlySet<string>): Equivalences {
  const groups: string[][] = []
  for (const line of text.split(/\r?\n/u)) {
    const entries = line
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry !== '')
    if (entries.length < 2) continue
    const joined = groups.find((group) => entries.some((entry) => group.includes(entry)))
    if (joined === undefined) groups.push(entries)
    else for (const entry of entries) if (!joined.includes(entry)) joined.push(entry)
  }
  const variants: { from: readonly string[]; to: readonly string[] }[] = []
  for (const group of groups) {
    const forms = group.map((entry) => baseTokens(entry, 0, 0).map((token) => token.norm))
    const canonical =
      forms
        .filter((form) => form.length === 1)
        .toSorted((a, b) => a.join(' ').localeCompare(b.join(' '), 'en'))[0] ??
      forms[0] ??
      []
    for (const form of forms)
      if (form.join(' ') !== canonical.join(' ')) variants.push({ from: form, to: canonical })
  }
  return {
    variants: variants.toSorted((a, b) => b.from.length - a.from.length),
    restrictionWords: restricted,
  }
}

/**
 * The pattern source with each quantified `.` wildcard captured and every
 * other group made non-capturing. A lone `.` matches one character and
 * stays as written.
 */
function wildcardSource(source: string): { readonly source: string; readonly count: number } {
  let out = ''
  let count = 0
  let index = 0
  while (index < source.length) {
    const char = source.charAt(index)
    if (char === '\\') {
      out += source.slice(index, index + 2)
      index += 2
    } else if (char === '[') {
      const close = source.indexOf(']', index + 2)
      const end = close === -1 ? source.length : close + 1
      out += source.slice(index, end)
      index = end
    } else if (char === '(' && source.charAt(index + 1) !== '?') {
      out += '(?:'
      index += 1
    } else if (char === '.') {
      const quantifier = /^(?:[+*]|\{\d+(?:,\d*)?\})\??/u.exec(source.slice(index + 1))?.[0] ?? ''
      out += quantifier === '' ? '.' : `(.${quantifier})`
      count += quantifier === '' ? 0 : 1
      index += 1 + quantifier.length
    } else {
      out += char
      index += 1
    }
  }
  return { source: out, count }
}

function vocabularyOf(text: string): ReadonlySet<string> {
  const words = new Set<string>()
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0].toLowerCase()
    words.add(word)
    words.add(word.endsWith('s') ? word.slice(0, -1) : `${word}s`)
  }
  return words
}

/**
 * Every `match="…"` source the pinned SPDX templates use, each compiled
 * once as a literal with its wildcards captured (the `wildcardSource`
 * shape). The set is closed: the template bytes are pinned by SHA-256 in
 * `data/provenance.json`, so a source outside this table fails closed in
 * `parseVariable`, and a data update extends this table beside its
 * provenance record. No pattern is ever built from data at run time
 * (semgrep detect-non-literal-regexp): `parseVariable` only compares the
 * transformed source string against each literal's `source`.
 */
const VARIABLE_WILDCARD_PATTERNS: readonly RegExp[] = [
  /^(?:(?:)|(?: of the theme))$/iu,
  /^(?:(?:SOFTWARE)|(?:THEME))$/iu,
  /^(?:(?:The )?ISC License(?: \(ISC[L]?\))?:?)$/iu,
  /^(?:(?:The\s+name\s+of(.+)may\s+not)|(?:Neither\s+the\s+names?\s+of(.+)nor\s+the\s+names\s+of\s+its\s+contributors\s+may)|(?:Neither\s+the\s+names?\s+of(.+)nor\s+the\s+names\s+of\s+their\s+contributors\s+may)|(?:Neither\s+the\s+names?\s+of(.+)nor\s+the\s+names\s+of\s+any\s+contributors\s+may)|(?:\s*Neither\s+the\s+name\s+of(.+)nor\s+the\s+names\s+of\s+its\s+authors\s+and\s+contributors\s+may)|(?:Neither\s+the\s+name\s+of(.+)nor\s+the\s+names\s+of\s+(?:specific\s+)?contributors,?\s+may)|(?:Neither\s+the\s+name(.+)nor\s+the\s+names\s+of\s+contributors\s+may)|(?:The\s+names\s+of\s+its\s+contributors\s+may\s+not)|(?:The\s+names\s+of\s+any\s+contributors\s+may\s+not)|(?:The\s+names\s+of\s+the\s+contributors\s+may\s+not)|(?:None\s+of\s+the\s+names\s+of(.+)and\s+any\s+contributors\s+may)|(?:Neither\s+my\s+name(.+)nor\s+the\s+names\s+of\s+contributors\s+to\s+this\s+code\s+may)|(?:Neither\s+name\s+of\s+copyright\s+holders\s+nor\s+the\s+names\s+of\s+its\s+contributors\s+may))$/iu,
  /^(?:(?:To obtain permission, contact (.*))?)$/iu,
  /^(?:,|)$/iu,
  /^(?:(.*))$/iu,
  /^(?:(.+))$/iu,
  /^(?:(.{0,20}))$/iu,
  /^(?:(.{0,5000}))$/iu,
  /^(?:(.{54,64}))$/iu,
  /^(?:\/\/www.gnu.org\/philosophy\/why-not-lgpl\.html>\.|\/\/www.gnu.org\/licenses\/why-not-lgpl\.html>\.)$/iu,
  /^(?:EXPRESS(?:ED)?)$/iu,
  /^(?:For more information, please see <http:\/\/creativecommons.org\/publicdomain\/zero\/1.0\/>)$/iu,
  /^(?:GNU GENERAL PUBLIC LICENSE|)$/iu,
  /^(?:Lesser|Library)$/iu,
  /^(?:SOFTWARE IS|MATERIALS ARE)$/iu,
  /^(?:SOFTWARE|MATERIALS)$/iu,
  /^(?:Software|Materials)$/iu,
  /^(?:The MIT-Zero License|MIT No Attribution|)$/iu,
  /^(?:Ty Coon|Moe Ghoul)$/iu,
  /^(?:a brief|an)$/iu,
  /^(?:above|original)$/iu,
  /^(?:an idea|a brief idea)$/iu,
  /^(?:are|is)$/iu,
  /^(?:philosophy|licenses)$/iu,
  /^(?:software|work)$/iu,
  /^(?:source code|works)$/iu,
  /^(?:this\s+software\s+and\s+associated\s+documentation\s+files|this\s+source\s+file)$/iu,
  /^(?:yyyy|year)$/iu,
]

/**
 * Every wildcard literal above, found by its `source`. A regex literal
 * must escape `/` as `\/` while the template `match` sources spell it
 * bare, so the key drops that escape before comparing.
 */
const VARIABLE_WILDCARDS: ReadonlyMap<string, RegExp> = new Map<string, RegExp>(
  VARIABLE_WILDCARD_PATTERNS.map((compiled): [string, RegExp] => [
    compiled.source.replaceAll(String.raw`\/`, '/'),
    compiled,
  ]),
)

function parseVariable(body: string, equivalences: Equivalences): TemplateVariable {
  const fields = VARIABLE_FIELDS.exec(body)
  if (fields === null) throw new Error('unparseable template variable')
  const [, name = '', original = '', match = ''] = fields
  const wildcards = wildcardSource(match)
  let role: VariableRole = 'name'
  if (wildcards.count === 0) role = 'closed'
  else if (name === 'copyright') role = 'notice'
  else if (name === 'bullet') role = 'marker'
  const bounded = BOUNDED_WILDCARD.exec(match)?.[1]
  const compiled = VARIABLE_WILDCARDS.get(`^(?:${wildcards.source})$`)
  if (compiled === undefined) throw new Error('unsupported template variable pattern')
  return {
    name,
    originalKey: keyOf(original, equivalences),
    wildcards: compiled,
    role,
    requiresMarker: COPYRIGHT_MARKER.test(original.trim()),
    maxChars:
      bounded === undefined
        ? LEGAL_TEMPLATE_VARIABLE_MAX_CHARS
        : Math.min(Number(bounded), LEGAL_TEMPLATE_VARIABLE_MAX_CHARS),
    vocabulary: vocabularyOf(original),
    restrictionWords: equivalences.restrictionWords,
  }
}

interface ParsedNode {
  readonly kind: 'text' | 'variable' | 'optional'
  readonly text: string
  readonly variable?: TemplateVariable
  readonly body: ParsedNode[]
}

function parseTemplateMarkup(source: string, equivalences: Equivalences): ParsedNode[] {
  const root: ParsedNode[] = []
  const stack: ParsedNode[][] = [root]
  let last = 0
  for (const match of source.matchAll(MARKUP)) {
    const current = stack.at(-1) ?? root
    if (match.index > last)
      current.push({ kind: 'text', text: source.slice(last, match.index), body: [] })
    last = match.index + match[0].length
    if (match[1] === 'beginOptional') {
      const body: ParsedNode[] = []
      current.push({ kind: 'optional', text: '', body })
      stack.push(body)
    } else if (match[1] === 'endOptional') {
      if (stack.length === 1) throw new Error('unbalanced optional')
      stack.pop()
    } else {
      const variable = parseVariable(match[2] ?? '', equivalences)
      current.push({ kind: 'variable', text: '', variable, body: [] })
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced optional')
  if (last < source.length) root.push({ kind: 'text', text: source.slice(last), body: [] })
  return root
}

function compile(nodes: readonly ParsedNode[], equivalences: Equivalences): Instruction[] {
  const program: Instruction[] = []
  const emit = (list: readonly ParsedNode[]): void => {
    for (const node of list) {
      if (node.kind === 'text') {
        for (const token of tokenize(node.text, equivalences))
          program.push({ op: 'token', value: token.norm })
      } else if (node.variable === undefined) {
        const at = program.length
        program.push({ op: 'split', skip: at })
        emit(node.body)
        program[at] = { op: 'split', skip: program.length }
      } else {
        program.push({ op: 'variable', variable: node.variable })
      }
    }
  }
  emit(nodes)
  program.push({ op: 'end' })
  return program
}

/** Tokens that may come next at each instruction (`ANY_TOKEN` at a variable). */
function firstSetsOf(program: readonly Instruction[]): ReadonlySet<string>[] {
  const visit = (pc: number, into: Set<string>, seen: Set<number>): void => {
    if (seen.has(pc)) return
    seen.add(pc)
    const instruction = program[pc]
    switch (instruction?.op) {
      case 'token': {
        into.add(instruction.value)
        break
      }
      case 'end': {
        into.add(END_TOKEN)
        break
      }
      case 'variable': {
        into.add(ANY_TOKEN)
        break
      }
      case 'split': {
        visit(pc + 1, into, seen)
        visit(instruction.skip, into, seen)
        break
      }
      default: {
        break
      }
    }
  }
  return program.map((_instruction, pc) => {
    const set = new Set<string>()
    visit(pc, set, new Set())
    return set
  })
}

/**
 * The words a title line may hold (SPDX guideline: a license's name or
 * title is ignored when it is only the title): the template's leading
 * optional part, its id's parts, and "the license version". A first line
 * made only of these (`The MIT License (MIT)`, `BSD 3-Clause License`)
 * carries no terms.
 */
function titleVocabularyOf(
  nodes: readonly ParsedNode[],
  id: string,
  equivalences: Equivalences,
): ReadonlySet<string> {
  const lead = nodes.find((node) => node.kind !== 'text' || node.text.trim() !== '')
  const titleText = lead?.kind === 'optional' ? lead.body.map((node) => node.text).join(' ') : ''
  const words = tokenize(
    `the license version ${titleText} ${id.replaceAll(/[-.]/gu, ' ')}`,
    equivalences,
  )
  return new Set(words.filter((token) => token.isWord).map((token) => token.norm))
}

/** Word counts of the whole template and of its required (non-optional) text. */
function wordCountsOf(program: readonly Instruction[]): {
  readonly all: Map<string, number>
  readonly required: Map<string, number>
} {
  const all = new Map<string, number>()
  const required = new Map<string, number>()
  const optionalEnds: number[] = []
  for (const [pc, instruction] of program.entries()) {
    while (optionalEnds.length > 0 && (optionalEnds.at(-1) ?? 0) <= pc) optionalEnds.pop()
    if (instruction.op === 'split') optionalEnds.push(instruction.skip)
    if (instruction.op !== 'token' || !WORD.test(instruction.value)) continue
    all.set(instruction.value, (all.get(instruction.value) ?? 0) + 1)
    if (optionalEnds.length === 0)
      required.set(instruction.value, (required.get(instruction.value) ?? 0) + 1)
  }
  return { all, required }
}

function sumOf(counts: ReadonlyMap<string, number>): number {
  let total = 0
  for (const count of counts.values()) total += count
  return total
}

function buildTemplate(id: string, source: string, equivalences: Equivalences): LicenseTemplate {
  const nodes = parseTemplateMarkup(source, equivalences)
  const program = compile(nodes, equivalences)
  const { all, required } = wordCountsOf(program)
  const stem = /^((?:A|L)?GPL-\d\.\d)-(?:only|or-later)$/u.exec(id)?.[1]
  return {
    id,
    key: stem ?? id,
    isGplFamily: stem !== undefined,
    program,
    firstSets: firstSetsOf(program),
    wordCounts: all,
    wordTotal: sumOf(all),
    requiredCounts: required,
    requiredTotal: sumOf(required),
    titleVocabulary: titleVocabularyOf(nodes, id, equivalences),
    noticeEntries: noticeEntriesOf(program),
  }
}

function noticeEntriesOf(program: readonly Instruction[]): Map<number, number[]> {
  const entries = new Map<number, number[]>()
  for (const [pc, instruction] of program.entries()) {
    if (instruction.op !== 'split') continue
    const inside: number[] = []
    for (let at = pc + 1; at < instruction.skip; at += 1) {
      const candidate = program[at]
      if (candidate?.op === 'variable' && candidate.variable.role === 'notice') inside.push(at)
    }
    if (inside.length > 0) entries.set(pc, inside)
  }
  return entries
}

/**
 * Load and verify the pinned templates under `directory`: each file's
 * SHA-256 must equal its provenance record, or it is left out and named
 * in `problems`, so it can never match (fail closed).
 */
export function loadLicenseTemplates(
  directory: string,
  files: readonly SpdxTemplateFile[] = SPDX_TEMPLATE_FILES,
): LicenseTemplateSet {
  const problems: string[] = []
  const read = (file: Pick<SpdxTemplateFile, 'path' | 'sha256'>): string | undefined => {
    // The digest covers the exact bytes (strict UTF-8, any byte-order
    // mark kept), so altered, truncated or non-UTF-8 data never loads.
    const bytes = readPinnedLegalData(file.path, directory)
    if (bytes === undefined || bytesFingerprint(bytes) !== file.sha256) {
      problems.push(file.path)
      return undefined
    }
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
  }
  const wordsFile = files.find((file) => file.kind === 'equivalentWords')
  if (wordsFile === undefined) problems.push('equivalentwords.txt')
  const wordsText = wordsFile === undefined ? undefined : read(wordsFile)
  const slots = read(LEGAL_TEMPLATE_SLOT_WORDS)
  const equivalences = parseEquivalences(wordsText ?? '', restrictionWords(slots ?? ''))
  if (slots === undefined) return { templates: [], problems, equivalences }
  const templates: LicenseTemplate[] = []
  for (const file of files) {
    if (file.kind !== 'template') continue
    const text = read(file)
    if (text === undefined) continue
    try {
      templates.push(
        buildTemplate(
          (file.path.split('/').at(-1) ?? '').replace(/\.template\.txt$/u, ''),
          text,
          equivalences,
        ),
      )
    } catch {
      problems.push(file.path)
    }
  }
  if (templates.length === 0 && !problems.includes('templates')) problems.push('templates')
  return { templates, problems, equivalences }
}

const loaded = new Map<string, LicenseTemplateSet>()

/**
 * The verified template set the scanner matches against, loaded once
 * from `legal-data/` beside this module: the source tree and `dist/`
 * (where the build copies it next to `legalScan.js`) share that layout.
 */
export function licenseTemplateSet(): LicenseTemplateSet {
  const set =
    loaded.get(PINNED_LEGAL_DATA_DIRECTORY) ?? loadLicenseTemplates(PINNED_LEGAL_DATA_DIRECTORY)
  loaded.set(PINNED_LEGAL_DATA_DIRECTORY, set)
  return set
}

// --- Variable acceptance ---------------------------------------------------

function collapse(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim()
}

function contentLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.slice(COMMENT_PREFIX.exec(line)?.[0].length ?? 0).trim())
    .filter((line) => line !== '')
}

function isNameWord(word: string, lower: string, vocabulary: ReadonlySet<string>): boolean {
  return (
    /^\p{Lu}/u.test(word) ||
    /^\p{N}+$/u.test(word) ||
    NAME_CONNECTORS.has(lower) ||
    vocabulary.has(lower) ||
    /^[\p{Ll}\p{N}][\p{L}\p{N}]*(?:[._-][\p{L}\p{N}]+)+$/u.test(word) ||
    /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u.test(word)
  )
}

/**
 * Whether text reads only as a name: capitalised words,
 * numbers, contacts and a closed set of particles, with
 * at most eight tokens and periods only after a company abbreviation.
 * A terminator, lowercase prose, a sentence after an abbreviation,
 * restriction vocabulary in any case, or text in a script without letter
 * case never passes.
 */
function isNameShaped(
  text: string,
  vocabulary: ReadonlySet<string>,
  restricted: ReadonlySet<string>,
): boolean {
  const body = collapse(text)
  if (
    body === '' ||
    TERMINATORS.test(body) ||
    body.split(/\s+/u).length > LEGAL_TEMPLATE_NAME_TOKENS_MAX ||
    isRestrictionWord(body, restricted) ||
    nameTokens(body).length > LEGAL_TEMPLATE_NAME_TOKENS_MAX
  )
    return false
  const hasContacts = body.includes('@') || body.includes('://')
  const parts = (
    hasContacts
      ? body
          .replaceAll(/<[^<>\s]+@[^<>\s]+>|<https?:\/\/[^<>\s]+>|\(https?:\/\/[^()\s]+\)/giu, ' ')
          .replaceAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/\S+|(?<!\S)@[\w-]+/giu, ' ')
      : body
  )
    .split(/\s+/u)
    // Brackets, and quotes around a nickname (`Menglin "Mark" Xu`), are not words.
    .map((part) => part.replace(/^[(<["'“‘«]+/u, '').replace(/[)\]>,"'”’»]+$/u, ''))
    .filter((part) => part !== '' && !/^[,&/+-]+$/u.test(part))
  let isAfterAbbreviation = false
  let capitalRun = 0
  for (const part of parts) {
    const hasPeriod = part.endsWith('.')
    const word = hasPeriod ? part.slice(0, -1) : part
    const lower = word.toLowerCase()
    if (word === '' || /[^\p{Lu}\p{Ll}\p{Lt}\p{N}\p{M}._'’-]/u.test(word)) return false
    if (word.includes('.') && !/^(?:\p{L}\.)+\p{L}$/u.test(word)) return false
    if (isAfterAbbreviation && /^\p{Lu}/u.test(word)) return false
    if (isRestrictionWord(word, restricted)) return false
    // Capitals-only words in a row outside the variable's own wording
    // read as a clause (`NO COMMERCIAL USE`), not a name.
    const isShout =
      /^\p{Lu}{2,}$/u.test(word) && !vocabulary.has(lower) && !NAME_CONNECTORS.has(lower)
    capitalRun = isShout ? capitalRun + 1 : 0
    if (capitalRun >= LEGAL_TEMPLATE_CAPITALS_RUN_MAX || !isNameWord(word, lower, vocabulary))
      return false
    isAfterAbbreviation = hasPeriod && ABBREVIATIONS.has(lower)
    const isCompanyInitials =
      /^(?:\p{L}\.)+\p{L}$/u.test(word) && ABBREVIATIONS.has(lower.replaceAll('.', ''))
    if (hasPeriod && !isAfterAbbreviation && !isCompanyInitials) return false
  }
  return parts.length > 0
}

/** Words that may name which work a notice covers (`Portions`, `pngjs original work`). */
const WORK_LEAD_IN_WORDS: ReadonlySet<string> = new Set(
  'original derived modified work works portions portion parts part of the this software code file files library project and based on'.split(
    ' ',
  ),
)

/**
 * A notice line from its first copyright marker, when what precedes the
 * marker only names the work (`Portions Copyright …`, `pngjs original
 * work Copyright …`): closed lead-in words plus at most one name word,
 * never restriction vocabulary or a terminator. Otherwise the line as is.
 */
function withoutWorkLeadIn(line: string, restricted: ReadonlySet<string>): string {
  const at = line.search(/\b(?:copyright\b|copr\.)|\(c\)|©/iu)
  if (at <= 0) return line
  const words = line.slice(0, at).trim().split(/\s+/u)
  const others = words.filter((word) => !WORK_LEAD_IN_WORDS.has(word.toLowerCase()))
  const isWorkName =
    words.length <= WORK_LEAD_IN_WORDS_MAX &&
    others.length <= 1 &&
    others.every(
      (word) =>
        /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(word) && !isRestrictionWord(word, restricted),
    )
  return isWorkName ? line.slice(at) : line
}

/**
 * Whether text is only copyright notices: each line opens with a marker
 * (or is `All rights reserved`); a variable whose original carries no
 * marker also accepts one unmarked notice line.
 */
// Closed notice-only forms captured from react, smol-toml, highlight.js
// and parse5 (CM971R5). Strip only the literal collectives/contact shape;
// the remaining holder still passes every strict name/restriction guard.
const HOLDER_COLLECTIVE = / (?:and affiliates\.|et al\.)$/iu
const HOLDER_CONTACT_PAIR = / \([\w.+-]+@[\w-]+(?:\.[\w-]+)+, https?:\/\/[\w.-]+(?:\/[\w.-]+)*\)$/iu
const HOLDER_FINAL_PERIOD = /^\p{Lu}[\p{Ll}\p{M}]+ \p{Lu}[\p{Ll}\p{M}]+\.$/u

function isCopyrightNotice(
  text: string,
  vocabulary: ReadonlySet<string>,
  requiresMarker: boolean,
  restricted: ReadonlySet<string>,
): boolean {
  const lines = contentLines(text).map((line) => withoutWorkLeadIn(line, restricted))
  if (lines.length === 0) return true
  const isMarked = lines.every(
    (line) => COPYRIGHT_MARKER.test(line) || RIGHTS_RESERVED_LINE.test(line),
  )
  if (!isMarked && (requiresMarker || lines.length !== 1)) return false
  for (const line of lines) {
    if (RIGHTS_RESERVED_LINE.test(line)) continue
    for (const statement of line.split(/(?<=\.)\s+(?=copyright\b|\(c\)|©)/iu)) {
      // Collapsed first, so no pattern below meets a long whitespace run.
      let body = collapse(statement)
        .replace(LEADING_MARKERS, '')
        .replace(RIGHTS_RESERVED, '')
        .replaceAll(YEARS, ' ')
      body = body
        .replace(HOLDER_COLLECTIVE, '')
        .replace(HOLDER_CONTACT_PAIR, '')
        .replaceAll(',', ' , ')
      if (HOLDER_FINAL_PERIOD.test(collapse(body.replaceAll(',', ''))))
        body = body.trimEnd().slice(0, -1)
      if (collapse(body.replaceAll(',', '')) !== '' && !isNameShaped(body, vocabulary, restricted))
        return false
    }
  }
  return true
}

function hasRoleShape(variable: TemplateVariable, raw: string, value: string): boolean {
  switch (variable.role) {
    case 'closed': {
      return true
    }
    case 'marker': {
      return value === '' || LIST_MARKER.test(value)
    }
    case 'notice': {
      return isCopyrightNotice(
        raw,
        variable.vocabulary,
        variable.requiresMarker,
        variable.restrictionWords,
      )
    }
    default: {
      // An unmatched optional group captures `undefined` at run time.
      const isWildcardShaped = (captured: string | undefined): boolean =>
        captured === undefined ||
        captured.trim() === '' ||
        isNameShaped(captured, variable.vocabulary, variable.restrictionWords)
      return (
        variable.wildcards
          .exec(value)
          ?.slice(1)
          .every((captured) => isWildcardShaped(captured)) === true
      )
    }
  }
}

/**
 * A variable's verdict on candidate text: `accept`, `pattern` (outside
 * the SPDX pattern: not a candidate at all) or `shape` (inside the
 * pattern but not the shape of what the variable stands for, so the text
 * is a difference to report).
 */
function judgeVariable(
  variable: TemplateVariable,
  raw: string,
  equivalences: Equivalences,
): 'accept' | 'pattern' | 'shape' {
  const value = collapse(raw)
  const isOriginal = (): boolean =>
    value.length <= variable.originalKey.length * 2 + LEGAL_TEMPLATE_ORIGINAL_SLACK_CHARS &&
    keyOf(raw, equivalences) === variable.originalKey
  // The wildcards expression matches exactly the variable's `match` source
  // (capturing changes nothing about the match itself), so its failure is
  // the outside-the-pattern verdict.
  if (variable.wildcards.exec(value) === null) return isOriginal() ? 'accept' : 'pattern'
  return hasRoleShape(variable, raw, value) || isOriginal() ? 'accept' : 'shape'
}

// --- Alignment ---------------------------------------------------------------

interface Failure {
  pos: number
  pc: number
  variableStart: number
  variableEnd: number
}

interface AlignInput {
  readonly tokens: readonly Token[]
  readonly text: string
  readonly equivalences: Equivalences
}

/**
 * Whether the template matches the input from token `from` to the end: a
 * backtracking walk over the compiled program, memoizing dead
 * (instruction, position) states, trying each variable's candidate ends
 * only where the template's next token can follow.
 */
function isAligned(
  template: LicenseTemplate,
  input: AlignInput,
  from: number,
  failure: Failure,
): boolean {
  const { program, firstSets } = template
  const { tokens, text, equivalences } = input
  const dead = new Set<number>()
  const width = tokens.length + 1
  const note = (pos: number, pc: number): void => {
    if (pos <= failure.pos) return
    failure.pos = pos
    failure.pc = pc
  }
  const isVariableMatched = (pc: number, pos: number, variable: TemplateVariable): boolean => {
    const next = firstSets[pc + 1] ?? new Set<string>()
    const startOffset = tokens[pos]?.start ?? text.length
    for (let end = pos; end <= tokens.length; end += 1) {
      const endOffset = end === pos ? startOffset : (tokens[end - 1]?.end ?? text.length)
      if (endOffset - startOffset > variable.maxChars) return false
      const follower = tokens[end]?.norm ?? END_TOKEN
      if (!next.has(ANY_TOKEN) && !next.has(follower)) continue
      const verdict = judgeVariable(variable, text.slice(startOffset, endOffset), equivalences)
      if (verdict === 'accept' && isRunMatched(pc + 1, end)) return true
      if (verdict !== 'shape' || (failure.variableEnd >= 0 && pos <= failure.variableStart))
        continue
      // The deepest rejected variable, at its shortest rejected text.
      failure.variableStart = pos
      failure.variableEnd = end
    }
    // No acceptable end at all (the text stops, or what follows is not
    // the template's next word): the difference starts at the variable.
    note(pos, pc)
    return false
  }
  const isRunMatched = (startPc: number, startPos: number): boolean => {
    let pc = startPc
    let pos = startPos
    for (;;) {
      const key = pc * width + pos
      const instruction = program[pc]
      if (instruction === undefined || dead.has(key)) return false
      if (instruction.op === 'token' && tokens[pos]?.norm === instruction.value) {
        pc += 1
        pos += 1
        continue
      }
      if (instruction.op === 'end' && pos === tokens.length) return true
      let isMatched = false
      if (instruction.op === 'split')
        isMatched =
          isRunMatched(pc + 1, pos) ||
          isRunMatched(instruction.skip, pos) ||
          (template.noticeEntries.get(pc) ?? []).some((entry) => isRunMatched(entry, pos))
      else if (instruction.op === 'variable')
        isMatched = isVariableMatched(pc, pos, instruction.variable)
      else note(pos, pc)
      if (!isMatched) dead.add(key)
      return isMatched
    }
  }
  return isRunMatched(0, from)
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf('\n', from)
  return newline === -1 ? text.length : newline
}

function expectedAt(template: LicenseTemplate, pc: number): string {
  const words: string[] = []
  for (let at = pc; words.length < LEGAL_TEMPLATE_EXPECTED_TOKENS; at += 1) {
    const instruction = template.program[at]
    if (instruction === undefined || instruction.op === 'end') break
    if (instruction.op === 'token') words.push(instruction.value)
    else if (instruction.op === 'variable') words.push(`<${instruction.variable.name}>`)
  }
  return words.join(' ')
}

function differenceOf(
  template: LicenseTemplate,
  input: AlignInput,
  failure: Failure,
): TemplateDifference {
  const { tokens, text } = input
  const bound = (start: number, end: number): string =>
    collapse(text.slice(start, Math.min(end, start + LEGAL_TEMPLATE_SPAN_MAX_CHARS)))
  if (failure.variableEnd >= 0 && failure.variableStart >= failure.pos) {
    const start = tokens[failure.variableStart]?.start ?? 0
    const end = tokens[failure.variableEnd - 1]?.end ?? text.length
    return { templateId: template.id, span: bound(start, end), expected: '' }
  }
  const token = tokens[Math.max(failure.pos, 0)]
  const expected = expectedAt(template, failure.pc)
  return token === undefined
    ? { templateId: template.id, span: '', expected }
    : { templateId: template.id, span: bound(token.start, lineEnd(text, token.start)), expected }
}

/**
 * The tokens without title lines: among the first few lines, a line made
 * only of the template's title words (`The MIT License (MIT)`, or `MIT
 * License` written after the copyright line) carries no terms. Undefined
 * when there is no such line.
 */
function withoutTitleLines(
  template: LicenseTemplate,
  tokens: readonly Token[],
): readonly Token[] | undefined {
  const lines = [...new Set(tokens.map((token) => token.line))].slice(
    0,
    LEGAL_TEMPLATE_TITLE_LINES_MAX,
  )
  const titles = new Set(
    lines.filter((line) => {
      const words = tokens.filter((token) => token.line === line && token.isWord)
      return words.length > 0 && words.every((token) => template.titleVocabulary.has(token.norm))
    }),
  )
  if (titles.size === 0) return undefined
  const kept = tokens.filter((token) => !titles.has(token.line))
  return kept.length > 0 ? kept : undefined
}

/**
 * Read a text against the pinned templates: exact when some template
 * aligns with all of its fixed text and every variable holds only what
 * its role allows; otherwise the closest template, when close enough,
 * with the first differing span. `undefined` when no template is close.
 */
export function readLicenseText(
  text: string,
  set: LicenseTemplateSet = licenseTemplateSet(),
): TemplateReading | undefined {
  const tokens = tokenize(text, set.equivalences)
  const counts = new Map<string, number>()
  let total = 0
  for (const token of tokens) {
    if (!token.isWord) continue
    counts.set(token.norm, (counts.get(token.norm) ?? 0) + 1)
    total += 1
  }
  if (total === 0) return undefined
  const input: AlignInput = { tokens, text, equivalences: set.equivalences }
  const sharedWith = (table: ReadonlyMap<string, number>): number => {
    let shared = 0
    for (const [word, count] of counts) shared += Math.min(count, table.get(word) ?? 0)
    return shared
  }
  const ranked = set.templates
    .map((template) => {
      const shared = sharedWith(template.wordCounts)
      const sharedRequired = sharedWith(template.requiredCounts)
      return {
        template,
        recall: template.requiredTotal === 0 ? 1 : sharedRequired / template.requiredTotal,
        similarity: Math.max(
          (2 * shared) / (template.wordTotal + total),
          (2 * sharedRequired) / (template.requiredTotal + total),
        ),
      }
    })
    .filter((entry) => entry.recall >= LEGAL_TEMPLATE_ALIGN_MIN)
    .toSorted((a, b) => b.similarity - a.similarity)
  // An exact alignment consumes one input word per required template
  // word, so only a template whose required words are all present can
  // match; the others are never walked for exactness.
  for (const { template, similarity, recall } of ranked) {
    if (recall < 1) continue
    // The text as written, without title-only lines, and without
    // copyright-notice lines outside the template's own slot (guidelines:
    // titles and copyright notices are not terms).
    const untitled = withoutTitleLines(template, tokens) ?? tokens
    const variants = new Set([
      tokens,
      untitled,
      withoutEdgeNotices(tokens, text, set.equivalences.restrictionWords),
      withoutEdgeNotices(untitled, text, set.equivalences.restrictionWords),
    ])
    for (const variant of variants) {
      if (isAligned(template, { ...input, tokens: variant }, 0, newFailure()))
        return { key: template.key, exact: true, similarity }
    }
  }
  const closest = ranked[0]
  if (closest === undefined || closest.similarity < LEGAL_TEMPLATE_SIMILARITY_MIN) return undefined
  const failure = newFailure()
  isAligned(closest.template, input, 0, failure)
  return {
    key: closest.template.key,
    exact: false,
    similarity: closest.similarity,
    difference: differenceOf(closest.template, input, failure),
  }
}

/**
 * The tokens without copyright-notice lines at the start or end (up to
 * three each): a notice outside the template's own slot carries no terms
 * when it passes the same notice check a copyright variable applies.
 */
function withoutEdgeNotices(
  tokens: readonly Token[],
  text: string,
  restricted: ReadonlySet<string>,
): readonly Token[] {
  const lines = [...new Set(tokens.map((token) => token.line))]
  const isNotice = (line: number): boolean => {
    const own = tokens.filter((token) => token.line === line)
    const first = own[0]
    const last = own.at(-1)
    return (
      first !== undefined &&
      last !== undefined &&
      isCopyrightNotice(text.slice(first.start, last.end), EMPTY_VOCABULARY, true, restricted)
    )
  }
  const dropped = new Set<number>()
  for (const line of lines.slice(0, LEGAL_TEMPLATE_TITLE_LINES_MAX)) {
    if (!isNotice(line)) break
    dropped.add(line)
  }
  for (const line of lines.toReversed().slice(0, LEGAL_TEMPLATE_TITLE_LINES_MAX)) {
    if (dropped.has(line) || !isNotice(line)) break
    dropped.add(line)
  }
  const kept = tokens.filter((token) => !dropped.has(token.line))
  return dropped.size === 0 || kept.length === 0 ? tokens : kept
}

function newFailure(): Failure {
  return { pos: -1, pc: 0, variableStart: 0, variableEnd: -1 }
}

/** The GPL family's version stems; `-only`/`-or-later` come from the project's grant. */
export function gplTemplateStems(
  set: LicenseTemplateSet = licenseTemplateSet(),
): ReadonlySet<string> {
  return new Set(set.templates.filter((template) => template.isGplFamily).map(({ key }) => key))
}
