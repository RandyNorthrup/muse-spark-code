// R1: the assured boundary role keeps a 3:1 floor in every captured theme.
// The shipped `--ms-boundary` rule mixes the theme's own foreground into its
// background, so this test resolves that exact declaration against each
// captured theme receipt (`test/harness/themes/*.json`) and asserts the
// resolved boundary reaches 3:1 on every surface it can sit on.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../scripts/check-tokens.mjs'

const THEME_DIRECTORY = path.resolve(import.meta.dirname, '../harness/themes')
const TOKENS_CSS = path.resolve(import.meta.dirname, '../../src/webview/tokens.css')
const BOUNDARY_RATIO = 3

function parseColour(value) {
  const text = value.trim()
  const hex = /^#([\da-f]{6})$/i.exec(text)
  if (hex !== null) {
    const digits = hex[1]
    return {
      colorSpace: 'srgb',
      alpha: 1,
      components: [0, 2, 4].map(
        (index) => Number.parseInt(digits.slice(index, index + 2), 16) / 255,
      ),
    }
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    text,
  )
  if (rgb !== null) {
    return {
      colorSpace: 'srgb',
      alpha: rgb[4] === undefined ? 1 : Number(rgb[4]),
      components: [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255],
    }
  }
  throw new Error(`Cannot resolve theme colour: ${value}`)
}

// Resolve one variable through the shipped fallback chain: a host variable
// reads the theme receipt, anything else falls back to the next variable or
// to the literal the generated stylesheet carries.
function resolveVariable(declarations, variables, name) {
  const seen = []
  let current = name
  for (;;) {
    if (seen.includes(current))
      throw new Error(`Cyclic token fallback: ${[...seen, current].join(' -> ')}`)
    seen.push(current)
    if (current.startsWith('--vscode-') && variables[current] !== undefined) {
      return parseColour(variables[current])
    }
    const declaration = declarations.get(current)
    if (declaration === undefined || declaration.literal === undefined)
      throw new Error(`Unresolved variable: ${current}`)
    if (declaration.variable === undefined) return parseColour(declaration.literal)
    current = declaration.variable
  }
}

function readDeclarations(css) {
  const flat = css.replaceAll(/\s+/g, ' ')
  const declarations = new Map()
  for (const match of flat.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    const nested = /var\(\s*(--[\w-]+)/.exec(match[2])
    const literal = /#[\da-f]{3,8}/i.exec(match[2])
    declarations.set(match[1], {
      variable: nested === null ? undefined : nested[1],
      literal: literal === null ? undefined : literal[0],
    })
  }
  return declarations
}

function readBoundaryRule(css) {
  const flat = css.replaceAll(/\s+/g, ' ')
  const rule = /--ms-boundary\s*:\s*(color-mix\(.*\))\s*;/.exec(flat)
  if (rule === null) throw new Error('The generated stylesheet names no --ms-boundary rule')
  return rule[1]
}

const compareNames = (a, b) => {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function themeFiles() {
  return readdirSync(THEME_DIRECTORY)
    .filter((file) => file.endsWith('.json'))
    .toSorted(compareNames)
}

// A boundary on a translucent surface reads against whatever is behind it;
// the receipts capture opaque canvases, so measure over the sidebar surface.
const SURFACES = [
  '--vscode-sideBar-background',
  '--vscode-editorWidget-background',
  '--vscode-input-background',
  '--vscode-button-secondaryBackground',
]

describe('R1 assured boundary contrast', () => {
  it('derives --ms-boundary from the theme foreground and background, never a host border', () => {
    const css = readFileSync(TOKENS_CSS, 'utf8')
    const body = readBoundaryRule(css)
    expect(body).toContain('var(--vscode-foreground')
    expect(body).toContain('var(--vscode-editor-background')
    expect(body).not.toContain('panel-border')
    expect(body).not.toContain('input-border')
  })

  it.each(themeFiles())('keeps %s at 3:1 or more on every boundary surface', (file) => {
    const css = readFileSync(TOKENS_CSS, 'utf8')
    const declarations = readDeclarations(css)
    const body = readBoundaryRule(css)
    const foregroundName = /var\(\s*(--vscode-foreground)\b/.exec(body)?.[1]
    const backgroundName = /var\(\s*(--vscode-editor-background)\b/.exec(body)?.[1]
    const shareText = /\)\s*([\d.]+)%\s*,/.exec(body)?.[1]
    expect(
      foregroundName !== undefined && backgroundName !== undefined && shareText !== undefined,
      'boundary mixes foreground into background at a fixed share',
    ).toBe(true)
    const theme = JSON.parse(readFileSync(path.join(THEME_DIRECTORY, file), 'utf8'))
    const variables = theme.variables ?? {}
    const foreground = resolveVariable(declarations, variables, foregroundName)
    const background = resolveVariable(declarations, variables, backgroundName)
    const share = Number(shareText) / 100
    const boundary = {
      colorSpace: 'srgb',
      alpha: 1,
      components: foreground.components.map(
        (channel, index) => channel * share + background.components[index] * (1 - share),
      ),
    }
    const canvas = resolveVariable(declarations, variables, '--vscode-sideBar-background')
    for (const surface of SURFACES) {
      if (variables[surface] === undefined) continue
      const ratio = contrastRatio(boundary, parseColour(variables[surface]), canvas)
      expect(
        ratio,
        `${file}: boundary over ${surface} measures ${ratio.toFixed(3)}:1, below ${BOUNDARY_RATIO}:1`,
      ).toBeGreaterThanOrEqual(BOUNDARY_RATIO)
    }
  })

  it('draws the R1 control boundaries from the assured role', () => {
    const models = readFileSync(
      path.resolve(import.meta.dirname, '../../src/webview/models/models.css'),
      'utf8',
    )
    expect(models).toMatch(/\.models-button\s*\{[^}]*var\(--ms-boundary\)[^}]*\}/s)
    const accounts = readFileSync(
      path.resolve(import.meta.dirname, '../../src/webview/models/sections/accounts/accounts.css'),
      'utf8',
    )
    expect(accounts).toMatch(/\.account-picker\s*\{[^}]*var\(--ms-boundary\)[^}]*\}/s)
    const traffic = readFileSync(
      path.resolve(import.meta.dirname, '../../src/webview/components/traffic/traffic.css'),
      'utf8',
    )
    expect(traffic).toMatch(/\.traffic-view button\s*\{[^}]*var\(--ms-boundary\)[^}]*\}/s)
  })
})
