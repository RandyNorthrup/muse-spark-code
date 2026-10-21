// RVCM1091D P3 (vault button chrome): the vault actions keep a visible
// edge and a resolved fill in every captured theme, through the shared
// button tokens (`--vscode-button-border` first, `--ms-*` as fallback).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const VAULT_CSS = path.resolve(
  import.meta.dirname,
  '../../src/webview/models/sections/vault/vault.css',
)
const TOKENS_CSS = path.resolve(import.meta.dirname, '../../src/webview/tokens.css')
const THEME_DIRECTORY = path.resolve(import.meta.dirname, '../harness/themes')

function declarations(source) {
  const start = source.indexOf('.vault-card button')
  if (start === -1) throw new Error('Missing rule: .vault-card button')
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  const found = new Map()
  const body = source.slice(open + 1, close)
  const entries = body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)
  for (const match of entries) {
    found.set(match[1], match[2].trim())
  }
  return found
}

function themeVariables(name) {
  const raw = JSON.parse(readFileSync(path.join(THEME_DIRECTORY, name), 'utf8'))
  return raw.variables ?? raw
}

function tokenDeclarations() {
  const source = readFileSync(TOKENS_CSS, 'utf8')
  const root = source.slice(
    source.indexOf(':root {'),
    source.indexOf('}', source.indexOf(':root {')),
  )
  const found = new Map()
  const entries = root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gs)
  for (const match of entries) {
    found.set(match[1], match[2].replaceAll(/\s+/g, ' ').trim())
  }
  return found
}

function splitVar(expression) {
  const match = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(expression)
  return match === null ? null : { name: match[1], fallback: match[2] }
}

// Resolve to a terminal paint: a literal colour, `transparent`, or the
// constant `colormix` when a color-mix() input resolves to a theme colour
// (the boundary gate proves that mix reaches 3:1 in every theme).
function resolvePaint(expression, variables, tokens) {
  let current = expression
  const seen = []
  for (;;) {
    const direct = transparentAlpha(current)
    if (direct !== null) return direct === 0 ? 'transparent' : 'paint'
    if (current.startsWith('color-mix(')) return 'paint'
    const ref = splitVar(current)
    if (ref === null) return 'paint'
    if (seen.includes(ref.name)) throw new Error(`Cyclic token: ${ref.name}`)
    seen.push(ref.name)
    if (ref.name.startsWith('--vscode-') && variables[ref.name] !== undefined) {
      current = variables[ref.name]
    } else {
      const declared = tokens.get(ref.name) ?? ref.fallback
      if (declared === undefined) throw new Error(`Unresolved token: ${ref.name}`)
      current = declared
    }
  }
}

function transparentAlpha(literal) {
  const text = literal.trim().toLowerCase()
  if (text === 'transparent') return 0
  const rgba = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*([\d.]+))?\s*\)$/.exec(text)
  if (rgba !== null) return rgba[1] === undefined ? 1 : Number(rgba[1])
  if (/^#[\da-f]{6}$/.test(text) || /^#[0-9a-f]{8}$/.test(text)) {
    return text.length === 9 ? Number.parseInt(text.slice(7), 16) / 255 : 1
  }
  return null
}

const THEMES = readdirSync(THEME_DIRECTORY).filter((name) => name.endsWith('.json'))

describe('RVCM1091D vault button chrome', () => {
  it.each(THEMES)('keeps a visible button edge in %s', (theme) => {
    const source = readFileSync(VAULT_CSS, 'utf8')
    const rules = declarations(source)
    const border = rules.get('border')
    if (border === undefined) throw new Error('Vault buttons need a border declaration')
    const colour = /^1px\s+solid\s+(.+)$/.exec(border)
    if (colour === null) throw new Error(`Vault button border must be a 1px solid edge: ${border}`)
    expect(colour[1]).toContain('--vscode-button-border')
    const resolved = resolvePaint(colour[1], themeVariables(theme), tokenDeclarations())
    expect(resolved).toBe('paint')
  })

  it.each(THEMES)('resolves the button fill and label in %s', (theme) => {
    const source = readFileSync(VAULT_CSS, 'utf8')
    const rules = declarations(source)
    const tokens = tokenDeclarations()
    const variables = themeVariables(theme)
    for (const property of ['background', 'color']) {
      const value = rules.get(property)
      if (value === undefined) throw new Error(`Vault buttons need ${property}`)
      // Must terminate: a dropped declaration is the plain-text bug.
      resolvePaint(value, variables, tokens)
    }
  })
})
