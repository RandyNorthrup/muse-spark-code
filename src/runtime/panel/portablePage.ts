import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { buildPageHtml } from '../../host/ui/pageHtml'
import { scriptSafeJson } from '../../host/html'
import { escapeHtml } from '../../host/whatsNew/whatsNewHtml'
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
      ...(manifest.modules.some((module) => module.path === '/assets/portable/presentation.js')
        ? ['presentation.css']
        : []),
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
  function render(
    binding: MhpPanelBinding,
    nonce: string,
    bridge: 'native' | 'companion' = 'companion',
  ): string {
    let entry = 'main'
    if (binding.surfaceKind === 'whatsNew') entry = 'whatsNew'
    else if (
      ['plans', 'manager', 'roles', 'traffic', 'diff', 'walkthrough'].includes(binding.surfaceKind)
    )
      entry = 'presentation'
    const html = buildPageHtml({
      bridge,
      binding,
      theme,
      nonce,
      assetOrigin: "'self'",
      scriptUri: `/assets/portable/${entry}.js`,
      styleUri: `/assets/portable/${entry}.css`,
      l10n: { locale: uiLocale(), table: UI_TEXT },
    })
    const manifestData = scriptSafeJson(manifest)
    return html
      .replace(
        '</head>',
        () => `<script type="application/json" id="muse-modules">${manifestData}</script></head>`,
      )
      .replace(
        '</body>',
        () =>
          `<p id="launch-error" role="alert" tabindex="-1" hidden>${escapeHtml(UI_TEXT.companionLaunchFailed)}</p><script nonce="${escapeHtml(nonce)}" src="/assets/portable/loader.js"></script></body>`,
      )
      .replace('<body ', () => `<body data-session-id="${escapeHtml(binding.sessionId)}" `)
  }
  return {
    assets,
    render,
    decorate(
      binding: MhpPanelBinding,
      html: string,
      nonce: string,
      bridge: 'native' | 'companion',
    ): string {
      if (binding.surfaceKind !== 'whatsNew') throw new Error('MHP_PRESENTATION_KIND_CHANGED')
      const body =
        /<body>\s*([\s\S]*?)<script nonce="[^"<>]+" src="[^"<>]+"><\/script>\s*<\/body>/u.exec(
          html,
        )?.[1]
      if (body === undefined) throw new Error('MHP_PRESENTATION_HTML_INVALID')
      return render(binding, nonce, bridge).replace('<div id="root"></div>', () => body)
    },
  }
}
