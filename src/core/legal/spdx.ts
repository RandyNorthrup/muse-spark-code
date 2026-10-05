// SPDX license expressions (M97, PLAN.md D76): `AND`, `OR` and `WITH`
// with parentheses, parsed against the pinned identifier data. Operators
// are uppercase, as the SPDX specification writes them; anything else is
// malformed, never guessed. An `OR` alternative is a choice, not two
// mandatory licenses, and an exception changes the analysis — both shapes
// are preserved for the compatibility reader.

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

const CUSTOM_PREFIX = /^(documentref-|licenseref-)/i

type Token =
  | { readonly kind: 'open' | 'close' }
  | { readonly kind: 'operator'; readonly value: 'AND' | 'OR' | 'WITH' }
  | { readonly kind: 'id'; readonly value: string }

const ID_START = /[A-Za-z0-9]/
const ID_PART = /[A-Za-z0-9.+:-]/

function tokenize(text: string): { readonly tokens: readonly Token[]; readonly error?: string } {
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
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
      if (value === 'AND' || value === 'OR' || value === 'WITH') {
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

  parse(): SpdxNode | string {
    if (this.tokens.length === 0) {
      return 'Empty license expression'
    }
    const root = this.parseOr()
    if (typeof root === 'string') {
      return root
    }
    if (this.position < this.tokens.length) {
      return 'Unexpected text after the expression'
    }
    return root
  }

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
    const known = canonicalExceptionId(exceptionId) !== undefined
    return {
      kind: 'license',
      license: { ...primary.license, exception: { id: exceptionId, known } },
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
}

function recognizeLicense(raw: string): SpdxLicenseNode {
  const plus = raw.endsWith('+')
  const id = plus ? raw.slice(0, -1) : raw
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
    deprecated: canonicalId === undefined ? false : isDeprecatedLicenseId(canonicalId),
    plus,
    exception: undefined,
  }
}

function collectLicenses(root: SpdxNode): SpdxLicenseNode[] {
  if (root.kind === 'license') {
    return [root.license]
  }
  return root.children.flatMap(collectLicenses)
}

/**
 * Parse an SPDX license expression. Never throws on input: malformed text
 * comes back as `{ ok: false }` with one sentence the scanner can quote.
 * Recognition is case-insensitive for ids (`mit` is MIT); operators stay
 * uppercase, as the specification writes them.
 */
export function parseSpdxExpression(text: string): SpdxExpression {
  const trimmed = text.trim()
  if (trimmed === '') {
    return { ok: false, error: 'Empty license expression' }
  }
  const { tokens, error } = tokenize(trimmed)
  if (error !== undefined) {
    return { ok: false, error }
  }
  const parser = new ExpressionParser(tokens)
  const root = parser.parse()
  if (typeof root === 'string') {
    return { ok: false, error: root }
  }
  return { ok: true, root, licenses: collectLicenses(root) }
}

/**
 * Each top-level `OR` alternative's license ids (canonical spelling when
 * recognized, as written otherwise). A single license (no `OR`) is one
 * alternative; an `AND` of licenses is one alternative holding several
 * ids. The compatibility reader treats an alternative as a choice.
 */
export function orAlternatives(root: SpdxNode): readonly (readonly string[])[] {
  if (root.kind === 'or') {
    return root.children.map((child) => alternativeIds(child))
  }
  return [alternativeIds(root)]
}

function alternativeIds(node: SpdxNode): readonly string[] {
  if (node.kind === 'license') {
    return [node.license.canonicalId ?? node.license.id]
  }
  return node.children.flatMap(alternativeIds)
}
