import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { webviewStartupOutputs } from '../../scripts/lib/webviewBundles.mjs'

const baselineBytes = 898_682
const rig = {}
const options = {
  bundle: true,
  minify: true,
  write: false,
  metafile: true,
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: 'chrome128',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
}

beforeAll(async () => {
  rig.chat = await build({
    ...options,
    entryPoints: { main: 'src/webview/main.tsx' },
    outdir: 'dist/webview',
    chunkNames: 'chunks/[name]-[hash]',
  })
  rig.whatsNew = await build({
    ...options,
    format: 'iife',
    splitting: false,
    entryPoints: ['src/webview/whatsNew/main.ts'],
    outfile: 'dist/webview/whatsNew.js',
  })
})

it('keeps every portable bridge and fallback out of the entire VS Code graph', () => {
  for (const result of [rig.chat, rig.whatsNew]) {
    expect(
      Object.keys(result.metafile.inputs).filter(
        (source) =>
          source.startsWith('src/webview/bridges/') || source.startsWith('src/webview/fallbacks/'),
      ),
    ).toEqual([])
  }
})

it('keeps eager VS Code chat JavaScript at or below the pre-lane baseline', () => {
  const eager = webviewStartupOutputs(rig.chat.metafile)
  expect(
    eager.reduce((sum, file) => sum + rig.chat.metafile.outputs[file].bytes, 0),
  ).toBeLessThanOrEqual(baselineBytes)
})

it('keeps Tasks lazy and every existing deferred byte under the unchanged cap', () => {
  const eager = new Set(webviewStartupOutputs(rig.chat.metafile))
  const deferred = Object.entries(rig.chat.metafile.outputs).filter(
    ([file]) => file.endsWith('.js') && !eager.has(file),
  )
  expect(
    deferred.some(([, output]) => Object.hasOwn(output.inputs, 'src/webview/TasksApp.tsx')),
  ).toBe(true)
  expect(deferred.reduce((sum, [, output]) => sum + output.bytes, 0)).toBeLessThanOrEqual(51_200)
})
