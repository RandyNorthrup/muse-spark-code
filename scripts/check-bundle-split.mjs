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
// - the import from other agents (M83: the scan, the converters, the file
//   access, the flow and smol-toml) is in dist/extension.js, dist/modelApi.js
//   or dist/acp.js, or missing from dist/agentImport.js.
// - code intelligence's `ide` answers (M67: the queries, the read tools, the
//   repo map and the rename), voice's drivers (M9, M35: the dictation
//   driver, Muse Voice's stream, the processes and the socket) or the Auto
//   reviewer on Muse Code (M90: its side session, with M78's reviewer core)
//   are in dist/extension.js, or missing from dist/codeIntel.js,
//   dist/voice.js or dist/museCodeReviewer.js.
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
const DEFERRED_ONLY = ['reviewerEntry.ts']
const DEFERRED = [
  {
    output: 'dist/sessionBoard.js',
    metafile: 'dist/meta/sessionBoard.json',
    files: [
      'src/host/sessionBoardEntry.ts',
      'src/host/sessionBoard.ts',
      'src/host/bestOfN/bestOfNManager.ts',
      'src/core/bestOfN/bestOfNRunner.ts',
      'src/core/bestOfN/worktreeConversationHost.ts',
      'src/core/bestOfN/bestOfN.ts',
    ],
  },
  {
    output: 'dist/reviewer.js',
    metafile: 'dist/meta/reviewer.json',
    files: DEFERRED_ONLY.map((name) => `${MODEL_API_DIR}/${name}`),
  },
]

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
  // M78: command policy and the paid, read-only Auto reviewer load with the backend.
  'autoReviewer.ts',
  'commandRules.ts',
  'globLimits.ts',
  'permissionPolicy.ts',
  'shellSyntax.ts',
  // M67: the code intelligence tools' Model API side (reads and the rename's write).
  'codeIntelCalls.ts',
  'glob.ts',
  'goals.ts',
  'hooks.ts',
  'instructions.ts',
  'mediaBudget.ts',
  'memoryTools.ts',
  'modelCallHooks.ts',
  // M73: observation packing's store, its placeholder and recall_output.
  'observationPack.ts',
  'permissions.ts',
  'promptCache.ts',
  'sessionBudget.ts',
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
  const lists =
    Number(ACTIVATION_ALLOWED.has(name)) +
    Number(lazy.has(name)) +
    Number(DEFERRED_ONLY.includes(name))
  if (lists !== 1) {
    problems.push(
      `${MODEL_API_DIR}/${name} is on ${lists === 0 ? 'neither list' : 'both lists'} in scripts/check-bundle-split.mjs`,
    )
  }
}
for (const name of [...ACTIVATION_ALLOWED.keys(), ...lazy, ...DEFERRED_ONLY]) {
  if (!onDisk.has(name)) {
    problems.push(`${MODEL_API_DIR}/${name} is listed but does not exist`)
  }
}

const activation = inputsOf(BUNDLES.activation)
const modelApi = inputsOf(BUNDLES.modelApi)
const acp = inputsOf(BUNDLES.acp)
for (const bundle of DEFERRED) {
  const inputs = inputsOf(bundle)
  for (const file of bundle.files) {
    for (const parent of [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]) {
      if (inputsOf(parent).has(file)) {
        problems.push(`${parent.output} carries ${file}, which loads only on its first action`)
      }
    }
    if (!inputs.has(file)) problems.push(`${bundle.output} no longer carries ${file}`)
  }
}
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
// M72: the store and legacy reader live in their synchronous factory bundle.
// Only types, the activity port and the neutral turn key stay at activation.
const CHECKPOINT_STORE = {
  output: 'dist/checkpointStore.js',
  metafile: 'dist/meta/checkpointStore.json',
}
const CHECKPOINT_ONLY = [
  'src/host/checkpoints/checkpointStoreEntry.ts',
  'src/host/checkpoints/checkpointStore.ts',
  'src/host/checkpoints/legacyCheckpoints.ts',
  'src/host/checkpoints/checkpointArchives.ts',
  'src/host/checkpoints/checkpointFiles.ts',
  'src/host/checkpoints/checkpointRecords.ts',
  'src/host/checkpoints/checkpointRetention.ts',
  'src/host/checkpoints/recordRefs.ts',
  'src/host/checkpoints/shadowGit.ts',
  'src/core/checkpoints/gitListings.ts',
  // M86: the engine that decides a restore runs only in the store.
  'src/core/checkpoints/restoreChain.ts',
  // M86: the window's recording (its journal and the turns' recorder) is made
  // by the store's bundle at activation; the activation bundle has its types only.
  'src/host/checkpoints/writeJournal.ts',
  'src/host/checkpoints/writeRecorder.ts',
]
const checkpointStore = inputsOf(CHECKPOINT_STORE)
// The English fallback is shared; installed-language state stays in each bundle.
const UI_TEXT = { output: 'dist/uiText.js', metafile: 'dist/meta/uiText.json' }
const ENGLISH_TABLE = 'src/shared/l10n/en.ts'
const AGENT_IMPORT = { output: 'dist/agentImport.js', metafile: 'dist/meta/agentImport.json' }
// Split out of activation on 2026-10-03 (D6): each loads on its first use.
// The Model API backend keeps its own copy of code intelligence.
const ON_FIRST_USE = [
  {
    output: 'dist/codeIntel.js',
    metafile: 'dist/meta/codeIntel.json',
    use: 'the first code intelligence call',
    files: [
      'src/host/ide/codeIntelEntry.ts',
      'src/core/codeIntel/codeIntelQuery.ts',
      'src/core/codeIntel/codeIntelTools.ts',
      'src/core/codeIntel/codeText.ts',
      'src/core/codeIntel/rename.ts',
      'src/core/codeIntel/repoMap.ts',
    ],
  },
  {
    output: 'dist/voice.js',
    metafile: 'dist/meta/voice.json',
    use: 'the first recording',
    files: [
      'src/host/voice/voiceEntry.ts',
      'src/host/voice/voiceProcesses.ts',
      'src/core/voice/dictation.ts',
      'src/core/voice/museVoice.ts',
      'src/core/voice/recorderHelper.ts',
    ],
  },
  {
    output: 'dist/museCodeReviewer.js',
    metafile: 'dist/meta/museCodeReviewer.json',
    use: 'the first review',
    files: [
      'src/host/review/museCodeReviewerEntry.ts',
      'src/host/review/museCodeReviewer.ts',
      'src/core/backends/modelapi/autoReviewer.ts',
    ],
  },
]
const uiText = inputsOf(UI_TEXT)
if (!uiText.has(ENGLISH_TABLE)) {
  problems.push(`${UI_TEXT.output} no longer carries ${ENGLISH_TABLE}`)
}
for (const bundle of [
  BUNDLES.activation,
  BUNDLES.modelApi,
  BUNDLES.acp,
  CHECKPOINT_STORE,
  ...DEFERRED,
  AGENT_IMPORT,
  ...ON_FIRST_USE,
]) {
  const inputs = inputsOf(bundle)
  if (inputs.has(ENGLISH_TABLE)) {
    problems.push(`${bundle.output} duplicates ${ENGLISH_TABLE}`)
  }
  const { outputs } = JSON.parse(readFileSync(bundle.metafile, 'utf8'))
  if (
    outputs[bundle.output].imports.every((entry) => entry.path !== './uiText.js' || !entry.external)
  ) {
    problems.push(`${bundle.output} no longer loads the shared English table`)
  }
}
for (const file of CHECKPOINT_ONLY) {
  for (const [output, inputs] of [...loaders, [BUNDLES.modelApi.output, modelApi]]) {
    if (inputs.has(file)) {
      problems.push(`${output} carries ${file}, which belongs to the checkpoint store bundle`)
    }
  }
  if (!checkpointStore.has(file)) {
    problems.push(`${CHECKPOINT_STORE.output} no longer carries ${file}`)
  }
}
// M83: the import from other agents loads on the first import.
const IMPORT_ONLY = [
  'src/host/agentImportEntry.ts',
  'src/host/commands/agentImportCommands.ts',
  'src/host/importIo.ts',
  'src/core/import/agentImport.ts',
  'src/core/import/importConvert.ts',
  'node_modules/smol-toml/',
]
const agentImport = inputsOf(AGENT_IMPORT)
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

for (const prefix of IMPORT_ONLY) {
  for (const bundle of [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]) {
    if (hasPrefix(inputsOf(bundle), prefix)) {
      problems.push(`${bundle.output} carries ${prefix}, which loads only with the import`)
    }
  }
  if (!hasPrefix(agentImport, prefix)) {
    problems.push(`${AGENT_IMPORT.output} no longer carries ${prefix}`)
  }
}

for (const bundle of ON_FIRST_USE) {
  const inputs = inputsOf(bundle)
  for (const file of bundle.files) {
    if (activation.has(file)) {
      problems.push(
        `${BUNDLES.activation.output} carries ${file}, which loads only on ${bundle.use}`,
      )
    }
    if (!inputs.has(file)) {
      problems.push(`${bundle.output} no longer carries ${file}`)
    }
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
  `ok   ${BUNDLES.modelApi.output}: carries the ${String(lazy.size)} files that load only with the backend, and no English table`,
)
console.log(
  `ok   ${PLAN_READER.output}: carries the plan reader; ${BUNDLES.activation.output} carries none of its parser`,
)
console.log(
  `ok   ${PAGE_WORKER.output}: the page converter (parse5 and its parts) loads only there, never at activation`,
)
console.log(
  `ok   ${CHECKPOINT_STORE.output}: carries the checkpoint implementation; activation keeps the port and synchronous loader`,
)
console.log(
  `ok   ${AGENT_IMPORT.output}: carries the import (scan, converters, file access, smol-toml); ${BUNDLES.activation.output} carries none of it`,
)
console.log(`ok   ${UI_TEXT.output}: Node bundles share the English fallback`)
for (const bundle of DEFERRED) console.log(`ok   ${bundle.output}: loads only on its first action`)
for (const bundle of ON_FIRST_USE) {
  console.log(`ok   ${bundle.output}: loads only on ${bundle.use}, never at activation`)
}
