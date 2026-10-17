// Shared builder for the companion/native theme fixture page (M114 C).
// The Chromium suite (themeBridgeBrowser.test.mjs) serves this page; the
// browser-free guard (themeBridgeFixture.test.mjs) asserts its assembly.
// One source of truth so the two cannot drift apart.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { build } from 'esbuild'

const OUT_DIR = 'temp/m114-c-browser'

/** `__M114_THEME_NONCE__` is replaced with the page nonce at build time. */
export const THEME_FIXTURE_JS = `
import './src/webview/styles.css';
import {loadThemeBridge} from './src/webview/bridges/theme/loadThemeBridge';
let snapshot = {mode:'dark', roles:{}};
let receive;
const controller = new AbortController();
globalThis.theme = {
  change(value) { snapshot = value; receive(value); },
  stop() { controller.abort(); },
  invalid: 0, unsubscribed: 0,
};
const port = {current: () => snapshot, subscribe(fn) {
  receive = fn;
  return () => { globalThis.theme.unsubscribed++; };
}};
await loadThemeBridge(globalThis.document.querySelector('main'), port,
  () => { globalThis.theme.invalid++; }, controller.signal,
  { nonce: '__M114_THEME_NONCE__' });
globalThis.theme.ready = true;
`

/** Bundles the fixture and returns the served assets keyed by URL path. */
export async function buildThemeFixture() {
  const nonce = randomUUID().replaceAll('-', '')
  const result = await build({
    stdin: {
      contents: THEME_FIXTURE_JS.replaceAll('__M114_THEME_NONCE__', () => nonce),
      resolveDir: process.cwd(),
      sourcefile: 'fixture.js',
    },
    outdir: path.resolve(OUT_DIR),
    entryNames: 'fixture',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome128',
    minify: true,
    metafile: true,
    write: false,
  })
  const assets = new Map(
    result.outputFiles.map((file) => [
      `/${path.relative(path.resolve(OUT_DIR), file.path).replaceAll('\\', '/')}`,
      file.text,
    ]),
  )
  return { assets, meta: result.metafile, nonce }
}

/**
 * The served page. Every emitted stylesheet is linked — the lazy theme
 * sheets ride the dynamic-import chunk, which esbuild extracts to CSS files
 * nothing requests unless the page links them — and the policy admits only
 * the bridge's nonce for inline styles.
 */
export function themeFixtureHtml(assets, nonce) {
  const sheets = assets
    .keys()
    .filter((name) => name.endsWith('.css'))
    .toArray()
    .toSorted((a, b) => {
      if (a === '/fixture.css') return -1
      if (b === '/fixture.css') return 1
      return a < b ? -1 : 1
    })
  const links = sheets.map((name) => `<link rel="stylesheet" href="${name}">`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; font-src 'none'">
<title>Theme fixture</title>${links}</head><body>
<main><section class="composer"><label for="draft">Prompt</label><textarea id="draft" class="composer-input"></textarea>
<button class="button-primary">Send</button><button class="button-secondary" disabled>Disabled</button>
<button class="send-button-stop">Stop</button>
<pre><code>code</code></pre></section></main><aside>Sibling</aside>
<script type="module" src="/fixture.js"></script></body></html>`
}
