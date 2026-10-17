import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('webview reduced motion (M87)', () => {
  it('disables every animated or transitioned selector under reduced motion', () => {
    const css = readFileSync(
      new URL('../../src/webview/styles.css', import.meta.url),
      'utf8',
    ).replaceAll(/\/\*[\s\S]*?\*\//g, '')
    // The closing media block owns motion overrides. Leaf rules include those
    // nested in media/container queries; keyframe steps declare no motion.
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(
      css,
    )?.[1]
    expect(reduced).toBeDefined()
    const rules: RegExpExecArray[] = []
    const overrides: RegExpExecArray[] = []
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push(rule)
    }
    const reducedRules = (reduced ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)
    for (const rule of reducedRules) {
      overrides.push(rule)
    }
    const moving = rules.flatMap((rule) => {
      const properties: string[] = []
      const declarations = (rule[2] ?? '').matchAll(/\b(animation|transition)\s*:\s*([^;]+);/g)
      for (const property of declarations) {
        if (property[1] !== undefined && property[2]?.trim() !== 'none') {
          properties.push(property[1])
        }
      }
      return (rule[1] ?? '')
        .split(',')
        .flatMap((selector) =>
          properties.map((property) => ({ selector: selector.trim(), property })),
        )
    })
    expect(moving.length).toBeGreaterThan(0)
    for (const { selector, property } of moving) {
      const isCovered = overrides.some(
        (rule) =>
          (rule[1] ?? '').split(',').some((candidate) => candidate.trim() === selector) &&
          new RegExp(String.raw`\b${property}\s*:\s*none\s*;`).test(rule[2] ?? ''),
      )
      expect(isCovered, `${selector} needs ${property}: none under reduced motion`).toBe(true)
    }
  })
})
