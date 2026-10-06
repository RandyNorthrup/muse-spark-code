import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { buildPageHtml } from '../../host/ui/pageHtml'
import { portableManifestSchema } from '../../shared/hostApi/portableAssets'
import type { MhpPanelBinding } from '../../shared/hostApi/panel'
import type { MhpParams } from '../../shared/hostApi/methods'
import type { CompanionAsset } from '../companion/server'
import { MHP_PANEL, UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'

/** A packaged manifest supplies exact URL paths; requests never become disk paths. */
export async function portablePage(directory: string, theme: MhpParams<'initialize'>['theme']) {
  const root = await realpath(directory)
  const manifestPath = path.join(root, 'modules.json')
  if ((await realpath(manifestPath)) !== manifestPath) throw new Error('MHP_ASSET_PATH')
  const manifestInfo = await stat(manifestPath)
  if (manifestInfo.size > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
  const manifest = portableManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  const assets = new Map<string, CompanionAsset>()
  const files = [
    ...new Set([
      ...manifest.modules.map((module) => module.path.slice('/assets/portable/'.length)),
      'loader.js',
      'main.css',
      'whatsNew.css',
    ]),
  ]
  let bytes = 0
  for (const file of files) {
    const canonical = await realpath(path.join(root, file))
    if (canonical !== path.join(root, file)) throw new Error('MHP_ASSET_PATH')
    const info = await stat(canonical)
    if (bytes + info.size > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
    const content = await readFile(canonical)
    bytes += content.byteLength
    if (bytes > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
    assets.set(`/assets/portable/${file}`, {
      content,
      contentType: file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8',
    })
  }
  // Every emitted module is accounted for by the build; no guessed chunks.
  const emitted = await readdir(root, { recursive: true })
  if (emitted.some((file) => file.endsWith('.js') && !files.includes(file)))
    throw new Error('MHP_ASSET_UNLISTED')
  return {
    assets,
    render(binding: MhpPanelBinding, nonce: string): string {
      const html = buildPageHtml({
        bridge: 'companion',
        binding,
        theme,
        nonce,
        assetOrigin: "'self'",
        scriptUri: '/assets/portable/main.js',
        styleUri: '/assets/portable/main.css',
        l10n: { locale: uiLocale(), table: UI_TEXT },
      })
      const manifestData = JSON.stringify(manifest).replaceAll('<', String.raw`\u003c`)
      return html
        .replace(
          '</head>',
          () => `<script type="application/json" id="muse-modules">${manifestData}</script></head>`,
        )
        .replace(
          '</body>',
          () =>
            `<p id="launch-error" role="alert" tabindex="-1" hidden>${UI_TEXT.companionLaunchFailed.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p><script nonce="${nonce}" src="/assets/portable/loader.js"></script></body>`,
        )
        .replace(
          '<body ',
          () =>
            `<body data-session-id="${binding.sessionId.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" `,
        )
    },
  }
}
