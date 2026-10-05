#!/usr/bin/env node
// Bundles the extension host entry, the Model API backend, the review, the search worker,
// web fetch's page converter worker (M69: parse5 and the HTML converter,
// loaded on a worker thread started for each page, never at activation), the
// import from other agents (M83: the scan, the converters, the file access and
// smol-toml, loaded on the first import), the bundled skills installer (M89:
// the copy and links for Muse Code, loaded on the first install, removal or
// offer), code intelligence's `ide` answers (M67, loaded on the first call),
// voice's drivers (M9/M35, loaded on the first recording), the window's web
// fetch (M69, loaded on the first fetch) and the Auto reviewer on Muse Code
// (M90, loaded on the first review), the webview, and
// (in dev mode) the integration tests with esbuild.
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
// The review (M70) is a third, dist/review.js: git's material for `/review`,
// its turn text and the Plan-mode hold, required the first time a review
// starts. Its factory installs the activation bundle's display language before use.
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
// One immutable English fallback shared by Node bundles; each keeps its own
// mutable installed-language state. The browser keeps its fallback bundled.
const UI_TEXT_ENTRY = 'src/shared/l10n/en.ts'
const UI_TEXT_OUTFILE = 'dist/uiText.js'
const MODEL_API_ENTRY = 'src/host/backend/modelApiEntry.ts'
const MODEL_API_OUTFILE = 'dist/modelApi.js'
const SESSION_BOARD_ENTRY = 'src/host/sessionBoardEntry.ts'
const SESSION_BOARD_OUTFILE = 'dist/sessionBoard.js'
const REVIEWER_ENTRY = 'src/core/backends/modelapi/reviewerEntry.ts'
const REVIEWER_OUTFILE = 'dist/reviewer.js'
// M91 lane W: the adapters for hooks imported in another agent's format,
// loaded the first time a session holding one runs a hook.
const FOREIGN_HOOKS_ENTRY = 'src/core/backends/modelapi/foreignHooksEntry.ts'
const FOREIGN_HOOKS_OUTFILE = 'dist/foreignHooks.js'
// M91: the hook and MCP-form runtime (lane E's spark-hooks.json reader and
// dispatcher, lane H's typed handlers, lane M's form checks), loaded the first
// time a session with hooks on, or a server's form, needs it.
const HOOK_RUNTIME_ENTRY = 'src/core/backends/modelapi/hookRuntimeEntry.ts'
const HOOK_RUNTIME_OUTFILE = 'dist/hookRuntime.js'
const PLAN_MARKDOWN_ENTRY = 'src/host/planMarkdownEntry.ts'
const PLAN_MARKDOWN_OUTFILE = 'dist/planMarkdown.js'
const REVIEW_ENTRY = 'src/host/review/reviewEntry.ts'
const REVIEW_OUTFILE = 'dist/review.js'
const AGENT_IMPORT_ENTRY = 'src/host/agentImportEntry.ts'
const AGENT_IMPORT_OUTFILE = 'dist/agentImport.js'
const BUNDLED_SKILLS_ENTRY = 'src/host/skills/bundledSkillsEntry.ts'
const BUNDLED_SKILLS_OUTFILE = 'dist/bundledSkills.js'
const CHECKPOINT_STORE_ENTRY = 'src/host/checkpoints/checkpointStoreEntry.ts'
const CHECKPOINT_STORE_OUTFILE = 'dist/checkpointStore.js'
const CODE_INTEL_ENTRY = 'src/host/ide/codeIntelEntry.ts'
const CODE_INTEL_OUTFILE = 'dist/codeIntel.js'
const VOICE_ENTRY = 'src/host/voice/voiceEntry.ts'
const VOICE_OUTFILE = 'dist/voice.js'
const WEB_FETCH_ENTRY = 'src/host/web/webFetchEntry.ts'
const WEB_FETCH_OUTFILE = 'dist/webFetch.js'
const MUSE_CODE_REVIEWER_ENTRY = 'src/host/review/museCodeReviewerEntry.ts'
const MUSE_CODE_REVIEWER_OUTFILE = 'dist/museCodeReviewer.js'
const EXTENSION_HOOKS_ENTRY = 'src/host/extensionHooksEntry.ts'
const EXTENSION_HOOKS_OUTFILE = 'dist/extensionHooks.js'
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

/** @type {import('esbuild').Plugin} */
const sharedUiText = {
  name: 'shared-ui-text',
  setup(build) {
    // esbuild sends this filter to Go RE2, which rejects JavaScript's u flag.
    // `en`, `en.js` and `en.ts` all name the table's TypeScript source.
    build.onResolve({ filter: /\/en(?:\.[jt]s)?$/ }, (args) =>
      path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts')) ===
      path.resolve(UI_TEXT_ENTRY)
        ? { path: './uiText.js', external: true }
        : undefined,
    )
  },
}

// Keep dynamic imports dynamic: these entries run only on their first action.
const DEFERRED_OUTFILES = new Map([
  [path.resolve(SESSION_BOARD_ENTRY), SESSION_BOARD_OUTFILE],
  [path.resolve(REVIEWER_ENTRY), REVIEWER_OUTFILE],
  [path.resolve(FOREIGN_HOOKS_ENTRY), FOREIGN_HOOKS_OUTFILE],
  [path.resolve(HOOK_RUNTIME_ENTRY), HOOK_RUNTIME_OUTFILE],
  [path.resolve(WEB_FETCH_ENTRY), WEB_FETCH_OUTFILE],
])
/** @type {import('esbuild').Plugin} */
const deferredCohort = {
  name: 'deferred-cohort',
  setup(build) {
    build.onResolve(
      {
        filter:
          /\/(?:sessionBoardEntry|reviewerEntry|foreignHooksEntry|hookRuntimeEntry|webFetchEntry)(?:\.[jt]s)?$/,
      },
      (args) => {
        if (args.kind !== 'dynamic-import') return
        const source = path.resolve(args.resolveDir, `${args.path.replace(/\.[jt]s$/, '')}.ts`)
        const output = DEFERRED_OUTFILES.get(source)
        return output === undefined
          ? undefined
          : { path: `./${path.basename(output)}`, external: true }
      },
    )
  },
}

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
  plugins: [sharedUiText, deferredCohort],
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
  plugins: [sharedUiText, deferredCohort],
  entryPoints: [MODEL_API_ENTRY],
  outfile: MODEL_API_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const sessionBoardOptions = {
  ...modelApiOptions,
  entryPoints: [SESSION_BOARD_ENTRY],
  outfile: SESSION_BOARD_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const reviewerOptions = {
  ...modelApiOptions,
  entryPoints: [REVIEWER_ENTRY],
  outfile: REVIEWER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const foreignHooksOptions = {
  ...modelApiOptions,
  entryPoints: [FOREIGN_HOOKS_ENTRY],
  outfile: FOREIGN_HOOKS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const hookRuntimeOptions = {
  ...modelApiOptions,
  entryPoints: [HOOK_RUNTIME_ENTRY],
  outfile: HOOK_RUNTIME_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const reviewOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [REVIEW_ENTRY],
  outfile: REVIEW_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const planMarkdownOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [PLAN_MARKDOWN_ENTRY],
  outfile: PLAN_MARKDOWN_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

// Neither imports `vscode`, so it is not external there and a stray import
// fails this build, as for the Model API backend.
/** @type {import('esbuild').BuildOptions} */
const codeIntelOptions = {
  ...planMarkdownOptions,
  entryPoints: [CODE_INTEL_ENTRY],
  outfile: CODE_INTEL_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const voiceOptions = {
  ...planMarkdownOptions,
  entryPoints: [VOICE_ENTRY],
  outfile: VOICE_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const webFetchOptions = {
  ...planMarkdownOptions,
  entryPoints: [WEB_FETCH_ENTRY],
  outfile: WEB_FETCH_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const museCodeReviewerOptions = {
  ...planMarkdownOptions,
  entryPoints: [MUSE_CODE_REVIEWER_ENTRY],
  outfile: MUSE_CODE_REVIEWER_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const extensionHooksOptions = {
  ...modelApiOptions,
  entryPoints: [EXTENSION_HOOKS_ENTRY],
  outfile: EXTENSION_HOOKS_OUTFILE,
}

/** @type {import('esbuild').BuildOptions} */
const agentImportOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [AGENT_IMPORT_ENTRY],
  outfile: AGENT_IMPORT_OUTFILE,
  platform: 'node',
  external: ['vscode'],
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const bundledSkillsOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [BUNDLED_SKILLS_ENTRY],
  outfile: BUNDLED_SKILLS_OUTFILE,
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
const checkpointStoreOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [CHECKPOINT_STORE_ENTRY],
  outfile: CHECKPOINT_STORE_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
}

/** @type {import('esbuild').BuildOptions} */
const acpOptions = {
  ...common,
  plugins: [sharedUiText],
  entryPoints: [ACP_ENTRY],
  outfile: ACP_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: AGENT_NODE_TARGET,
  external: ['@napi-rs/keyring'],
  banner: { js: '#!/usr/bin/env node' },
}

/** @type {import('esbuild').BuildOptions} */
const uiTextOptions = {
  ...common,
  entryPoints: [UI_TEXT_ENTRY],
  outfile: UI_TEXT_OUTFILE,
  platform: 'node',
  format: 'cjs',
  target: HOST_NODE_TARGET,
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
    esbuild.context(reviewOptions),
    esbuild.context(sessionBoardOptions),
    esbuild.context(reviewerOptions),
    esbuild.context(foreignHooksOptions),
    esbuild.context(hookRuntimeOptions),
    esbuild.context(planMarkdownOptions),
    esbuild.context(checkpointStoreOptions),
    esbuild.context(agentImportOptions),
    esbuild.context(bundledSkillsOptions),
    esbuild.context(codeIntelOptions),
    esbuild.context(voiceOptions),
    esbuild.context(webFetchOptions),
    esbuild.context(museCodeReviewerOptions),
    esbuild.context(extensionHooksOptions),
    esbuild.context(uiTextOptions),
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
    review: esbuild.build(reviewOptions),
    sessionBoard: esbuild.build(sessionBoardOptions),
    reviewer: esbuild.build(reviewerOptions),
    foreignHooks: esbuild.build(foreignHooksOptions),
    hookRuntime: esbuild.build(hookRuntimeOptions),
    planMarkdown: esbuild.build(planMarkdownOptions),
    checkpointStore: esbuild.build(checkpointStoreOptions),
    agentImport: esbuild.build(agentImportOptions),
    bundledSkills: esbuild.build(bundledSkillsOptions),
    codeIntel: esbuild.build(codeIntelOptions),
    voice: esbuild.build(voiceOptions),
    webFetch: esbuild.build(webFetchOptions),
    museCodeReviewer: esbuild.build(museCodeReviewerOptions),
    extensionHooks: esbuild.build(extensionHooksOptions),
    uiText: esbuild.build(uiTextOptions),
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
  reportSize(REVIEW_OUTFILE)
  reportSize(SESSION_BOARD_OUTFILE)
  reportSize(REVIEWER_OUTFILE)
  reportSize(FOREIGN_HOOKS_OUTFILE)
  reportSize(HOOK_RUNTIME_OUTFILE)
  reportSize(PLAN_MARKDOWN_OUTFILE)
  reportSize(CHECKPOINT_STORE_OUTFILE)
  reportSize(AGENT_IMPORT_OUTFILE)
  reportSize(BUNDLED_SKILLS_OUTFILE)
  reportSize(CODE_INTEL_OUTFILE)
  reportSize(VOICE_OUTFILE)
  reportSize(WEB_FETCH_OUTFILE)
  reportSize(MUSE_CODE_REVIEWER_OUTFILE)
  reportSize(EXTENSION_HOOKS_OUTFILE)
  reportSize(UI_TEXT_OUTFILE)
  reportSize(SEARCH_WORKER_OUTFILE)
  reportSize(PAGE_WORKER_OUTFILE)
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.js'))
  reportSize(path.join(WEBVIEW_OUTDIR, 'main.css'))
  reportSize(ACP_OUTFILE)
}
