// RVCM1091D P3 (nav focus rings): the models nav gap must clear the focus
// ring's reach (outline width + offset), as the other panels' rows do.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MODELS_CSS = path.resolve(import.meta.dirname, '../../src/webview/models/models.css')
const TOKENS_CSS = path.resolve(import.meta.dirname, '../../src/webview/tokens.css')

function pxvars(source) {
  const vars = new Map()
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(match[2].trim())
    const ref = /^var\((--[\w-]+)\)$/.exec(match[2].trim())
    if (px !== null) vars.set(match[1], Number(px[1]))
    else if (ref !== null) vars.set(match[1], ref[1])
  }
  return vars
}

function resolvePx(vars, name) {
  let current = name
  const seen = []
  for (;;) {
    if (seen.includes(current)) throw new Error(`Cyclic token: ${current}`)
    seen.push(current)
    const value = vars.get(current)
    if (value === undefined) throw new Error(`Unresolved token: ${current}`)
    if (typeof value === 'number') return value
    current = value
  }
}

function ruleBlock(source, selector) {
  const start = source.indexOf(selector)
  if (start === -1) throw new Error(`Missing rule: ${selector}`)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

function declaration(block, property) {
  const match = new RegExp(String.raw`${property}\s*:\s*([^;]+);`).exec(block)
  if (match === null) throw new Error(`Missing declaration: ${property}`)
  return match[1].trim()
}

describe('RVCM1091D models nav focus gap', () => {
  it('keeps a clear gap between the focus ring and the neighbouring tab', () => {
    const models = readFileSync(MODELS_CSS, 'utf8')
    const tokens = readFileSync(TOKENS_CSS, 'utf8')
    const vars = new Map([...pxvars(tokens), ...pxvars(models)])
    const gap = declaration(ruleBlock(models, '.models-nav'), 'gap')
    const gapPx = /^var\((--[\w-]+)\)$/.exec(gap)
    if (gapPx === null) throw new Error(`Nav gap must come from a shared token: ${gap}`)
    const focus = ruleBlock(models, '.models-panel :focus-visible')
    const width = /^var\((--[\w-]+)\)/.exec(declaration(focus, 'outline'))
    const offset = /^var\((--[\w-]+)\)$/.exec(declaration(focus, 'outline-offset'))
    if (width === null || offset === null) throw new Error('Focus ring must use shared tokens')
    const reach = resolvePx(vars, width[1]) + resolvePx(vars, offset[1])
    expect(resolvePx(vars, gapPx[1])).toBeGreaterThan(reach)
  })
})
