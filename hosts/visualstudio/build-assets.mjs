import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import * as esbuild from 'esbuild'

const plugin = fileURLToPath(new URL('.', import.meta.url))
const root = path.resolve(plugin, '../..')
const assets = path.join(plugin, 'assets')
const origin = 'https://muse-panel.invalid'
const { outputFiles } = await esbuild.build({
  stdin: {
    contents:
      "export { EN } from './src/shared/l10n/en'; export { TABLE_LOCALES } from './src/shared/l10n/locales'; export { buildWebviewHtml, createNonce } from './src/host/html'",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
})
const { EN, TABLE_LOCALES, buildWebviewHtml, createNonce } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)

await mkdir(path.join(assets, 'l10n'), { recursive: true })
await mkdir(path.join(assets, 'runtime'), { recursive: true })
await cp(path.join(root, 'dist/webview'), path.join(assets, 'webview'), { recursive: true })
const englishManifest = JSON.parse(await readFile(path.join(root, 'package.nls.json'), 'utf8'))
for (const locale of ['en', ...TABLE_LOCALES]) {
  const table =
    locale === 'en'
      ? EN
      : JSON.parse(await readFile(path.join(root, 'l10n', `ui.${locale}.json`), 'utf8'))
  const manifest =
    locale === 'en'
      ? englishManifest
      : JSON.parse(await readFile(path.join(root, `package.nls.${locale}.json`), 'utf8'))
  await writeFile(path.join(assets, 'l10n', `ui.${locale}.json`), JSON.stringify(table))
  await writeFile(path.join(assets, 'l10n', `package.nls.${locale}.json`), JSON.stringify(manifest))
  const html = buildWebviewHtml({
    scriptUri: `${origin}/webview/portable/main.js`,
    styleUri: `${origin}/webview/portable/main.css`,
    cspSource: origin,
    nonce: createNonce(),
    l10n: { locale, table },
  })
    .replace('<html lang=', '<html data-theme="dark" lang=')
    .replace('<body>', '<body data-host="embedded">')
    .replace(
      "default-src 'none'",
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'",
    )
  await writeFile(path.join(assets, 'webview', `index.${locale}.html`), html)
  await writeFile(
    path.join(assets, 'webview', `tasks.${locale}.html`),
    html.replace('<body data-host="embedded">', '<body data-host="embedded" data-surface="tasks">'),
  )
}
await cp(
  path.join(root, 'src/shared/hostApi/mhp-v1.1.schema.json'),
  path.join(assets, 'mhp-v1.1.schema.json'),
)
await cp(path.join(root, 'LICENSE'), path.join(assets, 'LICENSE'))
await cp(path.join(root, 'THIRD_PARTY_NOTICES.txt'), path.join(assets, 'THIRD_PARTY_NOTICES.txt'))
const nativeNotices = [
  ['microsoft.web.webview2/1.0.4258.31', 'LICENSE.txt', 'NOTICE.txt'],
  ['newtonsoft.json/13.0.3', 'LICENSE.md'],
  ['system.text.encodings.web/9.0.0', 'LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT'],
  ['microsoft.visualstudio.extensibility.editor.contracts/17.14.249', 'LICENSE', 'NOTICE'],
  ['microsoft.visualstudio.linux.connectionmanager.store/17.14.40254', 'LICENSE.txt'],
]
for (const [packageVersion, ...files] of nativeNotices) {
  const directory = path.join(assets, 'licenses', packageVersion)
  await mkdir(directory, { recursive: true })
  for (const file of files)
    await cp(
      path.join(root, 'temp/visualstudio-packages', packageVersion, file),
      path.join(directory, file),
    )
}

// Reuse the existing, tested suspended-start Windows job helper without changing it.
const compiler = path.join(
  process.env.SystemRoot ?? 'C:/Windows',
  'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
)
const helperSource = path.join(root, 'temp', 'visualstudio-job.cs')
await mkdir(path.dirname(helperSource), { recursive: true })
await writeFile(
  helperSource,
  (await readFile(path.join(root, 'native/windows/MuseSparkMcpLauncher.cs'), 'utf8')) +
    '\n' +
    (await readFile(path.join(root, 'native/windows/MuseSparkMcpJob.cs'), 'utf8')),
)
execFileSync(
  compiler,
  [
    '/nologo',
    '/target:exe',
    '/optimize+',
    `/out:${path.join(assets, 'runtime', 'muse-panel-job.exe')}`,
    '/reference:System.Runtime.Serialization.dll',
    helperSource,
  ],
  { stdio: 'inherit' },
)
const webviewFiles = await readdir(path.join(assets, 'webview'))
const pages = webviewFiles.filter((file) => file.startsWith('index.')).length
console.log(
  `Visual Studio assets: ${pages} localized pages, shared React bundle, frozen MHP schema and Windows job helper.`,
)
