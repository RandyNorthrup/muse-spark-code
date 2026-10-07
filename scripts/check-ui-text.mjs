#!/usr/bin/env node
// Run after a production build and an offline npm ci of the ACP tarball:
// node scripts/check-ui-text.mjs <installed muse-spark-code-acp package root>
// Loads the actual Node bundles; no editor, credential read or model call.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { z } from 'zod'
import { loadL10n } from './lib/l10nSource.mjs'

const packageRoot = process.argv[2]
assert.ok(packageRoot, 'pass the ACP package installed from its tarball')

function loadBundle(file, exportName) {
  const require = createRequire(file)
  const module = { exports: {} }
  let tableLoads = 0
  runInNewContext(readFileSync(file, 'utf8'), {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === 'vscode') {
        return {}
      }
      if (name === './uiText.js') {
        tableLoads += 1
        const { EN } = require(name)
        assert.equal(EN.untitledConversation, 'Untitled')
        assert.equal(typeof EN.acpUsage, 'string')
      }
      return require(name)
    },
    process,
    Buffer: globalThis.Buffer,
    URL,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    __dirname: path.dirname(file),
    __filename: file,
  })
  assert.ok(tableLoads > 0, `${file} did not load its English fallback`)
  assert.equal(typeof module.exports[exportName], 'function')
}

loadBundle(path.resolve('dist/extension.js'), 'activate')
loadBundle(path.resolve('dist/modelApi.js'), 'createModelApiHost')
loadBundle(path.resolve('dist/review.js'), 'createReviewFeatures')
// The installed agent's own copy of the backend, which `--help` never loads.
loadBundle(path.resolve(packageRoot, 'dist/modelApi.js'), 'createModelApiHost')
const agent = path.resolve(packageRoot, 'dist/acp.js')
const table = createRequire(agent)('./uiText.js').EN
const { ACP_AGENT_NAME, formatAcpUsage } = await loadL10n(process.cwd())
const usageTable = z.object({
  acpUsage: z.string(),
  helpReferenceTitle: z.string(),
  referenceCliOptions: z.object({
    'resource-governor': z.string(),
    'cpu-max': z.string(),
    'memory-max': z.string(),
  }),
})
// --help takes no backend or credential-store action. An English locale
// variable, because with none the agent takes the runtime's own locale.
function checkUsage(table, locale) {
  const help = execFileSync(process.execPath, [agent, '--help'], {
    encoding: 'utf8',
    env: { LC_ALL: locale },
  })
  assert.equal(help.trim(), formatAcpUsage(usageTable.parse(table), ACP_AGENT_NAME).trim(), locale)
}
checkUsage(table, 'en_US.UTF-8')
const tables = readdirSync(path.join(packageRoot, 'l10n'))
  .filter((file) => /^ui\.[\w-]+\.json$/.test(file))
  .toSorted((a, b) => a.localeCompare(b))
assert.ok(tables.length > 0, 'the installed ACP package has no translated tables')
for (const file of tables) {
  checkUsage(
    JSON.parse(readFileSync(path.join(packageRoot, 'l10n', file), 'utf8')),
    file.slice('ui.'.length, -'.json'.length),
  )
}
console.log(
  `ok   extension, Model API, review and installed ACP tarball load the shared English fallback; complete ACP help matches English and ${tables.length} installed languages`,
)
