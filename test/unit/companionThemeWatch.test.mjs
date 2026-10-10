// M114 C-M114-1 R2: the static theme sheets stay watched (finding 4).
//
// Drives the companion-theme-css plugin directly: the usage entry's load
// must carry every static theme source as a watch file (otherwise `npm run
// watch` never rebuilds theme.css after a theme-only edit), claim no other
// file, and write the sheets beside the entries on success only.
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMPANION_THEME_CSS_ENTRY,
  COMPANION_THEME_CSS_FILE,
  COMPANION_THEME_CSS_SOURCES,
  companionThemeCss,
  companionThemeCssPlugin,
} from '../../scripts/lib/webviewBundles.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const folders = []
afterEach(async () => {
  for (const root of folders.splice(0)) await removeFolder(root)
})

function setup(outdir) {
  const hooks = {}
  companionThemeCssPlugin.setup({
    initialOptions: { outdir },
    onLoad(_options, callback) {
      hooks.load = callback
    },
    onEnd(callback) {
      hooks.end = callback
    },
  })
  return hooks
}

describe('companion theme watch registration', () => {
  it('carries the static theme sources on the usage entry load', async () => {
    const hooks = setup('outdir-unused')
    const entry = path.resolve(COMPANION_THEME_CSS_ENTRY)
    const result = await hooks.load({ path: entry })
    expect(result.loader).toBe('tsx')
    expect(result.contents).toBe(await readFile(entry, 'utf8'))
    expect(result.resolveDir).toBe(path.dirname(entry))
    expect(result.watchFiles).toEqual([...COMPANION_THEME_CSS_SOURCES])
  })
  it('claims no other file, on either path separator', () => {
    const hooks = setup('outdir-unused')
    expect(hooks.load({ path: path.resolve('src/webview/main.tsx') })).toBeNull()
    expect(hooks.load({ path: String.raw`C:\work\usage.tsx` })).toBeNull()
  })
  it('writes the static sheets beside the entries, never on failure', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'c-m114-1-theme-watch-'))
    folders.push(root)
    const hooks = setup(root)
    await hooks.end({ errors: [] })
    expect(await readFile(path.join(root, COMPANION_THEME_CSS_FILE), 'utf8')).toBe(
      companionThemeCss(),
    )
    const failed = await mkdtemp(path.join(tmpdir(), 'c-m114-1-theme-watch-'))
    folders.push(failed)
    const failing = setup(failed)
    await failing.end({ errors: [{ text: 'boom' }] })
    await expect(readdir(failed)).resolves.toEqual([])
  })
})
