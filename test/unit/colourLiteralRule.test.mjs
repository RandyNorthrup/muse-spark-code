import path from 'node:path'
import { ESLint } from 'eslint'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()
const colourMessage = 'Raw colours belong in design/tokens/muse.tokens.json; read a --ms-* token.'

async function colourErrors(code, file) {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) })
  return results.flatMap((result) =>
    result.messages.filter((message) => message.message === colourMessage),
  )
}
async function css(code, file = 'src/webview/styles.css') {
  return await stylelint.lint({ code, codeFilename: path.resolve(file) })
}

describe('D94 raw colour guards', () => {
  it.each([
    '#fff',
    '#abcd',
    '#123456',
    '#12345678',
    'rgb(1 2 3)',
    'rgba(0,0,0,1)',
    'hsl(0 0% 0%)',
    'oklch(50% 0.2 20)',
    'color(display-p3 1 0 0)',
  ])('rejects the TypeScript colour literal %s', async (colour) => {
    expect(
      await colourErrors(
        `export const paint = ${JSON.stringify(colour)}`,
        'src/webview/components/icons.tsx',
      ),
    ).toHaveLength(1)
  })

  it.each([
    ' #fff',
    '1px solid #abcdef',
    'linear-gradient(rgb(0 0 0), var(--ms-text))',
    '<path fill="#abcdef" />',
  ])('rejects raw paint embedded in a TypeScript CSS or SVG string: %s', async (paint) => {
    expect(
      await colourErrors(
        `export const paint = ${JSON.stringify(paint)}`,
        'src/webview/components/icons.tsx',
      ),
    ).toHaveLength(1)
  })

  it('keeps the guard in both syntax-rule blocks and catches templates and JSX SVG paint', async () => {
    for (const file of ['src/core/fs/fileIdentity.ts', 'src/core/agent/agentBackend.ts']) {
      expect(await colourErrors('export const paint = "#123456"', file)).toHaveLength(1)
    }
    expect(
      await colourErrors('export const paint = `#abc`', 'src/webview/components/icons.tsx'),
    ).toHaveLength(1)
    expect(
      await colourErrors(
        'export const Paint = () => <path fill="#aabbcc" />',
        'src/webview/components/icons.tsx',
      ),
    ).toHaveLength(1)
    expect(
      await colourErrors(
        'export const paint = "var(--ms-accent)"',
        'src/webview/components/icons.tsx',
      ),
    ).toHaveLength(0)
    expect(
      await colourErrors(
        'export const id = "url(#meta-logo-a)"',
        'src/webview/components/icons.tsx',
      ),
    ).toHaveLength(0)
  })

  it.each([
    '#fff',
    'rgb(1 2 3)',
    'rgba(0,0,0,1)',
    'hsl(0 0% 0%)',
    'hwb(0 0% 0%)',
    'lab(50% 0 0)',
    'lch(50% 0 0)',
    'oklab(50% 0 0)',
    'oklch(50% 0 0)',
    'color(srgb 0 0 0)',
    'color-mix(in srgb, var(--ms-text), transparent)',
  ])('rejects CSS colour %s, including fallbacks', async (colour) => {
    const result = await css(`.example { color: var(--ms-text, ${colour}); }`)
    expect(
      result.results
        .flatMap((r) => r.warnings)
        .some((w) => ['color-no-hex', 'function-disallowed-list'].includes(w.rule)),
    ).toBe(true)
  })

  it('allows raw CSS only in the exact generated token outputs, while keeping their other lint rules', async () => {
    const role = await css('.example { color: var(--ms-text); }')
    expect(role.errored).toBe(false)
    const generated = await css('.example { color: #fff; }', 'src/webview/tokens.css')
    expect(generated.errored).toBe(false)
    const unowned = await css('.example { color: #fff; }', 'src/webview/unowned-tokens.css')
    expect(unowned.errored).toBe(true)
    const unknown = await css(
      '.example { color: #fff; unknown-property: 1; }',
      'src/webview/tokens.css',
    )
    expect(unknown.errored).toBe(true)
  })
})
