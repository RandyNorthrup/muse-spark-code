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

it.each([
  {
    name: 'different embedded JavaScript',
    typescript: 'function javascript(x) { return x; }',
    javascript: 'function javascript(x) { return null; }',
    failure: 'grammar implementations differ',
  },
  {
    name: 'missing embedded JavaScript',
    typescript: 'function changed(x) { return x; }',
    javascript: 'function javascript(x) { return x; }',
    failure: 'expected one JavaScript grammar',
  },
  {
    name: 'duplicate embedded JavaScript',
    typescript: 'function javascript(x) { return x; }\nfunction javascript(x) { return x; }',
    javascript: 'function javascript(x) { return x; }',
    failure: 'expected one JavaScript grammar',
  },
  {
    name: 'missing standalone JavaScript',
    typescript: 'function javascript(x) { return x; }',
    javascript: 'function changed(x) { return x; }',
    failure: 'expected one JavaScript grammar',
  },
])('refuses a vendor grammar with $name', async ({ typescript, javascript, failure }) => {
  const root = await mkdtemp(path.join(tmpdir(), 'm96-highlight-'))
  const folder = path.join(root, 'highlight.js', 'es', 'languages')
  try {
    await mkdir(folder, { recursive: true })
    const entry = path.join(folder, 'typescript.js')
    await writeFile(entry, `${typescript}\nexport default javascript;`)
    await writeFile(path.join(folder, 'javascript.js'), `${javascript}\nexport default javascript;`)
    await expect(
      build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        plugins: [sharedHighlightGrammar],
        logLevel: 'silent',
      }),
    ).rejects.toThrow(failure)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
