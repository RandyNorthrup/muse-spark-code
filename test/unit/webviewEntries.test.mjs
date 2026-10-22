import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import {
  webviewDeferredBudgetGroups,
  webviewStartupOutputs,
} from '../../scripts/lib/webviewBundles.mjs'

const baselineBytes = 898_682
const rig = {}
const options = {
  bundle: true,
  minify: true,
  charset: 'utf8',
  plugins: [compactBrowserEnglish],
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
    chunkNames: 'chunks/[hash]',
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
  // The question UI's cap is check-bundle-size.mjs's QUESTION_UI_BUDGET_KIB.
  const groups = webviewDeferredBudgetGroups(rig.chat.metafile, 25)
  // 0.17 adds its own measured groups beside these; none of these caps moves.
  expect(groups.map(({ name, budgetKiB }) => [name, budgetKiB])).toEqual(
    expect.arrayContaining([
      ['deferred JS', 50],
      ['code highlighting', 125],
      ['action dialogs', 25],
      ['tasks tab', 25],
    ]),
  )
  for (const { outputs, budgetKiB } of groups)
    expect(
      outputs.reduce((sum, file) => sum + rig.chat.metafile.outputs[file].bytes, 0),
    ).toBeLessThanOrEqual(budgetKiB * 1024)
})
