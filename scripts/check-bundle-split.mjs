#!/usr/bin/env node
// The bundle-split gate (M57, PLAN.md D6), part of `npm run build`. The
// Model API backend is a bundle of its own, dist/modelApi.js, which the
// activation bundle (dist/extension.js) requires the first time that backend
// starts. The production build's metafiles (dist/meta/) name every source
// file in each bundle; this fails when:
//
// - a file of src/core/backends/modelapi/ is on neither list below, or on
//   both, or a listed file no longer exists (a new file needs a decision);
// - a LAZY_ONLY file, or the bundle's entry, is in dist/extension.js;
// - a LAZY_ONLY file is missing from dist/modelApi.js (the entry stopped
//   carrying the backend).
//
// Exits 1 on any problem.
//
//   node scripts/check-bundle-split.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const MODEL_API_DIR = 'src/core/backends/modelapi'
const ENTRY = 'src/host/backend/modelApiEntry.ts'
const BUNDLES = {
  activation: { output: 'dist/extension.js', metafile: 'dist/meta/extension.json' },
  modelApi: { output: 'dist/modelApi.js', metafile: 'dist/meta/modelApi.json' },
}

// The backend's files the activation bundle may carry, each with its reason.
const ACTIVATION_ALLOWED = new Map([
  ['client.ts', 'the key client that makes images for Muse Code (M44)'],
  ['schemas.ts', "the key client's request and response shapes"],
  ['sse.ts', "the key client's stream parser"],
  ['imageGeneration.ts', "the IDE server's image tools on Muse Code (M44)"],
  ['imageToolDefinitions.ts', "the IDE server's image tools on Muse Code (M44)"],
  ['sessionStore.ts', "the stored-session format the window's session store reads (D14)"],
  ['goalRecord.ts', "a stored session's goal (D14, M45)"],
  ['schedules.ts', "the schedule store's next occurrence (M52)"],
])

// The files that load only with the backend: the host, its tools, hooks,
// goals, subagents, memory tools, permission engine and MCP client.
const LAZY_ONLY = [
  'ModelApiHost.ts',
  'glob.ts',
  'goals.ts',
  'hooks.ts',
  'instructions.ts',
  'mediaBudget.ts',
  'memoryTools.ts',
  'modelCallHooks.ts',
  'permissions.ts',
  'promptCache.ts',
  'sessionBudget.ts',
  'subagentTools.ts',
  'toolHookPayload.ts',
  'tools.ts',
  'mcp/connection.ts',
  'mcp/functions.ts',
  'mcp/http.ts',
  'mcp/pool.ts',
  'mcp/protocol.ts',
  'mcp/servers.ts',
  'mcp/stdio.ts',
]

/** The bundle's source files and the bytes each contributed, from its metafile. */
function inputsOf({ output, metafile }) {
  if (!existsSync(metafile)) {
    throw new Error(`${metafile} is missing: run "node scripts/build.mjs --production" first`)
  }
  const parsed = JSON.parse(readFileSync(metafile, 'utf8'))
  const bundle = parsed.outputs[output]
  if (bundle === undefined) {
    throw new Error(`${metafile} does not describe ${output}`)
  }
  return new Map(
    Object.entries(bundle.inputs).map(([input, { bytesInOutput }]) => [input, bytesInOutput]),
  )
}

/** Every TypeScript file under the backend's folder, relative to it, forward slashes. */
function backendFiles() {
  return readdirSync(MODEL_API_DIR, { recursive: true })
    .map((name) => String(name).split(path.sep).join('/'))
    .filter((name) => name.endsWith('.ts'))
}

const problems = []
const onDisk = new Set(backendFiles())
const lazy = new Set(LAZY_ONLY)
for (const name of onDisk) {
  const lists = Number(ACTIVATION_ALLOWED.has(name)) + Number(lazy.has(name))
  if (lists !== 1) {
    problems.push(
      `${MODEL_API_DIR}/${name} is on ${lists === 0 ? 'neither list' : 'both lists'} in scripts/check-bundle-split.mjs`,
    )
  }
}
for (const name of [...ACTIVATION_ALLOWED.keys(), ...lazy]) {
  if (!onDisk.has(name)) {
    problems.push(`${MODEL_API_DIR}/${name} is listed but does not exist`)
  }
}

const activation = inputsOf(BUNDLES.activation)
const modelApi = inputsOf(BUNDLES.modelApi)
for (const name of lazy) {
  const file = `${MODEL_API_DIR}/${name}`
  if (activation.has(file)) {
    problems.push(`${BUNDLES.activation.output} carries ${file}, which loads only with the backend`)
  }
  if (!modelApi.has(file)) {
    problems.push(`${BUNDLES.modelApi.output} no longer carries ${file}`)
  }
}
if (activation.has(ENTRY)) {
  problems.push(`${BUNDLES.activation.output} carries the Model API bundle's entry, ${ENTRY}`)
}

if (problems.length > 0) {
  console.error(`bundle split: ${String(problems.length)} problem(s); see PLAN.md D6 and M57`)
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  process.exit(1)
}
const BYTES_PER_KIB = 1024
const carried = [...activation]
  .filter(([input]) => input.startsWith(`${MODEL_API_DIR}/`))
  .toSorted(([a], [b]) => a.localeCompare(b, 'en'))
const carriedKiB = carried.reduce((sum, [, bytes]) => sum + bytes, 0) / BYTES_PER_KIB
console.log(
  `ok   ${BUNDLES.activation.output}: ${String(carried.length)} of the backend's ${String(onDisk.size)} files (${carriedKiB.toFixed(1)} KiB), all on the allowed list`,
)
for (const [input, bytes] of carried) {
  const name = input.slice(MODEL_API_DIR.length + 1)
  console.log(
    `       ${name} ${(bytes / BYTES_PER_KIB).toFixed(1)} KiB: ${ACTIVATION_ALLOWED.get(name) ?? ''}`,
  )
}
console.log(
  `ok   ${BUNDLES.modelApi.output}: carries the ${String(lazy.size)} files that load only with the backend`,
)
