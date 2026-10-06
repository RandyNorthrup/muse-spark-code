import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

/** Builds fresh source assets and their manifest; never depends on a stale dist. */
export async function buildPortableBundle(folder: string): Promise<void> {
  const directory = path.join(folder, 'webview', 'portable')
  const graph = await build({
    entryPoints: {
      main: path.resolve('src/webview/portable.tsx'),
      whatsNew: path.resolve('src/webview/whatsNew/portable.ts'),
      bridge: path.resolve('src/webview/bridges/select.ts'),
      fallbacks: path.resolve('src/webview/fallbacks/index.ts'),
    },
    outdir: directory,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    metafile: true,
    logLevel: 'silent',
    chunkNames: 'chunks/[name]-[hash]',
    jsx: 'automatic',
  })
  await build({
    entryPoints: [path.resolve('src/webview/bridges/moduleLoader.ts')],
    outfile: path.join(directory, 'loader.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    logLevel: 'silent',
  })
  const metadata = path.join(folder, 'portable.meta.json')
  writeFileSync(metadata, JSON.stringify(graph.metafile))
  const manifest = spawnSync(
    process.execPath,
    [path.resolve('scripts/lib/portableModules.mjs'), metadata, directory],
    { encoding: 'utf8' },
  )
  if (manifest.status !== 0) throw new Error(`Fake portable manifest failed: ${manifest.stderr}`)
}
