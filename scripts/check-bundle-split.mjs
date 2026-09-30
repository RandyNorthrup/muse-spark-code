#!/usr/bin/env node
// The bundle-split gate (M57, PLAN.md D6), part of `npm run build`. The
// Model API backend is a bundle of its own, dist/modelApi.js, which the
// activation bundle (dist/extension.js) requires the first time that backend
// starts, and which the ACP agent (dist/acp.js, D62) loads the same way from
// its own package. The production build's metafiles (dist/meta/,
// dist/meta-acp/) name every source file in each bundle; this fails when:
//
// - a file of src/core/backends/modelapi/ is on neither list below, or on
//   both, or a listed file no longer exists (a new file needs a decision);
// - a LAZY_ONLY file, or the bundle's entry, is in dist/extension.js or in
//   dist/acp.js (a second build of the backend);
// - a LAZY_ONLY file is missing from dist/modelApi.js (the entry stopped
//   carrying the backend);
// - dist/extension.js carries the plan reader (M79) or any of its Markdown
//   parser, or dist/planMarkdown.js no longer carries the reader.
// - web fetch's page converter (M69: parse5, the HTML converter and what
//   they use) is in dist/extension.js or dist/modelApi.js, or missing from
//   its worker, dist/pageWorker.js, started for each page.
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
  acp: { output: 'dist/acp.js', metafile: 'dist/meta-acp/acp.json' },
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
  // M67: the code intelligence tools' Model API side (reads and the rename's write).
  'codeIntelCalls.ts',
  'glob.ts',
  'goals.ts',
  'hooks.ts',
  'instructions.ts',
  'mediaBudget.ts',
  'memoryTools.ts',
  'modelCallHooks.ts',
  'permissions.ts',
  'promptCache.ts',
  'subagentTools.ts',
  'toolHookPayload.ts',
  'tools.ts',
  // The verify loop's session side and its tool surface (M68).
  'verifyLedger.ts',
  'verifyLoop.ts',
  'verifyTools.ts',
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
const acp = inputsOf(BUNDLES.acp)
// The bundles that load the backend from dist/modelApi.js rather than carry it.
const loaders = [
  [BUNDLES.activation.output, activation],
  [BUNDLES.acp.output, acp],
]
for (const name of lazy) {
  const file = `${MODEL_API_DIR}/${name}`
  for (const [output, inputs] of loaders) {
    if (inputs.has(file)) {
      problems.push(`${output} carries ${file}, which loads only with the backend`)
    }
  }
  if (!modelApi.has(file)) {
    problems.push(`${BUNDLES.modelApi.output} no longer carries ${file}`)
  }
}
for (const [output, inputs] of loaders) {
  if (inputs.has(ENTRY)) {
    problems.push(`${output} carries the Model API bundle's entry, ${ENTRY}`)
  }
}

// The plan reader (M79): the panel's Markdown parser, which dist/extension.js
// requires as dist/planMarkdown.js on the first plan action. The activation
// bundle carries neither its module, nor its entry, nor any of the parser's
// packages; the reader's bundle carries the module.
const PLAN_READER = {
  output: 'dist/planMarkdown.js',
  metafile: 'dist/meta/planMarkdown.json',
  entry: 'src/host/planMarkdownEntry.ts',
  module: 'src/core/plans/planMarkdown.ts',
}
const PARSER_PACKAGES = [
  'node_modules/micromark',
  'node_modules/mdast-util-',
  'node_modules/character-entities',
  'node_modules/decode-named-character-reference',
]
const planReader = inputsOf(PLAN_READER)
for (const file of [PLAN_READER.entry, PLAN_READER.module]) {
  if (activation.has(file)) {
    problems.push(
      `${BUNDLES.activation.output} carries ${file}, which loads only on the first plan action`,
    )
  }
}
const parserFiles = activation
  .keys()
  .filter((input) => PARSER_PACKAGES.some((prefix) => input.startsWith(prefix)))
  .toArray()
if (parserFiles.length > 0) {
  problems.push(
    `${BUNDLES.activation.output} carries the plan reader's Markdown parser (${String(parserFiles.length)} files, ${parserFiles[0]} first)`,
  )
}
if (!planReader.has(PLAN_READER.module)) {
  problems.push(`${PLAN_READER.output} no longer carries ${PLAN_READER.module}`)
}

const PAGE_WORKER = { output: 'dist/pageWorker.js', metafile: 'dist/meta/pageWorker.json' }
// What loads only on the page converter's worker, by path prefix.
const CONVERTER_ONLY = [
  'node_modules/parse5/',
  'node_modules/entities/',
  'node_modules/html-encoding-sniffer/',
  'node_modules/@exodus/bytes/',
  'src/core/web/htmlToMarkdown.ts',
  'src/core/web/htmlCharset.ts',
  'src/host/web/pageWorker.ts',
]
const pageWorker = inputsOf(PAGE_WORKER)
function hasPrefix(inputs, prefix) {
  for (const input of inputs.keys()) {
    if (input.startsWith(prefix)) {
      return true
    }
  }
  return false
}
for (const prefix of CONVERTER_ONLY) {
  for (const bundle of [BUNDLES.activation, BUNDLES.modelApi]) {
    if (hasPrefix(inputsOf(bundle), prefix)) {
      problems.push(
        `${bundle.output} carries ${prefix}, which loads only on the page converter's worker`,
      )
    }
  }
  if (!hasPrefix(pageWorker, prefix)) {
    problems.push(`${PAGE_WORKER.output} no longer carries ${prefix}`)
  }
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
const acpCarried = acp
  .keys()
  .filter((input) => input.startsWith(`${MODEL_API_DIR}/`))
  .toArray()
console.log(
  `ok   ${BUNDLES.acp.output}: ${String(acpCarried.length)} of the backend's files, all on the allowed list`,
)
console.log(
  `ok   ${BUNDLES.modelApi.output}: carries the ${String(lazy.size)} files that load only with the backend`,
)
console.log(
  `ok   ${PLAN_READER.output}: carries the plan reader; ${BUNDLES.activation.output} carries none of its parser`,
)
console.log(
  `ok   ${PAGE_WORKER.output}: the page converter (parse5 and its parts) loads only there, never at activation`,
)
