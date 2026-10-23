import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import { checkNativeBundleSize } from './check-bundle-size.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(import.meta.dirname, 'build/generated/pages')
await mkdir(output, { recursive: true })
const helper = path.join(output, 'renderer.mjs')
await esbuild.build({
  stdin: {
    contents: `export { EN } from './src/shared/l10n/en';
export { setUiText } from './src/shared/l10n/text';
export { TABLE_LOCALES } from './src/shared/l10n/locales';
export { buildWebviewHtml } from './src/host/html';
export { renderWhatsNewPage } from './src/host/whatsNew/whatsNewHtml';
export { parseWhatsNewContent } from './src/core/whatsNew/whatsNewContent';`,
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: helper,
})
// JCEF's public HTML loader does not need a native HTTP/resource-handler lane.
// What's New stays inline; chat/Tasks retain the portable module graph.
for (const entry of ['whatsNew']) {
  await esbuild.build({
    entryPoints: [path.join(root, `dist/webview/${entry}.js`)],
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(output, `${entry}.inline.js`),
  })
}
checkNativeBundleSize(output, path.join(root, 'dist/webview/portable'))
const renderer = await import(pathToFileURL(helper).href)
const content = renderer.parseWhatsNewContent(
  await readFile(path.join(root, 'dist/whatsNew.json'), 'utf8'),
)
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const base = '__MUSE_ASSET_BASE__'
for (const locale of ['en', ...renderer.TABLE_LOCALES]) {
  const table =
    locale === 'en'
      ? renderer.EN
      : JSON.parse(await readFile(path.join(root, `l10n/ui.${locale}.json`), 'utf8'))
  renderer.setUiText(table, locale)
  for (const kind of ['chat', 'tasks']) {
    const html = renderer.buildWebviewHtml({
      scriptUri: `${base}main.js`,
      styleUri: `${base}main.css`,
      cspSource: base,
      nonce: '__MUSE_NONCE__',
      l10n: { locale, table },
      ...(kind === 'tasks' && { surface: kind }),
    })
    await writeFile(path.join(output, `${kind}.${locale}.html`), html)
  }
  const notes = renderer.renderWhatsNewPage({
    releases: content.releases,
    from: undefined,
    current: manifest.version,
    isShownOnUpdate: true,
    cspSource: base,
    nonce: '__MUSE_NONCE__',
    scriptUri: `${base}whatsNew.js`,
    styleUri: `${base}whatsNew.css`,
    locale,
  })
  await writeFile(path.join(output, `whatsNew.${locale}.html`), notes.html)
  await writeFile(
    path.join(output, `notes.${locale}.json`),
    JSON.stringify({ links: notes.links, tries: notes.tries }),
  )
  await writeFile(path.join(output, `ui.${locale}.json`), JSON.stringify(table))
}
