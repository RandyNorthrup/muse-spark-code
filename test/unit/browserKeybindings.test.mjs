import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  browserKeyboardSource,
  lazyBrowserKeybindings,
} from '../../scripts/lib/browserKeybindings.mjs'
import { removeFolder } from './helpers/temporaryFolders'

const runtime = { canonical: undefined, subsets: undefined }
const moduleOf = async (options) => {
  const result = await build({
    ...options,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    minify: true,
  })
  return await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )
}

beforeAll(async () => {
  runtime.canonical = await moduleOf({ entryPoints: ['src/shared/keybindings.ts'] })
  const contexts = Object.keys(runtime.canonical.WEBVIEW_KEYBINDINGS)
  const imports = contexts.map(
    (context, index) => `import * as k${index} from 'subset:${context}';`,
  )
  const exports = contexts.map((context, index) => `${JSON.stringify(context)}:k${index}`)
  const built = await moduleOf({
    stdin: {
      contents: `${imports.join('\n')}\nexport const subsets={${exports.join(',')}}`,
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    plugins: [
      {
        name: 'keyboard-subsets',
        setup(builder) {
          builder.onResolve({ filter: /^subset:/ }, (args) => ({
            path: args.path.slice('subset:'.length),
            namespace: 'keyboard-subsets',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'keyboard-subsets' }, (args) => ({
            contents: browserKeyboardSource(new Set([args.path])),
            loader: 'ts',
          }))
        },
      },
      lazyBrowserKeybindings,
    ],
  })
  runtime.subsets = built.subsets
  // Compile the canonical matcher and all specialized modules once, outside assertions.
})

describe('browser keyboard dispatch with optional contexts deferred', () => {
  it('keeps a standalone entry limited to its own canonical contexts', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'browser-keyboard-entry-'))
    const entry = path.join(root, 'src/webview/keys.ts')
    mkdirSync(path.dirname(entry), { recursive: true })
    const table = path.resolve('src/shared/keybindings').replaceAll('\\', '/')
    writeFileSync(
      entry,
      `import { WEBVIEW_KEYBINDINGS, webviewKey } from ${JSON.stringify(table)};
export { WEBVIEW_KEYBINDINGS };
export const dispatch = (event) => webviewKey('composer.send', event);`,
    )
    try {
      const module = await moduleOf({ entryPoints: [entry], plugins: [lazyBrowserKeybindings] })
      expect(Object.keys(module.WEBVIEW_KEYBINDINGS)).toEqual(['composer.send'])
      expect(module.WEBVIEW_KEYBINDINGS['composer.send']).toEqual(
        runtime.canonical.WEBVIEW_KEYBINDINGS['composer.send'],
      )
    } finally {
      await removeFolder(root)
    }
  })

  it('loads the real lazy history row with its directly read archive gesture', async () => {
    const row = await moduleOf({
      entryPoints: ['src/webview/components/HistoryPromptRow.tsx'],
      plugins: [lazyBrowserKeybindings],
    })
    expect(row.HistoryPromptRow).toBeTypeOf('function')
  })

  it('refuses a dynamic direct context before emitting a partial keyboard table', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'browser-keyboard-'))
    const entry = path.join(root, 'src/webview/keys.ts')
    mkdirSync(path.dirname(entry), { recursive: true })
    const table = path.resolve('src/shared/keybindings').replaceAll('\\', '/')
    writeFileSync(
      entry,
      `import { WEBVIEW_KEYBINDINGS } from ${JSON.stringify(table)};\nconst context = 'dialog';\nexport const keys = WEBVIEW_KEYBINDINGS[context];\n`,
    )
    try {
      await expect(
        moduleOf({ entryPoints: [entry], plugins: [lazyBrowserKeybindings] }),
      ).rejects.toThrow('Nonliteral browser keyboard context')
    } finally {
      await removeFolder(root)
    }
  })

  it('preserves every canonical gesture, modifier, phase and send setting', () => {
    const { WEBVIEW_KEYBINDINGS, webviewKey } = runtime.canonical
    for (const [context, actions] of Object.entries(WEBVIEW_KEYBINDINGS)) {
      const subset = runtime.subsets[context]
      expect(Object.keys(subset.WEBVIEW_KEYBINDINGS), context).toEqual([context])
      const keys = [
        ...new Set(
          Object.values(actions).flatMap((action) => action.keys.map((gesture) => gesture.key)),
        ),
      ]
      for (const key of [...keys, 'a', 'A', 'é', '😀', 'Unmapped']) {
        for (let modifiers = 0; modifiers < 16; modifiers++) {
          const event = {
            key,
            shiftKey: (modifiers & 1) !== 0,
            altKey: (modifiers & 2) !== 0,
            ctrlKey: (modifiers & 4) !== 0,
            metaKey: (modifiers & 8) !== 0,
          }
          for (const phase of ['down', 'up']) {
            for (const settings of [
              undefined,
              { useCtrlEnterToSend: false },
              { useCtrlEnterToSend: true },
            ]) {
              expect(subset.webviewKey(context, event, phase, settings), `${context}: ${key}`).toBe(
                webviewKey(context, event, phase, settings),
              )
            }
          }
        }
      }
    }
  })

  it('fails before emitting an unknown keyboard context', () => {
    expect(() => browserKeyboardSource(new Set(['unknown.context']))).toThrow(
      'Unknown browser keyboard context',
    )
  })
})
