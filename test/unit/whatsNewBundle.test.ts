// What's New's own bundle (M99, PLAN.md D6, D79): src/host/whatsNew/
// whatsNewEntry.ts built as scripts/build.mjs builds it (`vscode` external,
// the shared English fallback beside it), then required by `whatsNewLoader`
// as the window's first page or notice requires dist/whatsNew.js, and run
// against a stand-in `vscode` module: the page it renders carries its CSP
// and the handed table, and a Try it runs only what the extension contributes.

import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WhatsNewContent } from '../../src/core/whatsNew/whatsNewContent'
import { whatsNewLoader } from '../../src/host/whatsNew/whatsNew'
import { UI_TEXT, WHATS_NEW_BUNDLE_FILE } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { lazyLoaderCases } from './helpers/lazyBundles'
import { sharedUiText } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'
import { Uri } from './mocks/vscode'

const built = { folder: '', file: '' }

// What the bundle asks of `vscode`, recording the panel, links and commands.
const FAKE_VSCODE = `
const record = { panels: [], opened: [], commands: [] }
const uri = (p) => ({ path: p, toString: () => p })
module.exports = {
  record,
  Uri: { joinPath: (base, ...parts) => uri([base.path, ...parts].join('/')), parse: (value) => uri(value) },
  ViewColumn: { Active: -1 },
  window: {
    createWebviewPanel: (viewType, title, show, options) => {
      const listeners = []
      const panel = {
        viewType, title, show, options,
        webview: {
          html: '',
          cspSource: 'vscode-webview://fake',
          asWebviewUri: (local) => uri('webview:' + local.path),
          onDidReceiveMessage: (listener) => { listeners.push(listener); return { dispose() {} } },
        },
        reveal() {},
        onDidDispose: () => ({ dispose() {} }),
        dispose() {},
        fire: (message) => { for (const listener of listeners) listener(message) },
      }
      record.panels.push(panel)
      return panel
    },
  },
  env: { openExternal: async (target) => { record.opened.push(target.path); return true } },
  commands: { executeCommand: async (...args) => { record.commands.push(args) } },
}
`

const CONTENT: WhatsNewContent = {
  schema: 1,
  releases: [
    {
      version: '0.13.0',
      date: '2026-10-05',
      highlights: [
        {
          c: [{ t: 'p', c: [{ t: 'text', v: 'Shipped highlight.' }] }],
          tries: [{ kind: 'command', id: 'museSpark.showWhatsNew' }],
        },
      ],
      sections: [],
    },
  ],
}

beforeAll(async () => {
  built.folder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-whats-new-bundle-')))
  built.file = path.join(built.folder, WHATS_NEW_BUNDLE_FILE)
  const fakeVscode = path.join(built.folder, 'node_modules', 'vscode')
  mkdirSync(fakeVscode, { recursive: true })
  writeFileSync(path.join(fakeVscode, 'index.js'), FAKE_VSCODE)
  writeFileSync(path.join(built.folder, 'whatsNew.json'), JSON.stringify(CONTENT))
  const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node20.18' } as const
  await build({
    ...shared,
    entryPoints: [path.resolve('src/shared/l10n/en.ts')],
    outfile: path.join(built.folder, 'uiText.js'),
    logLevel: 'silent',
  })
  await build({
    ...shared,
    entryPoints: [path.resolve('src/host/whatsNew/whatsNewEntry.ts')],
    outfile: built.file,
    external: ['vscode'],
    plugins: [sharedUiText],
    logLevel: 'silent',
  })
})
afterAll(() => removeFolder(built.folder))

interface FakeRecord {
  readonly panels: { webview: { html: string }; fire: (message: unknown) => void }[]
  readonly opened: string[]
  readonly commands: unknown[][]
}

function isFakeRecord(value: unknown): value is FakeRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'panels' in value &&
    Array.isArray(value.panels) &&
    'commands' in value &&
    Array.isArray(value.commands)
  )
}

/** The stand-in module's record: the instance the bundle required. */
function fakeRecord(): FakeRecord {
  const loaded: unknown = createRequire(built.file)('vscode')
  const record =
    typeof loaded === 'object' && loaded !== null && 'record' in loaded ? loaded.record : undefined
  if (!isFakeRecord(record)) {
    throw new TypeError('the stand-in vscode module did not load')
  }
  return record
}

describe('whatsNewLoader', () => {
  lazyLoaderCases(whatsNewLoader, built, () => UI_TEXT.whatsNewUnavailable)
})

describe('the shipped What’s New bundle', () => {
  it('requires the English table beside it and carries none of its own words', () => {
    const bundled = readFileSync(built.file, 'utf8')
    const table = readFileSync(path.join(built.folder, 'uiText.js'), 'utf8')
    expect(bundled).toMatch(/require\("\.\/uiText\.js"\)/)
    for (const words of [UI_TEXT.whatsNewTitle, UI_TEXT.whatsNewUnavailable]) {
      expect(table).toContain(words)
      expect(bundled).not.toContain(words)
    }
  })

  it('renders the page in the handed table, and runs only a contributed Try it', async () => {
    const bundle = whatsNewLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })()
    const setShownOnUpdate = vi.fn(() => Promise.resolve())
    const pages = bundle.createWhatsNewPages(
      {
        extensionUri: Uri.file('/ext'),
        contentPath: path.join(built.folder, 'whatsNew.json'),
        current: '0.13.0',
        isShownOnUpdate: () => true,
        setShownOnUpdate,
        log: new FakeLogOutputChannel(),
      },
      { ...UI_TEXT, whatsNewTitle: 'Marker title.' },
      'en',
    )
    pages.open(undefined, false)
    const record = fakeRecord()
    const html = record.panels.at(-1)?.webview.html ?? ''
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain('<h1 id="whats-new-title">Marker title.</h1>')
    expect(html).toContain('Shipped highlight.')
    expect(html).toContain('src="webview:/ext/dist/webview/whatsNew.js"')
    record.panels.at(-1)?.fire({ type: 'tryIt', index: 0 })
    record.panels.at(-1)?.fire({ type: 'tryIt', index: 5 })
    record.panels.at(-1)?.fire({ type: 'hideOnUpdate', isHidden: true })
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
    expect(record.commands).toEqual([['museSpark.showWhatsNew']])
    expect(setShownOnUpdate).toHaveBeenCalledExactlyOnceWith(false)
  })
})
