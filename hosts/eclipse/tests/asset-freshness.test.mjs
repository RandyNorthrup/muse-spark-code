import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(directory, 'plugin/target')

test('asset generation removes obsolete chunks and obsolete language files', () => {
  const obsolete = [
    path.join(target, 'assets/webview/chunk-obsolete.js'),
    path.join(target, 'l10n/plugin_pt_br_obsolete.properties'),
  ]
  for (const filename of obsolete) {
    mkdirSync(path.dirname(filename), { recursive: true })
    writeFileSync(filename, 'test-only obsolete artifact')
  }
  const result = spawnSync(process.execPath, [path.join(directory, 'prepare-assets.mjs')], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  for (const filename of obsolete) assert.equal(existsSync(filename), false, filename)
  const languages = readdirSync(path.resolve(directory, '../../l10n')).filter(
    (filename) => filename.startsWith('ui.') && filename.endsWith('.json'),
  )
  assert.equal(readdirSync(path.join(target, 'l10n')).length, (languages.length + 1) * 2)
  assert.ok(existsSync(path.join(target, 'assets/webview/main.js')))
  assert.ok(readdirSync(path.join(target, 'l10n')).includes('plugin_pt_BR.properties'))
  assert.ok(!readdirSync(path.join(target, 'l10n')).includes('plugin_pt_br.properties'))
})
