// SPDX license expressions (M97, PLAN.md D76): `AND`, `OR` and `WITH`
// with parentheses, parsed against the pinned identifier data. Operators
// are uppercase, as the SPDX specification writes them; anything else is
// malformed, never guessed. An `OR` alternative is a choice, not two
// mandatory licenses, and an exception changes the analysis — both shapes
// are preserved for the compatibility reader.

import {
  LEGAL_TEXT_MAX_CHARS,
  LEGAL_HEADER_LINE_WINDOW,
  LEGAL_FINDINGS_MAX,
} from '../../shared/constants'
import { canonicalExceptionId, canonicalLicenseId, isDeprecatedLicenseId } from './data'

/** One license entry in an expression, with its recognition state. */
export interface SpdxLicenseNode {
  /** The id as written, without a trailing `+`. */
  readonly id: string
  /** The list's own spelling, case-corrected, or `undefined` if unknown. */
  readonly canonicalId: string | undefined
  /** True for `LicenseRef-` and `DocumentRef-` terms: custom, preserved. */
  readonly custom: boolean
  /** True for a retired list id: still an identifier, flagged as dated. */
  readonly deprecated: boolean
  /** True for the retired trailing-`+` "or later" mark. */
  readonly plus: boolean
  /** A `WITH` exception: recognized against the pinned exception list. */
  readonly exception: { readonly id: string; readonly known: boolean } | undefined
}

/** An expression tree: licenses joined by `AND` / `OR`. */
export type SpdxNode =
  | { readonly kind: 'license'; readonly license: SpdxLicenseNode }
  | { readonly kind: 'and' | 'or'; readonly children: readonly SpdxNode[] }

/** The parse outcome: a tree plus every license entry, or one error. */
export type SpdxExpression =
  | { readonly ok: true; readonly root: SpdxNode; readonly licenses: readonly SpdxLicenseNode[] }
  | { readonly ok: false; readonly error: string }

const CUSTOM_PREFIX =
  /^(?:LicenseRef-[A-Za-z0-9.-]+|DocumentRef-[A-Za-z0-9.-]+:LicenseRef-[A-Za-z0-9.-]+)$/i

type Token =
  | { readonly kind: 'open' | 'close' }
  | { readonly kind: 'operator'; readonly value: 'AND' | 'OR' | 'WITH' }
  | { readonly kind: 'id'; readonly value: string }

const ID_START = /[A-Za-z0-9]/
const ID_PART = /[A-Za-z0-9.+:-]/

function isOperator(value: string): value is 'AND' | 'OR' | 'WITH' {
  return ['AND', 'OR', 'WITH'].includes(value)
}

function tokenize(text: string): { readonly tokens: readonly Token[]; readonly error?: string } {
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if ([' ', '\t', '\n', '\r'].includes(char)) {
      index += 1
      continue
    }
    if (char === '(') {
      tokens.push({ kind: 'open' })
      index += 1
      continue
    }
    if (char === ')') {
      tokens.push({ kind: 'close' })
      index += 1
      continue
    }
    if (ID_START.test(char)) {
      let end = index + 1
      while (end < text.length && ID_PART.test(text[end] ?? '')) {
        end += 1
      }
      const value = text.slice(index, end)
      if (isOperator(value)) {
        tokens.push({ kind: 'operator', value })
      } else {
        tokens.push({ kind: 'id', value })
      }
      index = end
      continue
    }
    return { tokens, error: `Unexpected character ${JSON.stringify(char)}` }
  }
  return { tokens }
}

class ExpressionParser {
  private position = 0
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.position]
  }

  private parseOr(): SpdxNode | string {
    return this.parseJoin('OR', 'or', () => this.parseAnd())
  }

  private parseAnd(): SpdxNode | string {
    return this.parseJoin('AND', 'and', () => this.parseWith())
  }

  private parseJoin(
    word: 'OR' | 'AND',
    kind: 'or' | 'and',
    parseOperand: () => SpdxNode | string,
  ): SpdxNode | string {
    const left = parseOperand()
    if (typeof left === 'string') {
      return left
    }
    const children: SpdxNode[] = [left]
    let next = this.peek()
    while (next?.kind === 'operator' && next.value === word) {
      this.position += 1
      const right = parseOperand()
      if (typeof right === 'string') {
        return right
      }
      children.push(right)
      next = this.peek()
    }
    return children.length === 1 ? left : { kind, children }
  }

  private parseWith(): SpdxNode | string {
    const primary = this.parsePrimary()
    if (typeof primary === 'string' || primary.kind !== 'license') {
      return primary
    }
    const next = this.peek()
    if (next?.kind !== 'operator' || next.value !== 'WITH') {
      return primary
    }
    this.position += 1
    const exceptionToken = this.peek()
    if (exceptionToken?.kind !== 'id') {
      return 'WITH must name a license exception'
    }
    this.position += 1
    const exceptionId = exceptionToken.value
    const isKnown = canonicalExceptionId(exceptionId) !== undefined
    return {
      kind: 'license',
      license: { ...primary.license, exception: { id: exceptionId, known: isKnown } },
    }
  }

  private parsePrimary(): SpdxNode | string {
    const token = this.peek()
    if (token === undefined) {
      return 'Unexpected end of the expression'
    }
    if (token.kind === 'open') {
      this.position += 1
      const inner = this.parseOr()
      if (typeof inner === 'string') {
        return inner
      }
      const closing = this.peek()
      if (closing?.kind !== 'close') {
        return 'Missing closing parenthesis'
      }
      this.position += 1
      return inner
    }
    if (token.kind === 'id') {
      this.position += 1
      return { kind: 'license', license: recognizeLicense(token.value) }
    }
    return 'Unexpected operator without a license beside it'
  }
  parse(): SpdxNode | string {
    if (this.tokens.length === 0) {
      return 'Empty license expression'
    }
    const root = this.parseOr()
    if (typeof root === 'string') {
      return root
    }
    return this.position < this.tokens.length ? 'Unexpected text after the expression' : root
  }
}

function recognizeLicense(raw: string): SpdxLicenseNode {
  const isPlus = raw.endsWith('+')
  const id = (isPlus && raw.slice(0, -1)) || raw
  if (CUSTOM_PREFIX.test(id)) {
    return {
      id,
      canonicalId: undefined,
      custom: true,
      deprecated: false,
      plus: false,
      exception: undefined,
    }
  }
  const canonicalId = canonicalLicenseId(id)
  return {
    id,
    canonicalId,
    custom: false,
    deprecated: canonicalId !== undefined && isDeprecatedLicenseId(canonicalId),
    plus: isPlus,
    exception: undefined,
  }
}

function collectLicenses(root: SpdxNode): SpdxLicenseNode[] {
  return root.kind === 'license'
    ? [root.license]
    : root.children.flatMap((child) => collectLicenses(child))
}

/**
 * Parse an SPDX license expression. Never throws on input: malformed text
 * comes back as `{ ok: false }` with one sentence the scanner can quote.
 * Recognition is case-insensitive for ids (`mit` is MIT); operators stay
 * uppercase, as the specification writes them.
 */
export function parseSpdxExpression(text: string): SpdxExpression {
  const trimmed = text.trim()
  if (trimmed.length > LEGAL_TEXT_MAX_CHARS)
    return { ok: false, error: 'License expression exceeds the text bound' }
  let depth = 0
  for (const char of trimmed) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (depth > LEGAL_HEADER_LINE_WINDOW)
      return { ok: false, error: 'License expression nesting exceeds the bound' }
  }
  if (trimmed === '') {
    return { ok: false, error: 'Empty license expression' }
  }
  const { tokens, error } = tokenize(trimmed)
  if (error !== undefined) {
    return { ok: false, error }
  }
  if (
    tokens.some(
      (token) =>
        token.kind === 'id' &&
        ((/^(documentref-|licenseref-)/i.test(token.value) && !CUSTOM_PREFIX.test(token.value)) ||
          (!CUSTOM_PREFIX.test(token.value) &&
            !/^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/.test(token.value))),
    )
  )
    return { ok: false, error: 'Malformed license identifier' }

  const parser = new ExpressionParser(tokens)
  const root = parser.parse()
  if (typeof root !== 'string' && alternativeCount(root) > LEGAL_FINDINGS_MAX)
    return { ok: false, error: 'License expression alternatives exceed the bound' }
  return typeof root === 'string'
    ? { ok: false, error: root }
    : { ok: true, root, licenses: collectLicenses(root) }
}

/**
 * Each top-level `OR` alternative's license ids (canonical spelling when
 * recognized, as written otherwise). A single license (no `OR`) is one
 * alternative; an `AND` of licenses is one alternative holding several
 * ids. The compatibility reader treats an alternative as a choice.
 */
export function orAlternatives(root: SpdxNode): readonly (readonly string[])[] {
  if (root.kind === 'license') return [[root.license.canonicalId ?? root.license.id]]
  if (root.kind === 'or')
    return root.children.flatMap((child) => orAlternatives(child)).slice(0, LEGAL_FINDINGS_MAX)
  let alternatives: readonly (readonly string[])[] = [[]]
  const listed1 = root.children
  for (const child of listed1) {
    const choices = orAlternatives(child)
    if (alternatives.length * choices.length > LEGAL_FINDINGS_MAX)
      return [collectLicenses(root).map((license) => license.canonicalId ?? license.id)]
    alternatives = alternatives.flatMap((left) => choices.map((right) => [...left, ...right]))
  }
  return alternatives
}

function alternativeCount(node: SpdxNode): number {
  if (node.kind === 'license') return 1
  let count = node.kind === 'or' ? 0 : 1
  for (const child of node.children) {
    const childCount = alternativeCount(child)
    count = node.kind === 'or' ? count + childCount : count * childCount
    if (count > LEGAL_FINDINGS_MAX) return count
  }
  return count
}
