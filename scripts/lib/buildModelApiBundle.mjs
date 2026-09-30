#!/usr/bin/env node
// The Model API backend and web fetch's page worker as the production build
// makes them (M57, M69; PLAN.md D6), unminified, into a folder the caller
// owns, for tests that load them the way the extension does, with Node's own
// `require`. The table handoff is part of what they prove, so the backend
// takes the same esbuild plugin as dist/modelApi.js: it carries no English
// table (scripts/lib/injectedTable.mjs). The page worker, which is handed no
// table, does not. The plugin needs esbuild's asynchronous API, so the
// synchronous test helper runs this script.
//
//   node scripts/lib/buildModelApiBundle.mjs <folder>

import path from 'node:path'
import * as esbuild from 'esbuild'
import { injectedTable } from './injectedTable.mjs'

const [folder, ...rest] = process.argv.slice(2)
if (folder === undefined || rest.length > 0) {
  console.error('usage: node scripts/lib/buildModelApiBundle.mjs <folder>')
  process.exit(2)
}

const MODEL_API_ENTRY = 'src/host/backend/modelApiEntry.ts'
const PAGE_WORKER_ENTRY = 'src/host/web/pageWorker.ts'
// The extension host of the floor, VS Code 1.99 (scripts/build.mjs, PLAN.md M62).
const HOST_NODE_TARGET = 'node20.18'

/** @type {import('esbuild').BuildOptions} */
const common = {
  outdir: folder,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
  logLevel: 'error',
}

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: { modelApi: path.resolve(MODEL_API_ENTRY) },
    plugins: [injectedTable()],
  }),
  esbuild.build({
    ...common,
    entryPoints: { pageWorker: path.resolve(PAGE_WORKER_ENTRY) },
  }),
])
