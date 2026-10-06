import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transform } from 'esbuild'
import stylelint from 'stylelint'
import prettier from 'prettier'
import path from 'node:path'
import {
  TOKEN_EXTENSION,
  TOKEN_SOURCE,
  parseTokens,
  renderTokens,
  resolveToken,
} from '../../scripts/build-tokens.mjs'

const source = () => JSON.parse(readFileSync(TOKEN_SOURCE, 'utf8'))

describe('D94 one token source', () => {
  it('generates deterministic web, native, TH and TD inputs with one name per token', async () => {
    const input = source()
    const outputs = await renderTokens(input)
    expect(await renderTokens(input)).toEqual(outputs)
    const consumers = JSON.parse(outputs['design/tokens/generated/consumers.json'])
    expect(Object.keys(consumers.modes)).toEqual(['light', 'dark', 'hc-light', 'hc-dark'])
    const { tokens } = parseTokens(input)
    for (const mode of Object.values(consumers.modes)) {
      expect(Object.keys(mode)).toEqual(Object.keys(tokens))
    }
    expect(consumers.hostRoles['colour.text'].vscode).toEqual(['--vscode-foreground'])
    expect(consumers.hostRoles['colour.focus'].vscode).toEqual(['--vscode-focusBorder'])
    expect(consumers.hostRoles['typography.font-code'].vscode).toEqual([
      '--vscode-editor-font-family',
    ])
    expect(consumers.modes.dark['radius.md'].css).toBe('6px')
    expect(consumers.modes.dark['motion.slow'].css).toBe('240ms')
    expect(outputs['src/webview/tokens.css']).toContain('--ms-text: var(--vscode-foreground,')
    expect(outputs['src/webview/tokens.css']).toContain('var(--ms-shadow)')
  })

  it('keeps high contrast opaque and flat, and honours reduced transparency', async () => {
    const outputs = await renderTokens(source())
    const consumers = JSON.parse(outputs['design/tokens/generated/consumers.json'])
    for (const mode of ['hc-light', 'hc-dark']) {
      for (const name of ['flat', 'raised', 'popover', 'overlay']) {
        expect(consumers.modes[mode][`elevation.${name}`].css).toBe('none')
      }
      for (const name of ['overlay-alpha', 'popover-alpha', 'launcher-alpha']) {
        expect(consumers.modes[mode][`translucency.${name}`].value).toBe(1)
      }
      expect(consumers.modes[mode]['translucency.backdrop-blur'].css).toBe('0px')
    }
    const hc = outputs['src/webview/tokens.css'].match(
      /\.vscode-high-contrast,\s*\.vscode-high-contrast-light\s*\{([^}]+)\}/,
    )[1]
    expect(hc).toContain('--ms-elevation-raised: none;')
    expect(hc).toContain('--ms-overlay-alpha: 1;')
    expect(hc).toContain('--ms-backdrop-blur: 0;')
    expect(outputs['src/webview/tokens.css']).toContain('.vscode-high-contrast-light')
    expect(outputs['src/webview/tokens.css']).toContain('--ms-modal-scrim: #fff')
    expect(outputs['src/webview/tokens.css']).toContain('--ms-modal-scrim: var(--ms-surface)')
    expect(outputs['design/tokens/generated/muse.css']).toContain(
      'prefers-reduced-transparency: reduce',
    )
  })

  it('rejects invalid source types, duplicate names, absent modes and dangling/cyclic references', async () => {
    const invalid = source()
    invalid.radius.md.$value.unit = 'seconds'
    expect(() => parseTokens(invalid)).toThrow()
    const duplicate = source()
    duplicate.radius.md.$extensions[TOKEN_EXTENSION].css = '--ms-gap'
    await expect(renderTokens(duplicate)).rejects.toThrow('Duplicate CSS token')
    const missing = source()
    missing.$extensions[TOKEN_EXTENSION].modes[0] = 'dark'
    await expect(renderTokens(missing)).rejects.toThrow('Every palette mode')
    const dangling = source()
    dangling.aliases.gap.$value = '{spacing.missing}'
    await expect(renderTokens(dangling)).rejects.toThrow('Unknown token')
    const mismatch = source()
    mismatch.aliases.gap.$value = '{colour.text}'
    await expect(renderTokens(mismatch)).rejects.toThrow('Alias type mismatch')
    const cyclic = source()
    cyclic.aliases.gap.$value = '{aliases.gap}'
    await expect(renderTokens(cyclic)).rejects.toThrow('Cyclic token')
  })

  it('resolves aliases to each selected palette, rather than the default palette', () => {
    const { tokens } = parseTokens(source())
    for (const mode of ['light', 'dark', 'hc-light', 'hc-dark']) {
      expect(resolveToken(tokens, 'aliases.fg', mode)).toEqual(
        resolveToken(tokens, 'colour.text', mode),
      )
    }
  })

  it('keeps every generated CSS output unchanged through the real commit formatters', async () => {
    const outputs = await renderTokens(source())
    for (const [file, content] of Object.entries(outputs)) {
      if (!file.endsWith('.css')) continue
      const linted = await stylelint.lint({
        code: content,
        codeFilename: path.resolve(file),
        fix: true,
      })
      expect(linted.errored).toBe(false)
      const formatted = await prettier.format(linted.code, {
        ...(await prettier.resolveConfig(file)),
        filepath: file,
      })
      expect(formatted).toBe(content)
    }
  })

  it('loads generated variables through both surface stylesheets without runtime JavaScript', async () => {
    for (const file of ['src/webview/styles.css', 'src/webview/whatsNew/whatsNew.css']) {
      expect(readFileSync(file, 'utf8')).toMatch(/@import url\(['"](?:\.\.\/)?tokens\.css['"]\);/)
    }
    const outputs = await renderTokens(source())
    const generated = outputs['src/webview/tokens.css']
    const css = await transform(generated, { loader: 'css', minify: true })
    expect(Buffer.byteLength(css.code)).toBeLessThanOrEqual(4 * 1024)
  })
})
