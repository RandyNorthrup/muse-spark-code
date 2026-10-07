import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  browserKeyboardSource,
  lazyBrowserKeybindings,
} from '../../scripts/lib/browserKeybindings.mjs'

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
