#!/usr/bin/env node
// Run after a production build and an offline npm ci of the ACP tarball:
// node scripts/check-ui-text.mjs <installed muse-spark-code-acp package root>
// Loads the actual Node bundles; no editor, credential read or model call.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

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
const agent = path.resolve(packageRoot, 'dist/acp.js')
const table = createRequire(agent)('./uiText.js').EN
// --help takes no backend or credential-store action. Empty environment also
// selects English independently of the machine's installed display language.
const help = execFileSync(process.execPath, [agent, '--help'], { encoding: 'utf8', env: {} })
assert.equal(help.trim(), table.acpUsage.replaceAll('{command}', 'muse-spark-code-acp').trim())
console.log(
  'ok   extension, Model API, review and supplied ACP package load the shared English fallback',
)
