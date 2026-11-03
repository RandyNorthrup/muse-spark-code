#!/usr/bin/env node
// Muse Desktop (M111, D91.12) lane WB: builds the Electron workbench app
// into dist/desktop/ — the main process, the preload and the renderer,
// beside the generated M114 token sheet. The production build runs this
// after the extension bundles; `npm run build:desktop` runs it alone.

import { cpSync, mkdirSync, rmSync } from 'node:fs'
import * as esbuild from 'esbuild'

const production = process.argv.includes('--production')
const outdir = 'dist/desktop'
rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

const shared = {
  bundle: true,
  logLevel: 'warning',
  minify: production,
  sourcemap: !production,
  target: 'es2024',
}

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ['desktop/app/main.ts'],
    outfile: `${outdir}/main.mjs`,
    format: 'esm',
    platform: 'node',
    // node-pty stays external (M111 D91.13 lane BP): its native
    // binding cannot bundle, so the packaged app carries the staged
    // module beside main.mjs (scripts/stage-desktop-pty.mjs), and a
    // dev run resolves the checkout's own copy.
    external: ['electron', 'node-pty'],
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['desktop/app/preload.ts'],
    outfile: `${outdir}/preload.cjs`,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
  }),
  esbuild.build({
    ...shared,
    // The terminal engine ships lazily (M111 D91.13 lane BP): code
    // splitting pulls the xterm chunk out of the startup path. Chunk
    // names stay hash-free so the size budgets name fixed files; the
    // desktop ships its folder whole, never through a cache.
    entryPoints: ['src/webview/desktop/main.tsx'],
    outdir,
    entryNames: 'renderer',
    chunkNames: 'renderer.[name]',
    splitting: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
  }),
  // M111 lane ST1: the settings app's renderer, beside the workbench's.
  esbuild.build({
    ...shared,
    entryPoints: ['src/webview/settings/main.tsx'],
    outfile: `${outdir}/settings.js`,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
  }),
])

cpSync('desktop/app/index.html', `${outdir}/index.html`)
cpSync('desktop/app/settings.html', `${outdir}/settings.html`)
cpSync('design/tokens/generated/muse.css', `${outdir}/muse.css`)
console.log(`desktop: built ${outdir} (${production ? 'production' : 'dev'})`)
