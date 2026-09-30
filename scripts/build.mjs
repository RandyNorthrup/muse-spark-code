#!/usr/bin/env node
// Bundles the extension host entry, the Model API backend, the search worker,
// web fetch's page converter worker (M69: parse5 and the HTML converter,
// loaded on a worker thread started for each page, never at activation), the
// webview, and (in dev mode) the integration tests with esbuild.
//
//   node scripts/build.mjs               dev build + integration test bundles
//   node scripts/build.mjs --watch       rebuild on change (extension + webview)
//   node scripts/build.mjs --production  minified, no sourcemaps, no test bundles
//
// The extension host bundle is CommonJS because VS Code loads `main` with
// require(). `vscode` is provided by the host and must stay external.
//
// The Model API backend is a second host bundle, dist/modelApi.js (M57,
// PLAN.md D6), with the same format, platform and target: the activation
// bundle requires it the first time that backend starts. Nothing it bundles
// may import `vscode` (src/core must not), so `vscode` is not external there
// and a stray import fails this build.
//
// A production build also writes each shipped bundle's esbuild metafile to
// dist/meta/ (M26, PLAN.md D29): the list of every source file that went in,
// from which scripts/third-party-notices.mjs derives the packages whose
// licences travel with the .vsix. The folder is not packaged.
//
// The ACP agent (`dist/acp.js`, PLAN.md D62) is built beside them for its own
// npm package, not the .vsix; its metafile goes to dist/meta-acp/ so the
// extension's notices never list what only the agent ships. Its keyring
// binding is a native module, installed with the package, never bundled. The
// agent loads the Model API backend from dist/modelApi.js, as the extension
// does, and its package ships that file (scripts/package-acp.mjs), so the
// backend is built once for both.

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'

const args = new Set(process.argv.slice(2))
const isProduction = args.has('--production')
const isWatch = args.has('--watch')

const HOST_ENTRY = 'src/extension.ts'
const HOST_OUTFILE = 'dist/extension.js'
const MODEL_API_ENTRY = 'src/host/backend/modelApiEntry.ts'
const MODEL_API_OUTFILE = 'dist/modelApi.js'
const PLAN_MARKDOWN_ENTRY = 'src/host/planMarkdownEntry.ts'
const PLAN_MARKDOWN_OUTFILE = 'dist/planMarkdown.js'
const SEARCH_WORKER_ENTRY = 'src/host/backend/searchWorker.ts'
const SEARCH_WORKER_OUTFILE = 'dist/searchWorker.js'
const PAGE_WORKER_ENTRY = 'src/host/web/pageWorker.ts'
const PAGE_WORKER_OUTFILE = 'dist/pageWorker.js'
const WEBVIEW_ENTRY = 'src/webview/main.tsx'
const WEBVIEW_OUTDIR = 'dist/webview'
const ACP_ENTRY = 'src/runtime/main.ts'
const ACP_OUTFILE = 'dist/acp.js'
const ACP_METAFILE_DIR = 'dist/meta-acp'
const INTEGRATION_TEST_DIR = 'test/integration'
const INTEGRATION_TEST_OUTDIR = 'dist/test/integration'
// The extension host of the oldest VS Code the manifest accepts: 1.99 runs
// Node 20.18 (PLAN.md M62). The ACP agent runs on the user's own Node 22.
const HOST_NODE_TARGET = 'node20.18'
const AGENT_NODE_TARGET = 'node22'
const BROWSER_TARGET = 'chrome128'
const BYTES_PER_KIB = 1024
const METAFILE_DIR = 'dist/meta'

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: isProduction,
  sourcemap: !isProduction && 'linked',
  metafile: isProduction,
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
  target: HOST_NODE_TARGET,
  external: ['vscode'],
}

/** @type {import('esbuild').BuildOptions} */
const modelApiOptions = {
  ...common,
  entryPoints: [MODEL_API_ENTRY],
  outfile: MODEL_API_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const planMarkdownOptions = {
  ...common,
  entryPoints: [PLAN_MARKDOWN_ENTRY],
  outfile: PLAN_MARKDOWN_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const searchWorkerOptions = {
  ...common,
  entryPoints: [SEARCH_WORKER_ENTRY],
  outfile: SEARCH_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const acpOptions = {
  ...common,
  entryPoints: [ACP_ENTRY],
  outfile: ACP_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
  external: ['@napi-rs/keyring'],
  banner: { js: '#!/usr/bin/env node' },
}

/** @type {import('esbuild').BuildOptions} */
const pageWorkerOptions = {
  ...common,
  entryPoints: [PAGE_WORKER_ENTRY],
  outfile: PAGE_WORKER_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
  target: HOST_NODE_TARGET,
  external: ['vscode', 'mocha'],
}

function reportSize(path) {
  const kib = (statSync(path).size / BYTES_PER_KIB).toFixed(1)
  console.log(`  ${path}  ${kib} KiB`)
}

if (isWatch) {
  const contexts = await Promise.all([
    esbuild.context(hostOptions),
    esbuild.context(modelApiOptions),
    esbuild.context(planMarkdownOptions),
    esbuild.context(searchWorkerOptions),
    esbuild.context(pageWorkerOptions),
    esbuild.context(webviewOptions),
  ])
  await Promise.all(contexts.map((ctx) => ctx.watch()))
  console.log('watching for changes…')
} else {
  const shipped = {
    extension: esbuild.build(hostOptions),
    modelApi: esbuild.build(modelApiOptions),
    planMarkdown: esbuild.build(planMarkdownOptions),
    searchWorker: esbuild.build(searchWorkerOptions),
    pageWorker: esbuild.build(pageWorkerOptions),
    webview: esbuild.build(webviewOptions),
  }
  const acp = esbuild.build(acpOptions)
  const builds = [...Object.values(shipped), acp]
  if (!isProduction) {
    builds.push(esbuild.build(integrationTestOptions))
  }
  await Promise.all(builds)
  if (isProduction) {
    mkdirSync(METAFILE_DIR, { recursive: true })
    for (const [name, build] of Object.entries(shipped)) {
      const { metafile } = await build
      writeFileSync(path.join(METAFILE_DIR, `${name}.json`), JSON.stringify(metafile))
    }
    mkdirSync(ACP_METAFILE_DIR, { recursive: true })
    const { metafile } = await acp
    writeFileSync(path.join(ACP_METAFILE_DIR, 'acp.json'), JSON.stringify(metafile))
  }
  console.log('bundle sizes:')
  reportSize(HOST_OUTFILE)
  reportSize(MODEL_API_OUTFILE)
  reportSize(PLAN_MARKDOWN_OUTFILE)
  reportSize(SEARCH_WORKER_OUTFILE)
  reportSize(PAGE_WORKER_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.css'))
  reportSize(ACP_OUTFILE)
}
