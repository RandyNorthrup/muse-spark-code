#!/usr/bin/env node
// Bundles the extension host entry, the search worker, the webview, and (in
// dev mode) the integration tests with esbuild.
//
//   node scripts/build.mjs               dev build + integration test bundles
//   node scripts/build.mjs --watch       rebuild on change (extension + webview)
//   node scripts/build.mjs --production  minified, no sourcemaps, no test bundles
//
// The extension host bundle is CommonJS because VS Code loads `main` with
// require(). `vscode` is provided by the host and must stay external.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'

const args = new Set(process.argv.slice(2))
const isProduction = args.has('--production')
const isWatch = args.has('--watch')

const HOST_ENTRY = 'src/extension.ts'
const HOST_OUTFILE = 'dist/extension.js'
const SEARCH_WORKER_ENTRY = 'src/host/backend/searchWorker.ts'
const SEARCH_WORKER_OUTFILE = 'dist/searchWorker.js'
const WEBVIEW_ENTRY = 'src/webview/main.tsx'
const WEBVIEW_OUTDIR = 'dist/webview'
const INTEGRATION_TEST_DIR = 'test/integration'
const INTEGRATION_TEST_OUTDIR = 'dist/test/integration'
const NODE_TARGET = 'node22'
const BROWSER_TARGET = 'chrome128'
const BYTES_PER_KIB = 1024

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction && 'linked',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
}

/** @type {import('esbuild').BuildOptions} */
const hostOptions = {
  ...common,
  entryPoints: [HOST_ENTRY],
  outfile: HOST_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: NODE_TARGET,
  external: ['vscode'],
}

/** @type {import('esbuild').BuildOptions} */
const searchWorkerOptions = {
  ...common,
  entryPoints: [SEARCH_WORKER_ENTRY],
  outfile: SEARCH_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  ...common,
  entryPoints: [WEBVIEW_ENTRY],
  outdir: WEBVIEW_OUTDIR,
  platform: 'browser',
  format: 'iife',
  target: BROWSER_TARGET,
  jsx: 'automatic',
}

function listIntegrationTests() {
  return readdirSync(INTEGRATION_TEST_DIR, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => path.join(INTEGRATION_TEST_DIR, name))
}

/** @type {import('esbuild').BuildOptions} */
const integrationTestOptions = {
  ...common,
  entryPoints: listIntegrationTests(),
  outdir: INTEGRATION_TEST_OUTDIR,
  platform: 'node',
  format: 'cjs',
  target: NODE_TARGET,
  external: ['vscode', 'mocha'],
}

function reportSize(path) {
  const kib = (statSync(path).size / BYTES_PER_KIB).toFixed(1)
  console.log(`  ${path}  ${kib} KiB`)
}

if (isWatch) {
  const contexts = await Promise.all([
    esbuild.context(hostOptions),
    esbuild.context(searchWorkerOptions),
    esbuild.context(webviewOptions),
  ])
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching for changes…')
} else {
  const builds = [
    esbuild.build(hostOptions),
    esbuild.build(searchWorkerOptions),
    esbuild.build(webviewOptions),
  ]
  if (!isProduction) {
    builds.push(esbuild.build(integrationTestOptions))
  }
  await Promise.all(builds)
  console.log('bundle sizes:')
  reportSize(HOST_OUTFILE)
  reportSize(SEARCH_WORKER_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.css'))
}
