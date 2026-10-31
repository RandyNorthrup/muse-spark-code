// @vitest-environment jsdom
// M104 lane C: the portable page server's boundaries. Ported from
// RLM104's portablePageSecurity and rebuilt on int's page server: the
// window's page carries hostile text, identifiers and manifests as inert
// data, and the graph loader refuses escapes, oversize graphs, unlisted
// scripts and surface kinds the window cannot show.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { panelEntryFor, portablePage } from '../../src/runtime/panel/portablePage'
import { MHP_PANEL } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { removeFolder } from './helpers/temporaryFolders'

// Whether this account may make a file symbolic link: Linux and macOS
// always, Windows only with the privilege (elevated or Developer Mode).
function canLinkFiles(): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), 'portable-link-probe-'))
  try {
    const target = path.join(probe, 'target')
    writeFileSync(target, '')
    symlinkSync(target, path.join(probe, 'link'))
    return true
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return false
    throw error
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}
const CAN_LINK_FILES = canLinkFiles()

const NONCE = '0'.repeat(64)
const TABLES = { locale: 'en', title: 'Companion window', uiTable: {}, usageTable: {} }
// The panel page's scripts: the import map, the four embedded documents
// (interface text, usage text, the binding, the manifest), the loader,
// and the entry marker the loader replaces.
const PANEL_SCRIPT_COUNT = 7

const rig: { root: string; outside: string } = { root: '', outside: '' }
beforeAll(async () => {
  rig.root = await realpath(await mkdtemp(path.join(tmpdir(), 'portable-page-security-')))
  rig.outside = await realpath(await mkdtemp(path.join(tmpdir(), 'portable-page-outside-')))
  await writeFile(path.join(rig.root, 'modules.json'), '{"modules":[]}')
  for (const file of [
    'loader.js',
    'main.css',
    'theme.css',
    'fallbacks.css',
    'whatsNew.css',
    'presentation.css',
  ])
    await writeFile(path.join(rig.root, file), '')
  await writeFile(path.join(rig.outside, 'modules.json'), '{"modules":[]}')
})
afterAll(async () => {
  await removeFolder(rig.root)
  await removeFolder(rig.outside)
})

async function renderDocument(sessionId = 'session'): Promise<Document> {
  const page = await portablePage(rig.root)
  return new DOMParser().parseFromString(
    page.render({ surface: 'surface-1', sessionId, surfaceKind: 'chat' }, NONCE, TABLES),
    'text/html',
  )
}

async function renderHtml(sessionId = 'session'): Promise<string> {
  const page = await portablePage(rig.root)
  return page.render({ surface: 'surface-1', sessionId, surfaceKind: 'chat' }, NONCE, TABLES)
}

describe('portable page security', () => {
  it.each([
    '&lt;img src=x&gt;',
    '<img src=x onerror="attacker()">',
    '</p><script>attacker()</script>',
  ])('keeps translated launch errors as literal text: %s', async (text) => {
    setUiText({ ...EN, companionLaunchFailed: text }, 'en')
    try {
      const document = await renderDocument()
      const alert = document.querySelector('#launch-error')
      expect(alert?.textContent).toBe(text)
      expect(alert?.children).toHaveLength(0)
      expect(document.querySelectorAll('script')).toHaveLength(PANEL_SCRIPT_COUNT)
    } finally {
      setUiText(EN, 'en')
    }
  })

  it.each([
    '&quot;',
    '" onload="attacker()',
    '<tag>',
    '</body><script>attacker()</script>',
    "'session",
    '&',
    '<script>attacker()</script>',
  ])('preserves the opaque session identifier without markup: %s', async (sessionId) => {
    const document = await renderDocument(sessionId)
    expect(JSON.parse(document.querySelector('#muse-panel')?.textContent ?? '')).toEqual({
      surface: 'surface-1',
      sessionId,
      surfaceKind: 'chat',
    })
    expect(document.querySelector('[onload]')).toBeNull()
    expect(document.querySelectorAll('script')).toHaveLength(PANEL_SCRIPT_COUNT)
  })

  it('rejects a nonce before either script is rendered', async () => {
    const page = await portablePage(rig.root)
    expect(() =>
      page.render(
        { surface: 'surface-1', sessionId: 'session', surfaceKind: 'chat' },
        "nonce' 'unsafe-inline",
        TABLES,
      ),
    ).toThrow('EPANEL_PAGE')
  })

  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
  ])('encodes the launch-text metacharacter %s once', async (text, encoded) => {
    setUiText({ ...EN, companionLaunchFailed: text }, 'en')
    try {
      expect(await renderHtml()).toContain(`hidden>${encoded}</p>`)
    } finally {
      setUiText(EN, 'en')
    }
  })

  it('embeds manifest import text as inert JSON, including closing tags and line separators', async () => {
    const file = path.join(rig.root, 'modules.json')
    const original = await readFile(file)
    const text = '</script><script>attacker()</script><!--\u{2028}\u{2029}'
    const manifest = {
      modules: [
        {
          path: '/assets/portable/loader.js',
          bytes: 0,
          sha256: '0'.repeat(64),
          imports: [
            { start: 0, end: 0, text, target: '/assets/portable/loader.js', dynamic: true },
          ],
        },
      ],
    }
    try {
      await writeFile(file, JSON.stringify(manifest))
      const document = await renderDocument()
      const data = document.querySelector('#muse-modules')?.textContent ?? ''
      // Only '<' can break out of the script element; the separators ride
      // the JSON string the loader parses.
      expect(data).not.toContain('<')
      expect(JSON.parse(data)).toEqual(manifest)
      expect(document.querySelectorAll('script')).toHaveLength(PANEL_SCRIPT_COUNT)
    } finally {
      await writeFile(file, original)
    }
  })

  it.skipIf(!CAN_LINK_FILES)('refuses a manifest reached through a link', async () => {
    const file = path.join(rig.root, 'modules.json')
    const stashed = path.join(rig.root, 'modules.stashed.json')
    await rename(file, stashed)
    try {
      symlinkSync(path.join(rig.outside, 'modules.json'), file)
      await expect(portablePage(rig.root)).rejects.toThrow('MHP_ASSET_PATH')
    } finally {
      await unlink(file)
      await rename(stashed, file)
    }
  })

  it('refuses a manifest that names a file outside the graph', async () => {
    const file = path.join(rig.root, 'modules.json')
    const original = await readFile(file)
    try {
      await writeFile(
        file,
        JSON.stringify({
          modules: [
            {
              path: '/assets/portable/../../outside.js',
              bytes: 0,
              sha256: '0'.repeat(64),
              imports: [],
            },
          ],
        }),
      )
      // The manifest schema refuses the escape before any file is read.
      let failure: unknown
      try {
        await portablePage(rig.root)
      } catch (error: unknown) {
        failure = error
      }
      if (!(failure instanceof Error) || failure.name !== '$ZodError')
        throw new Error('the graph escape was not refused by the manifest schema')
    } finally {
      await writeFile(file, original)
    }
  })

  it('refuses a graph larger than MHP’s queue bound', async () => {
    const file = path.join(rig.root, 'loader.js')
    try {
      await writeFile(file, 'x'.repeat(MHP_PANEL.maximumQueuedBytes + 1))
      await expect(portablePage(rig.root)).rejects.toThrow('MHP_ASSET_TOO_LARGE')
    } finally {
      await writeFile(file, '')
    }
  })

  it('refuses a script the manifest does not list', async () => {
    const file = path.join(rig.root, 'extra-chunk.js')
    try {
      await writeFile(file, '')
      await expect(portablePage(rig.root)).rejects.toThrow('MHP_ASSET_UNLISTED')
    } finally {
      await unlink(file)
    }
  })

  it('refuses a surface kind the window cannot show', async () => {
    const page = await portablePage(rig.root)
    expect(() =>
      page.render(
        { surface: 'surface-1', sessionId: 'session', surfaceKind: 'usage' },
        NONCE,
        TABLES,
      ),
    ).toThrow('MHP_SURFACE_KIND_UNSUPPORTED')
  })

  it.each([
    ['whatsNew', 'whatsNew.js', 'whatsNew.css'],
    ['chat', 'main.js', 'main.css'],
    ['tasks', 'main.js', 'main.css'],
    ['plans', 'presentation.js', 'presentation.css'],
    ['traffic', 'presentation.js', 'presentation.css'],
  ])('boots %s from its entry and styles', (kind, entry, sheet) => {
    const found = panelEntryFor(kind)
    expect(found?.entry.endsWith(entry)).toBe(true)
    expect(found?.stylesheets.some((style) => style.endsWith(sheet))).toBe(true)
    expect(found?.surfaceKind).toBe(kind)
  })

  it.each(['models', 'settings', 'usage', 'maker', 'no-such-kind'])(
    'refuses %s without guessing an entry',
    (kind) => {
      expect(panelEntryFor(kind)).toBeUndefined()
    },
  )
})
