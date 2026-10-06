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
// - the browser check's pipe, run, proxy, canaries and processes (M81) are
//   in dist/extension.js, dist/modelApi.js, dist/acp.js or
//   dist/browserRuntime.js, or missing from their own bundle,
//   dist/browserCheck.js, required on the first check.
// - the browser check's runtime acquisition (M81 A1: the pin manifest, the
//   downloader, the ZIP reader, hashing, staging and publication) is in any
//   bundle but dist/browserRuntime.js, or missing from it (design spec v4
//   §9.1: dist/browserCheck.js keeps its 50 KiB and never carries the
//   extractor).
// - the review (M70: git's material, the review turn's text, the Plan-mode
//   hold and edit review) is in dist/extension.js, dist/modelApi.js or
//   dist/acp.js, or missing from dist/review.js, which dist/extension.js
//   requires the first time one is used.
// - the import from other agents (M83: the scan, the converters, the file
//   access, the flow and smol-toml) is in dist/extension.js, dist/modelApi.js
//   or dist/acp.js, or missing from dist/agentImport.js.
// - the conversation Git implementation or the window's git and pull request
//   features (M71) leak back into activation, dist/modelApi.js or
//   dist/acp.js, or are missing from their checked factory bundle.
// - the bundled skills installer (M89: the copy and links for Muse Code) is
//   in dist/extension.js, dist/modelApi.js or dist/acp.js, or missing from
//   dist/bundledSkills.js, or that bundle carries its own English table.
// - code intelligence's `ide` answers (M67: the queries, the read tools, the
//   repo map and the rename), voice's drivers (M9, M35: the dictation
//   driver, Muse Voice's stream, the processes and the socket), the window's
//   web fetch (M69: each hop's checks and pins, the transport, the decoders,
//   the failures) or the Auto reviewer on Muse Code (M90: its side session,
//   with M78's reviewer core) are in dist/extension.js, or missing from
//   dist/codeIntel.js, dist/voice.js, dist/webFetch.js or
//   dist/museCodeReviewer.js.
// - What's New (M99: the page's renderer, content schema and tab) is in
//   dist/extension.js or missing from dist/whatsNew.js; or its page script,
//   dist/webview/whatsNew.js, carries any package, the display table or
//   constants.ts, or no longer carries the page script.
// - the report dialog (M93: the builder, its second scrub, the export paths
//   and the handler) or the flight recorder's journal (its policy and frame
//   mapping) is in dist/extension.js, or missing from dist/report.js or
//   dist/recorder.js. The ACP agent loads that same journal before serving.
// - a model text block beside MODEL_TEXT (MODEL_API_, CODE_INTEL_,
//   CHECKPOINT_, AGENT_IMPORT_, GIT_, REVIEW_, WEB_FETCH_, EXEC_,
//   AUTO_REVIEWER_MODEL_TEXT) is
//   in any shipped bundle but the ones declared to read it, or no longer in
//   one of those; a block is declared that this check does not guard;
//   FILE_REFUSAL_MODEL_TEXT, which activation carries by design, holds other
//   keys than its pinned ones; or a key of MODEL_TEXT, which every bundle
//   reading any key of it carries whole, is read by no source file of
//   dist/extension.js (it belongs in the block of the bundle that reads it).
//
// Exits 1 on any problem.
//
//   node scripts/check-bundle-split.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { createRequire } from 'node:module'
import {
  BUNDLES,
  DEFERRED,
  ON_FIRST_USE,
  DEFERRED_ONLY,
  FOREIGN_HOOKS_ONLY,
  HOOK_RUNTIME_ONLY,
  PLUGIN_HOOKS_ONLY,
  checkDeferredBundles,
} from './lib/deferredBundles.mjs'
import { DEFERRED_WEBVIEW_SURFACES, webviewStartupOutputs } from './lib/webviewBundles.mjs'
import { UI_TEXT_REGIONS } from './lib/uiTextRegions.mjs'

const MODEL_API_DIR = 'src/core/backends/modelapi'
const ENTRY = 'src/host/backend/modelApiEntry.ts'
// M91 lane W: the adapters for hooks imported in another agent's format (lane
// P's contracts and engine), dist/foreignHooks.js, loaded the first time a
// session holding one runs a hook.

// M91: the hook and MCP-form runtime, dist/hookRuntime.js (lane E's
// spark-hooks.json reader and dispatcher, lane H's typed handlers, lane M's
// form checks), loaded the first time a session needs one of them. The
// modules it re-exports stay LAZY_ONLY: dist/modelApi.js keeps their types,
// field builders and constants, and esbuild leaves the runners out of it.
// M91b: the Amp and OpenCode plugin host, its child's source and its event
// mapping, dist/pluginHooks.js, which the adapters require on the first
// plugin hook (the import bundle reads the mapping too).

// Files of type declarations only, which no bundle carries: lane P's contract
// shapes, read by the adapters' compiler and never at run time.
const TYPES_ONLY = new Set(['hookFormats/contract.ts'])
// M91 lane X's Cline discovery, which no bundle carries until its dispatcher
// wiring lands (PLAN.md M91, lane X; the lead's call).
const UNBUNDLED = new Set(['hookFormats/clineDiscover.ts'])

// The backend's files the activation bundle may carry, each with its reason.
const ACTIVATION_ALLOWED = new Map([
  ['schemas.ts', 'shared boundary schemas used by activation and ACP'],
  ['sse.ts', 'ACP event streams also use this parser'],
  ['imageGeneration.ts', "the IDE server's image tools on Muse Code (M44)"],
  ['imageToolDefinitions.ts', "the IDE server's image tools on Muse Code (M44)"],
  ['sessionStore.ts', "the stored-session format the window's session store reads (D14)"],
  ['goalRecord.ts', "a stored session's goal (D14, M45)"],
  ['schedules.ts', "the schedule store's next occurrence (M52)"],
])

// The files that load only with the backend: the host, its tools, hooks,
// goals, subagents, memory tools, permission engine and MCP client.
const LAZY_ONLY = [
  // TRAIN14A: stored-key image/Tab HTTP calls load the same client on first use.
  'client.ts',
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
  'hookHandlers.ts',
  'extensionHooks.ts',
  'instructions.ts',
  'mediaBudget.ts',
  'memoryTools.ts',
  'modelCallHooks.ts',
  // M73: observation packing's store, its placeholder and recall_output.
  'observationPack.ts',
  'permissions.ts',
  'promptCache.ts',
  // The built-in Reviewer's prompt and tool list (M70).
  'reviewer.ts',
  'sessionBudget.ts',
  'subagentTools.ts',
  'toolHookPayload.ts',
  'tools.ts',
  // M81: what a browser check hands the model and the row.
  'browserCalls.ts',
  // The verify loop's session side and its tool surface (M68).
  'verifyLedger.ts',
  'verifyLoop.ts',
  'verifyTools.ts',
  'mcp/connection.ts',
  // M91-M: MCP forms' types and log text load with the backend; their checks
  // load with dist/hookRuntime.js, and the browser reuses value validation.
  'mcp/elicitation.ts',
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
    Number(DEFERRED_ONLY.includes(name)) +
    Number(FOREIGN_HOOKS_ONLY.includes(name)) +
    Number(HOOK_RUNTIME_ONLY.includes(name)) +
    Number(PLUGIN_HOOKS_ONLY.includes(name)) +
    Number(TYPES_ONLY.has(name)) +
    Number(UNBUNDLED.has(name))
  if (lists !== 1) {
    problems.push(
      `${MODEL_API_DIR}/${name} is on ${lists === 0 ? 'neither list' : 'both lists'} in scripts/check-bundle-split.mjs`,
    )
  }
}
for (const name of [
  ...ACTIVATION_ALLOWED.keys(),
  ...lazy,
  ...DEFERRED_ONLY,
  ...FOREIGN_HOOKS_ONLY,
  ...HOOK_RUNTIME_ONLY,
  ...PLUGIN_HOOKS_ONLY,
  ...TYPES_ONLY,
  ...UNBUNDLED,
]) {
  if (!onDisk.has(name)) {
    problems.push(`${MODEL_API_DIR}/${name} is listed but does not exist`)
  }
}

const activation = inputsOf(BUNDLES.activation)
const modelApi = inputsOf(BUNDLES.modelApi)
const acp = inputsOf(BUNDLES.acp)
const extensionHooks = inputsOf({
  output: 'dist/extensionHooks.js',
  metafile: 'dist/meta/extensionHooks.json',
})
for (const file of ['src/host/extensionHooksEntry.ts', 'src/host/extensionHooksRunner.ts']) {
  for (const [output, inputs] of [
    [BUNDLES.activation.output, activation],
    [BUNDLES.modelApi.output, modelApi],
    [BUNDLES.acp.output, acp],
  ]) {
    if (inputs.has(file)) problems.push(`${output} carries the lazy extension hook runner ${file}`)
  }
  if (!extensionHooks.has(file)) problems.push(`dist/extensionHooks.js no longer carries ${file}`)
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
const REVIEW = { output: 'dist/review.js', metafile: 'dist/meta/review.json' }
// The English fallback is shared; installed-language state stays in each bundle.
const UI_TEXT = { output: 'dist/uiText.js', metafile: 'dist/meta/uiText.json' }
const ENGLISH_TABLE = 'src/shared/l10n/en.ts'
const AGENT_IMPORT = { output: 'dist/agentImport.js', metafile: 'dist/meta/agentImport.json' }
const CONVERSATION_GIT = {
  output: 'dist/conversationGit.js',
  metafile: 'dist/meta/conversationGit.json',
}
const BUNDLED_SKILLS = {
  output: 'dist/bundledSkills.js',
  metafile: 'dist/meta/bundledSkills.json',
}
// Split out of activation on 2026-10-03 (D6): each loads on its first use.
// The Model API backend keeps its own copy of code intelligence.

const uiText = inputsOf(UI_TEXT)
if (!uiText.has(ENGLISH_TABLE)) {
  problems.push(`${UI_TEXT.output} no longer carries ${ENGLISH_TABLE}`)
}
// ACTDIET: only the shared fallback may reference a generated English region.
for (const region of UI_TEXT_REGIONS) {
  const bundle = {
    output: region.output,
    metafile: `dist/meta/${path.basename(region.output, '.js')}.json`,
  }
  if (!inputsOf(bundle).has(ENGLISH_TABLE)) {
    problems.push(`${region.output} no longer carries its English region`)
  }
  const imported = `./${path.basename(region.output)}`
  const coreMeta = JSON.parse(readFileSync(UI_TEXT.metafile, 'utf8'))
  if (
    coreMeta.outputs[UI_TEXT.output].imports.every(
      (entry) => !(entry.path === imported && entry.external),
    )
  ) {
    problems.push(`${UI_TEXT.output} no longer references ${region.output}`)
  }
  for (const { output, metafile } of shippedBundles()) {
    if (output === UI_TEXT.output || output.startsWith('dist/webview/')) continue
    const meta = JSON.parse(readFileSync(metafile, 'utf8'))
    if (meta.outputs[output].imports.some((entry) => entry.path === imported)) {
      problems.push(
        `${output} directly imports ${region.output}, which only the shared fallback reads`,
      )
    }
  }
}

// M81: the browser check's pipe, run, proxy, canaries and processes live in
// their own bundle, required on the first check; activation keeps the
// loader, the tool and the lifetime both bundles' callers share.
const BROWSER_CHECK = { output: 'dist/browserCheck.js', metafile: 'dist/meta/browserCheck.json' }
const BROWSER_ONLY = [
  'src/host/browser/browserCheckEntry.ts',
  'src/host/browser/browserProcess.ts',
  'src/core/browser/browserRun.ts',
  'src/core/browser/pageCheck.ts',
  'src/core/browser/canaries.ts',
  'src/core/browser/checkProxy.ts',
  'src/core/browser/browserLaunch.ts',
  'src/core/browser/requestLog.ts',
  'src/core/browser/cdpPipe.ts',
]
// M81 A1: the runtime's acquisition, loaded only when a runtime is prepared
// or verified; no other bundle carries any of it.
const BROWSER_RUNTIME = {
  output: 'dist/browserRuntime.js',
  metafile: 'dist/meta/browserRuntime.json',
}
const RUNTIME_ONLY = [
  'src/host/browser/browserRuntimeEntry.ts',
  'src/host/browser/runtime/browserRuntime.json',
  'src/host/browser/runtime/runtimeStore.ts',
  'src/host/browser/runtime/zipExtract.ts',
  'src/core/browser/runtime/runtimeManifest.ts',
]
const browserCheck = inputsOf(BROWSER_CHECK)
const browserRuntime = inputsOf(BROWSER_RUNTIME)
for (const file of BROWSER_ONLY) {
  for (const [output, inputs] of [
    ...loaders,
    [BUNDLES.modelApi.output, modelApi],
    [BROWSER_RUNTIME.output, browserRuntime],
  ]) {
    if (inputs.has(file)) {
      problems.push(`${output} carries ${file}, which belongs to the browser check bundle`)
    }
  }
  if (!browserCheck.has(file)) {
    problems.push(`${BROWSER_CHECK.output} no longer carries ${file}`)
  }
}
for (const file of RUNTIME_ONLY) {
  for (const [output, inputs] of [
    ...loaders,
    [BUNDLES.modelApi.output, modelApi],
    [BROWSER_CHECK.output, browserCheck],
    [CHECKPOINT_STORE.output, inputsOf(CHECKPOINT_STORE)],
  ]) {
    if (inputs.has(file)) {
      problems.push(`${output} carries ${file}, which belongs to the browser runtime bundle`)
    }
  }
  if (!browserRuntime.has(file)) {
    problems.push(`${BROWSER_RUNTIME.output} no longer carries ${file}`)
  }
}
// M81 A1: the browser check and its runtime store return a closed failure
// union and show no text of their own, so neither loads the English table;
// neither may carry a copy of it either.
for (const [output, inputs] of [
  [BROWSER_RUNTIME.output, browserRuntime],
  [BROWSER_CHECK.output, browserCheck],
]) {
  if (inputs.has(ENGLISH_TABLE)) {
    problems.push(`${output} duplicates ${ENGLISH_TABLE}`)
  }
}
for (const bundle of [
  BUNDLES.activation,
  BUNDLES.modelApi,
  BUNDLES.acp,
  CHECKPOINT_STORE,
  REVIEW,
  ...DEFERRED,
  AGENT_IMPORT,
  CONVERSATION_GIT,
  BUNDLED_SKILLS,
  ...ON_FIRST_USE,
]) {
  const inputs = inputsOf(bundle)
  if (inputs.has(ENGLISH_TABLE)) {
    problems.push(`${bundle.output} duplicates ${ENGLISH_TABLE}`)
  }
  const { outputs } = JSON.parse(readFileSync(bundle.metafile, 'utf8'))
  if (
    bundle.uiText !== false &&
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
// M70: git's material, the review turn's text, the Plan-mode hold and edit
// review live in a bundle the activation bundle requires on first use. Only
// types and the loader (reviewBundle.ts) stay at activation.
const REVIEW_ONLY = [
  'src/host/review/reviewEntry.ts',
  'src/host/review/reviewCollector.ts',
  'src/core/review/reviewMaterial.ts',
  'src/core/review/reviewPrompt.ts',
  'src/core/review/planModeHold.ts',
  'src/host/editor/editReview.ts',
]
const review = inputsOf(REVIEW)
for (const file of REVIEW_ONLY) {
  for (const [output, inputs] of [...loaders, [BUNDLES.modelApi.output, modelApi]]) {
    if (inputs.has(file)) {
      problems.push(`${output} carries ${file}, which belongs to the review bundle`)
    }
  }
  if (!review.has(file)) {
    problems.push(`${REVIEW.output} no longer carries ${file}`)
  }
}
// M83: the import from other agents loads on the first import.
const IMPORT_ONLY = [
  'src/host/agentImportEntry.ts',
  'src/host/agentImportHost.ts',
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

// M71: the conversations' Git adapter and the window's git and pull request
// features (VS Code's git extension adapter, the GitHub client and sign-in,
// the pull request links, the checkout and its untrusted git lane, the
// prompts) load with the first conversation or pull request command.
// Activation keeps the hold, the worktree records and the checked loader.
const GIT_ONLY = [
  'src/host/git/conversationGit.ts',
  'src/host/git/conversationGitEntry.ts',
  'src/host/git/gitWindow.ts',
  'src/host/git/gitExtension.ts',
  'src/host/git/githubSession.ts',
  'src/host/git/heldCheckout.ts',
  'src/host/git/pullRequestCheckout.ts',
  'src/host/git/pullRequestLinks.ts',
  'src/host/git/untrustedGit.ts',
  'src/core/git/github.ts',
  'src/core/git/githubRemote.ts',
  'src/core/git/gitText.ts',
  'src/core/git/heldTree.ts',
  'src/core/git/pullRequestRef.ts',
  'src/core/git/pushPlan.ts',
]
const conversationGit = inputsOf(CONVERSATION_GIT)
for (const file of GIT_ONLY) {
  for (const bundle of [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]) {
    if (inputsOf(bundle).has(file)) {
      problems.push(
        `${bundle.output} carries ${file}, which belongs to the conversation Git bundle`,
      )
    }
  }
  if (!conversationGit.has(file)) {
    problems.push(`${CONVERSATION_GIT.output} no longer carries ${file}`)
  }
}

// M89: the bundled skills installer loads on its first install, removal or
// offer; the activation bundle has its loader, its offer and its types only.
const BUNDLED_SKILLS_ONLY = [
  'src/host/skills/bundledSkillsEntry.ts',
  'src/host/skills/bundledSkillsInstall.ts',
]
const bundledSkills = inputsOf(BUNDLED_SKILLS)
for (const file of BUNDLED_SKILLS_ONLY) {
  for (const bundle of [BUNDLES.activation, BUNDLES.modelApi, BUNDLES.acp]) {
    if (inputsOf(bundle).has(file)) {
      problems.push(`${bundle.output} carries ${file}, which loads only with the installer`)
    }
  }
  if (!bundledSkills.has(file)) {
    problems.push(`${BUNDLED_SKILLS.output} no longer carries ${file}`)
  }
}

// Keep Tab's full source inventory guarded when adding an engine module.
const tabFiles = ON_FIRST_USE.find((bundle) => bundle.output === 'dist/tab.js').files
for (const file of readdirSync('src/core/tab')) {
  if (file.endsWith('.ts') && !tabFiles.includes(`src/core/tab/${file}`))
    problems.push(`src/core/tab/${file} is absent from the deferred Tab inventory`)
}
problems.push(...checkDeferredBundles(inputsOf))

// ACTDIET: ACP shares the journal before session initialization or report reading.
const acpMeta = JSON.parse(readFileSync(BUNDLES.acp.metafile, 'utf8'))
if (
  acpMeta.outputs[BUNDLES.acp.output].imports.every(
    (entry) => !(entry.path === './recorder.js' && entry.external),
  )
) {
  problems.push(`${BUNDLES.acp.output} no longer loads the shared recorder`)
}

// What's New's page script (M99) is a few lines that pass clicks back: it
// carries no package, not the display table and not constants.ts (which
// re-exports that table), only the script and its markup contract.
const WHATS_NEW_PAGE = {
  output: 'dist/webview/whatsNew.js',
  metafile: 'dist/meta/whatsNewPage.json',
  script: 'src/webview/whatsNew/whatsNewPage.ts',
  never: ['node_modules/', 'src/shared/l10n/', 'src/shared/constants.ts'],
}
const whatsNewPage = inputsOf(WHATS_NEW_PAGE)
for (const prefix of WHATS_NEW_PAGE.never) {
  if (hasPrefix(whatsNewPage, prefix)) {
    problems.push(
      `${WHATS_NEW_PAGE.output} carries ${prefix}, which What’s New’s page script never needs`,
    )
  }
}
if (!whatsNewPage.has(WHATS_NEW_PAGE.script)) {
  problems.push(`${WHATS_NEW_PAGE.output} no longer carries ${WHATS_NEW_PAGE.script}`)
}

// Model text (PLAN.md D6, 2026-10-03). One object is carried whole by every
// bundle that reads any key of it: esbuild does not tree-shake by key. So
// text that only lazily loaded bundles read is a block of its own in
// src/shared/constants.ts, and esbuild keeps property names, so a block's
// sentinel key in a bundle's output means that bundle carries the block.
// Each sentinel must also still be in the bundles that read the block, so a
// renamed key cannot quietly turn the check off. A block's readers are
// declared; every other shipped bundle, lazily loaded ones included, must
// not carry it (the review of the diet, P2-2: a lazy bundle that read one key
// of another lazy bundle's block would carry the whole block).
const CONSTANTS = 'src/shared/constants.ts'
/** Every JavaScript bundle the production build ships, from its metafiles. */
function shippedBundles() {
  return ['dist/meta', 'dist/meta-acp'].flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => {
        const metafile = `${dir}/${name}`
        const { outputs } = JSON.parse(readFileSync(metafile, 'utf8'))
        return Object.keys(outputs)
          .filter((output) => output.endsWith('.js'))
          .map((output) => ({ output, metafile }))
      }),
  )
}
const SHIPPED = shippedBundles()
// ESM splitting moves shared constants to one common browser chunk. Identify
// that chunk by its source, so hashes may change without loosening the text gate.
const webviewConstants = SHIPPED.filter(
  (bundle) =>
    bundle.output.startsWith('dist/webview/') && inputsOf(bundle).has('src/shared/constants.ts'),
)
if (webviewConstants.length !== 1) {
  problems.push('the webview must carry shared constants in exactly one JavaScript output')
}
/** The shipped bundle that `output` names; a missing one is a problem. */
function shipped(output) {
  const bundle = SHIPPED.find((entry) => entry.output === output)
  if (bundle === undefined) {
    problems.push(`${output} is not among the shipped bundles' metafiles`)
  }
  return bundle ?? { output, metafile: '' }
}
const TEXT_BLOCKS = [
  {
    block: 'CONVERSATION_MODEL_TEXT',
    sentinels: ['planBriefRequest', 'replyContextLead'],
    readers: ['dist/conversation.js', BUNDLES.modelApi.output],
  },
  {
    block: 'TAB_MODEL_TEXT',
    sentinels: ['tabSystem', 'tabUserTemplate'],
    readers: ['dist/tab.js'],
  },
  {
    block: 'HOOK_MODEL_TEXT',
    sentinels: ['hookPromptRole', 'hookAgentRole', 'hookAnswer'],
    // Lane H's prompt and agent handlers run from the hook runtime (M91).
    readers: ['dist/hookRuntime.js'],
  },
  {
    block: 'MODEL_API_MODEL_TEXT',
    sentinels: ['compactionPrompt', 'goalUnfinishedExists', 'verifyUncheckedCodeLoading'],
    readers: [BUNDLES.modelApi.output],
  },
  {
    block: 'CODE_INTEL_MODEL_TEXT',
    sentinels: ['codeIntelNoSymbolNamed', 'repoMapBudgetTooSmall'],
    readers: ['dist/codeIntel.js', BUNDLES.modelApi.output],
  },
  {
    block: 'CHECKPOINT_MODEL_TEXT',
    sentinels: ['writeNotRecorded'],
    readers: [CHECKPOINT_STORE.output],
  },
  {
    block: 'AGENT_IMPORT_MODEL_TEXT',
    sentinels: ['importedRulesHeading'],
    readers: [AGENT_IMPORT.output],
  },
  {
    block: 'GIT_MODEL_TEXT',
    sentinels: ['gitCommitInstructions', 'gitPullRequestInstructions'],
    readers: [CONVERSATION_GIT.output],
  },
  // The review turn's text (M70): the review's bundle, the Model API's
  // built-in Reviewer. The pane's one comment template has its own block.
  {
    block: 'REVIEW_MODEL_TEXT',
    sentinels: ['reviewerRole', 'reviewMuseCodeRole'],
    readers: [REVIEW.output, BUNDLES.modelApi.output],
  },
  {
    block: 'REVIEW_COMMENT_MODEL_TEXT',
    sentinels: ['reviewRemovedLine'],
    readers: webviewConstants.map(({ output }) => output),
  },
  // Web fetch's own words (M69): the window's fetch, the Model API
  // backend's URL checks and the ACP agent's fetch.
  {
    block: 'WEB_FETCH_MODEL_TEXT',
    sentinels: ['webFetchUntrusted', 'webFetchMovedOpen'],
    readers: ['dist/webFetch.js', BUNDLES.modelApi.output, BUNDLES.acp.output],
  },
  // A headless run's attached files (M80): the ACP agent's runtime only.
  {
    block: 'EXEC_MODEL_TEXT',
    sentinels: ['execUntrustedLead'],
    readers: [BUNDLES.acp.output],
  },
  // The Auto reviewer (M78, M90): the paid reviewer and the reviewer on Muse
  // Code. dist/modelApi.js carries autoReviewer.ts for its types and policy
  // but none of the calls that read this text.
  {
    block: 'AUTO_REVIEWER_MODEL_TEXT',
    sentinels: ['autoReviewerInstructions', 'museCodeReviewerTurn'],
    readers: ['dist/reviewer.js', 'dist/museCodeReviewer.js'],
  },
  // The same-model Judge's sources and question load only at an eligible approval.
  {
    block: 'JUDGE_MODEL_TEXT',
    sentinels: ['judgeSystemInstruction', 'judgeStandaloneTurn'],
    readers: ['dist/judge.js'],
  },
].map((entry) => ({
  ...entry,
  readers: entry.readers.map((output) => shipped(output)),
  others: SHIPPED.filter(({ output }) => !entry.readers.includes(output)),
}))
// The refusals a file tool gives are read at activation (memoryStore,
// toolIo, fsAtomic) and by lazily loaded bundles alike, so every bundle
// that reads one carries the block by design and it takes no `others`. Its
// keys are pinned instead: a key added here rides into dist/extension.js
// and dist/acp.js, so it must be one that activation reads anyway.
const FILE_REFUSAL = {
  block: 'FILE_REFUSAL_MODEL_TEXT',
  keys: ['fileHasUnsavedChanges', 'pathChangedAfterApproval'],
}
const constantsSource = readFileSync(CONSTANTS, 'utf8')
/** The keys of one `export const NAME = { … } as const` block of constants.ts. */
function blockKeys(name) {
  const start = constantsSource.indexOf(`export const ${name} = {`)
  const end = constantsSource.indexOf('} as const', start)
  if (start === -1 || end === -1) {
    problems.push(`${CONSTANTS} no longer declares ${name}`)
    return []
  }
  return constantsSource
    .slice(start, end)
    .matchAll(/^ {2}(\w+):/gm)
    .map((match) => match[1])
    .toArray()
}
const outputText = new Map()
function textOf(output) {
  if (!outputText.has(output)) {
    outputText.set(output, readFileSync(output, 'utf8'))
  }
  return outputText.get(output)
}
for (const { block, sentinels, readers, others } of TEXT_BLOCKS) {
  const keys = new Set(blockKeys(block))
  for (const sentinel of sentinels) {
    if (!keys.has(sentinel)) {
      problems.push(`${block} has no key ${sentinel}: pick another sentinel for it`)
    }
    const declared = new RegExp(`[{,]${sentinel}:`)
    for (const { output } of others) {
      if (declared.test(textOf(output))) {
        problems.push(
          `${output} carries ${block} (its key ${sentinel}), which only ${readers.map((reader) => reader.output).join(', ')} read`,
        )
      }
    }
    for (const { output } of readers) {
      if (!declared.test(textOf(output))) {
        problems.push(`${output} no longer carries ${block} (its key ${sentinel})`)
      }
    }
  }
}
// Every model text block beside MODEL_TEXT is guarded: a new one needs an
// entry above (or is FILE_REFUSAL_MODEL_TEXT, pinned below).
const guarded = new Set([...TEXT_BLOCKS.map(({ block }) => block), FILE_REFUSAL.block])
for (const [, block] of constantsSource.matchAll(/^export const (\w+_MODEL_TEXT) = \{/gm)) {
  if (!guarded.has(block)) {
    problems.push(
      `${CONSTANTS} declares ${block}, which scripts/check-bundle-split.mjs does not guard`,
    )
  }
}
const fileRefusalKeys = blockKeys(FILE_REFUSAL.block)
if (fileRefusalKeys.join(', ') !== FILE_REFUSAL.keys.join(', ')) {
  problems.push(
    `${FILE_REFUSAL.block} holds ${fileRefusalKeys.join(', ')}, not ${FILE_REFUSAL.keys.join(', ')}: every bundle that reads a key of it, dist/extension.js among them, carries all of it`,
  )
}
// What stays in MODEL_TEXT is what dist/extension.js reads: a key no source
// file of the activation bundle reads makes every bundle carry it for
// nothing, and belongs in the block of the bundle that does read it.
const activationReads = new Set()
for (const input of activation.keys()) {
  if (input === CONSTANTS || !input.startsWith('src/')) {
    continue
  }
  const source = readFileSync(input, 'utf8')
  if (/\bMODEL_TEXT\[/.test(source)) {
    problems.push(`${input} reads MODEL_TEXT by a computed key, which this check cannot follow`)
  }
  for (const match of source.matchAll(/\bMODEL_TEXT\.(\w+)/g)) {
    activationReads.add(match[1])
  }
}
const modelTextKeys = blockKeys('MODEL_TEXT')
for (const key of modelTextKeys) {
  if (!activationReads.has(key)) {
    problems.push(
      `MODEL_TEXT.${key} is read by no source file of ${BUNDLES.activation.output}: move it to the block of the bundle that reads it`,
    )
  }
}

// All optional surfaces must remain behind dynamic imports. Every
// emitted JS chunk must be reachable and packaged; stale output is refused.
const webviewMeta = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
const eagerWebview = new Set(webviewStartupOutputs(webviewMeta))
const reachableWebview = new Set()
const visitWebview = (file) => {
  if (reachableWebview.has(file)) return
  reachableWebview.add(file)
  const output = webviewMeta.outputs[file]
  if (!output) {
    problems.push(`Missing webview chunk ${file}`)
    return
  }
  for (const imported of output.imports) if (!imported.external) visitWebview(imported.path)
}
visitWebview('dist/webview/main.js')
for (const surface of DEFERRED_WEBVIEW_SURFACES) {
  const source = `src/webview/components/${surface}.tsx`
  const outputs = Object.entries(webviewMeta.outputs).filter(([, output]) =>
    Object.hasOwn(output.inputs, source),
  )
  if (outputs.length !== 1 || eagerWebview.has(outputs[0]?.[0])) {
    problems.push(`${source} must occur in exactly one deferred webview chunk`)
  }
}
for (const [file, output] of Object.entries(webviewMeta.outputs)) {
  if (!file.endsWith('.js')) continue
  if (!reachableWebview.has(file) || !existsSync(file))
    problems.push(`Unreachable or missing webview chunk ${file}`)
  if (
    output.entryPoint &&
    output.entryPoint !== 'src/webview/main.tsx' &&
    DEFERRED_WEBVIEW_SURFACES.every(
      (name) => output.entryPoint !== `src/webview/components/${name}.tsx`,
    )
  ) {
    problems.push(`Unlisted deferred webview surface ${output.entryPoint}`)
  }
}
const chunks = 'dist/webview/chunks'
const builtChunks = readdirSync(chunks).filter((name) => name.endsWith('.js'))
for (const file of builtChunks) {
  if (!reachableWebview.has(`${chunks}/${file}`)) problems.push(`Stale webview chunk ${file}`)
}

// TRAIN13B: Node consumers share exactly the mini-parser API they read.
const validationMeta = JSON.parse(readFileSync('dist/meta/validation.json', 'utf8'))
const validationExports = new Set(
  Object.keys(createRequire(import.meta.url)(path.resolve('dist/validation.js'))),
)
const nodeMetafiles = readdirSync('dist/meta')
  .filter((name) => !['validation.json', 'webview.json', 'whatsNewPage.json'].includes(name))
  .map((name) => `dist/meta/${name}`)
nodeMetafiles.push('dist/meta-acp/acp.json')
const validationReaders = new Set()
for (const file of nodeMetafiles) {
  const meta = JSON.parse(readFileSync(file, 'utf8'))
  for (const [output, details] of Object.entries(meta.outputs)) {
    if (
      Object.keys(details.inputs).some((input) => input.startsWith('node_modules/zod/v4/mini/'))
    ) {
      problems.push(`${output} inlines the shared mini-parser`)
    }
  }
  const sourceInputs = Object.keys(meta.inputs).filter((name) => name.startsWith('src/'))
  for (const input of sourceInputs) {
    validationReaders.add(input)
  }
}
for (const input of validationReaders) {
  const text = readFileSync(input, 'utf8')
  // A file that never names the module has no alias to check; parsing every
  // source input made this the slowest part of the check.
  if (!text.includes('zod/mini')) continue
  const source = ts.createSourceFile(input, text, ts.ScriptTarget.Latest)
  const aliases = new Set()
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'zod/mini' &&
      statement.importClause?.namedBindings &&
      ts.isNamespaceImport(statement.importClause.namedBindings)
    ) {
      aliases.add(statement.importClause.namedBindings.name.text)
    }
  }
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliases.has(node.expression.text) &&
      !validationExports.has(node.name.text)
    ) {
      problems.push(`${input} reads zod/mini.${node.name.text}, absent from validation.js`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
if (
  Object.keys(validationMeta.inputs).every(
    (input) => !input.startsWith('node_modules/zod/v4/mini/'),
  )
) {
  problems.push('dist/validation.js no longer carries the mini-parser')
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
  `ok   ${BROWSER_CHECK.output}: carries the browser check's pipe, run, proxy, canaries and processes; activation keeps the loaders and the tool`,
)
console.log(
  `ok   ${BROWSER_RUNTIME.output}: carries the runtime's acquisition (pin, download, ZIP reader, store); no other bundle does`,
)
console.log(
  `ok   ${REVIEW.output}: carries the review and edit review; ${BUNDLES.activation.output} keeps the loader`,
)
console.log(
  `ok   ${AGENT_IMPORT.output}: carries the import (scan, converters, file access, smol-toml); ${BUNDLES.activation.output} carries none of it`,
)
console.log(
  `ok   model text: ${TEXT_BLOCKS.map(({ block }) => block).join(', ')} each in its readers and in no other of the ${String(SHIPPED.length)} shipped bundles; ${FILE_REFUSAL.block} pinned to ${String(FILE_REFUSAL.keys.length)} keys; ${String(modelTextKeys.length)} MODEL_TEXT keys, each read at activation`,
)
console.log(`ok   ${UI_TEXT.output}: Node bundles share the English fallback`)
console.log('ok   webview: Git and Account & usage each load only in their deferred chunk')
console.log(
  `ok   ${CONVERSATION_GIT.output}: carries the Git adapter and the window's ${String(GIT_ONLY.length - 2)} git and pull request files; activation keeps its checked loader`,
)
for (const bundle of DEFERRED) console.log(`ok   ${bundle.output}: loads only on its first action`)
for (const bundle of ON_FIRST_USE) {
  console.log(`ok   ${bundle.output}: loads only on ${bundle.use}, never at activation`)
}
console.log(`ok   ${WHATS_NEW_PAGE.output}: the page script alone, no package and no display table`)
