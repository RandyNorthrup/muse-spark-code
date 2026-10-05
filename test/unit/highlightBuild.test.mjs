import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { sharedHighlightGrammar } from '../../scripts/lib/highlightGrammar.mjs'
import { highlight, resolveLanguage } from '../../src/webview/highlight'

it('compiled shared grammars preserve the original HTML and aliases', async () => {
  const result = await build({
    entryPoints: ['src/webview/highlight.ts'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    minify: true,
    charset: 'utf8',
    write: false,
    plugins: [sharedHighlightGrammar],
  })
  const compiled = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
  const samples = [
    'interface Widget<T> { readonly value?: T; }',
    '@decorator class Widget { public value: string = "text"; }',
    'namespace App { export const value = { x: 1 } satisfies Record<string, number>; }',
    'const render = (x) => `<b>${x}</b>`; // punctuation: café — “quoted”',
    '/** @param {string} x */ function render(x) { return /x+/u.test(x); }',
    'const element = <Widget value="text" />;',
  ]
  for (const language of ['javascript', 'js', 'typescript', 'ts', 'tsx', 'mts', 'cts']) {
    expect(compiled.resolveLanguage(language)).toBe(resolveLanguage(language))
    for (const sample of samples)
      expect(compiled.highlight(sample, language)).toBe(highlight(sample, language))
  }
})

it('refuses a vendor grammar whose embedded JavaScript differs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'm96-highlight-'))
  const folder = path.join(root, 'highlight.js', 'es', 'languages')
  try {
    await mkdir(folder, { recursive: true })
    const entry = path.join(folder, 'typescript.js')
    await writeFile(entry, 'function javascript(x) { return x; }\nexport default javascript;')
    await writeFile(
      path.join(folder, 'javascript.js'),
      'function javascript(x) { return null; }\nexport default javascript;',
    )
    await expect(
      build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        plugins: [sharedHighlightGrammar],
        logLevel: 'silent',
      }),
    ).rejects.toThrow('grammar implementations differ')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
