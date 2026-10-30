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
    external: ['electron'],
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
    entryPoints: ['src/webview/desktop/main.tsx'],
    outfile: `${outdir}/renderer.js`,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
  }),
])

cpSync('desktop/app/index.html', `${outdir}/index.html`)
cpSync('design/tokens/generated/muse.css', `${outdir}/muse.css`)
console.log(`desktop: built ${outdir} (${production ? 'production' : 'dev'})`)
