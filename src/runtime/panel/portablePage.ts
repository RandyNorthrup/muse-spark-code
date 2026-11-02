// M104 lane C: the portable panel's page server. It reads the built
// portable graph once (the loader's manifest plus the stylesheets the
// entries boot from), serves each file at its exact packaged URL, and
// renders the window's page for its binding. Requests never become disk
// paths: every served URL comes from the manifest or the fixed entry
// list, every file is read through its canonical path, and the whole
// graph stays under MHP's queue bound.
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { MHP_PANEL } from '../../shared/constants'
import { panelSurfaceKindSchema, type MhpPanelBinding } from '../../shared/hostApi/panel'
import { portableManifestSchema } from '../../shared/hostApi/portableAssets'
import { renderCompanionPage } from '../companion/page'
import type { CompanionAsset } from '../companion/server'

const ASSET_PREFIX = '/assets/portable/'

/** The stylesheets the entries boot from; the loader fetches only scripts. */
const ENTRY_STYLES: Readonly<Record<string, readonly string[]>> = {
  main: ['main.css', 'theme.css', 'fallbacks.css'],
  whatsNew: ['whatsNew.css'],
  presentation: ['presentation.css'],
}

const PRESENTATION_KINDS: ReadonlySet<string> = new Set([
  'plans',
  'manager',
  'roles',
  'traffic',
  'diff',
  'walkthrough',
])

/**
The boot files for a surface kind, or undefined when the window cannot
show it. Any string is admitted; unknown kinds are refused, never guessed.
*/
export function panelEntryFor(surfaceKind: string):
  | {
      readonly entry: string
      readonly stylesheets: readonly string[]
      readonly surfaceKind: MhpPanelBinding['surfaceKind']
    }
  | undefined {
  let entry: string | undefined
  if (surfaceKind === 'whatsNew') entry = 'whatsNew'
  else if (surfaceKind === 'chat' || surfaceKind === 'tasks') entry = 'main'
  else if (PRESENTATION_KINDS.has(surfaceKind)) entry = 'presentation'
  if (entry === undefined) return undefined
  const styles = ENTRY_STYLES[entry]
  const narrowed = panelSurfaceKindSchema.safeParse(surfaceKind)
  if (styles === undefined || !narrowed.success) return undefined
  return {
    entry: `${ASSET_PREFIX}${entry}.js`,
    stylesheets: styles.map((sheet) => `${ASSET_PREFIX}${sheet}`),
    surfaceKind: narrowed.data,
  }
}

export interface PortablePageTables {
  readonly locale: string
  readonly title: string
  readonly uiTable: unknown
  readonly usageTable: unknown
}

export interface PortablePage {
  readonly assets: ReadonlyMap<string, CompanionAsset>
  render(binding: MhpPanelBinding, nonce: string, tables: PortablePageTables): string
}

/** Serves the portable graph at `directory` (the built `dist/webview/portable`). */
export async function portablePage(directory: string): Promise<PortablePage> {
  const root = await realpath(directory)
  const manifestPath = path.join(root, 'modules.json')
  if ((await realpath(manifestPath)) !== manifestPath) throw new Error('MHP_ASSET_PATH')
  const manifestInfo = await stat(manifestPath)
  if (manifestInfo.size > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
  const manifest = portableManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  const files = [
    ...new Set([
      ...manifest.modules.map((module) => module.path.slice(ASSET_PREFIX.length)),
      'loader.js',
      ...Object.values(ENTRY_STYLES).flat(),
    ]),
  ]
  const assets = new Map<string, CompanionAsset>()
  let bytes = 0
  for (const file of files) {
    const canonical = await realpath(path.join(root, file))
    if (canonical !== path.join(root, file)) throw new Error('MHP_ASSET_PATH')
    const info = await stat(canonical)
    if (bytes + info.size > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
    const content = await readFile(canonical)
    bytes += content.byteLength
    if (bytes > MHP_PANEL.maximumQueuedBytes) throw new Error('MHP_ASSET_TOO_LARGE')
    assets.set(`${ASSET_PREFIX}${file}`, {
      content,
      contentType: file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/javascript; charset=utf-8',
    })
  }
  // Every emitted module is accounted for by the build; no guessed chunks.
  // The recursive listing uses the platform's separators; the manifest uses '/' (Windows).
  const emitted = await readdir(root, { recursive: true })
  const listed = new Set(files)
  if (emitted.some((file) => file.endsWith('.js') && !listed.has(file.replaceAll('\\', '/'))))
    throw new Error('MHP_ASSET_UNLISTED')
  return {
    assets,
    render(binding, nonce, tables) {
      const entry = panelEntryFor(binding.surfaceKind)
      if (entry === undefined) throw new Error('MHP_SURFACE_KIND_UNSUPPORTED')
      return renderCompanionPage(nonce, {
        locale: tables.locale,
        title: tables.title,
        stylesheets: entry.stylesheets,
        modules: [`${ASSET_PREFIX}loader.js`],
        imports: {},
        uiTable: tables.uiTable,
        usageTable: tables.usageTable,
        panel: {
          binding: {
            surface: binding.surface,
            sessionId: binding.sessionId,
            surfaceKind: binding.surfaceKind,
          },
          manifest,
          entry: entry.entry,
          surface: binding.surfaceKind,
        },
      })
    },
  }
}
